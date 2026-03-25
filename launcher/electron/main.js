'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawn, execFile, execSync } = require('child_process');
const fs = require('fs');

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://project-six-sable-26.vercel.app';

const MOONLIGHT_PATHS = [
  'C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe',
  'C:\\Program Files (x86)\\Moonlight Game Streaming\\Moonlight.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Moonlight Game Streaming', 'Moonlight.exe'),
];

const WINDOW_CONFIG = {
  TITLE_BAR_H: 40,
  SIDEBAR_W:   240,
  MAIN_W:      960,
  MAIN_H:      660,
};

// ─── Default Settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  resolution:   '1080p',
  fps:          60,
  bitrate:      20000,
  displayMode:  'fullscreen',
  vsync:        true,
  audio:        'stereo',
  muteHost:     false,
  mouseOpt:     true,
  gamepad:      true,
  videoDecoder: 'auto',
  videoCodec:   'auto',
  language:     'auto',
};

// ─── State ────────────────────────────────────────────────────────────────────
let loginWindow    = null;
let mainWindow     = null;
let streamWindow   = null;  // 미사용 (하위 호환)
let overlayWindow  = null;
let settingsWindow = null;
let moonlightProcess = null;

const auth = { accessToken: null, user: null, refreshToken: null };

let isMuted      = false;
let mouseGrabbed = false;

// ─── Credentials File ─────────────────────────────────────────────────────────
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(getCredentialsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveCredentials(data) {
  try {
    fs.writeFileSync(getCredentialsPath(), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Settings File ────────────────────────────────────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_SETTINGS, parsed);
  } catch (_) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettingsFile(settings) {
  try {
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function apiRequest(method, endpoint, body = null, token = null, cookieHeader = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'REMOTE1-Launcher/1.0',
      ...(token        ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader }             : {}),
      ...(bodyStr      ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
    };

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers,
      },
      (res) => {
        let data = '';
        const setCookie = res.headers['set-cookie'];
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ data: parsed, setCookie });
            } else {
              const rawErr = parsed.error || parsed.message;
              let errText;
              if (typeof rawErr === 'string') {
                errText = rawErr;
              } else if (rawErr && typeof rawErr === 'object') {
                errText = String(rawErr.message || rawErr.error || JSON.stringify(rawErr));
              } else {
                errText = `HTTP ${res.statusCode}`;
              }
              reject(new ApiError(errText, res.statusCode));
            }
          } catch {
            reject(new ApiError(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`, res.statusCode));
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Token Refresh ────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!auth.refreshToken) throw new Error('no refresh token');
  const { data, setCookie } = await apiRequest(
    'POST', '/api/auth/refresh', null, null,
    `refreshToken=${auth.refreshToken}`
  );
  auth.accessToken = data.accessToken;
  if (setCookie) {
    const rtCookie = setCookie.find((c) => c.startsWith('refreshToken='));
    if (rtCookie) {
      auth.refreshToken = rtCookie.split(';')[0].replace('refreshToken=', '');
    }
  }
  return auth.accessToken;
}

async function authedRequest(method, endpoint, body = null) {
  try {
    return await apiRequest(method, endpoint, body, auth.accessToken);
  } catch (err) {
    if (err.statusCode === 401) {
      try {
        await refreshAccessToken();
      } catch (refreshErr) {
        console.error('[authedRequest] token refresh failed:', refreshErr.message);
        throw err; // 원래 401 에러를 그대로 전달
      }
      return apiRequest(method, endpoint, body, auth.accessToken);
    }
    throw err;
  }
}

// ─── Overlay Window ───────────────────────────────────────────────────────────
function createOverlayWindow() {
  if (overlayWindow) { overlayWindow.focus(); return; }

  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().size;

  overlayWindow = new BrowserWindow({
    x: 0, y: 0,
    width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function closeOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

function showDashboard() {
  closeOverlayWindow();
  killMoonlight();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── Moonlight Management ─────────────────────────────────────────────────────
function findMoonlightExe() {
  for (const p of MOONLIGHT_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function killMoonlight() {
  if (loadingHideInterval) { clearInterval(loadingHideInterval); loadingHideInterval = null; }
  if (earlyPosInterval) { clearInterval(earlyPosInterval); earlyPosInterval = null; }
  if (moonlightProcess) {
    try { moonlightProcess.kill(); } catch (_) {}
    moonlightProcess = null;
  }
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /IM Moonlight.exe 2>nul', { windowsHide: true }); } catch (_) {}
  }
}

function launchMoonlight(host, settings) {
  const exePath = findMoonlightExe();
  if (!exePath) {
    throw new Error(
      'REMOTE1 스트리밍 모듈이 설치되어 있지 않습니다.\n\n런처를 재설치해주세요.'
    );
  }

  killMoonlight();

  const s = Object.assign({}, DEFAULT_SETTINGS, settings);

  const args = ['stream', host, 'Desktop'];

  if (s.resolution === '720p') args.push('--720');
  else if (s.resolution === '1440p') args.push('--1440');
  else if (s.resolution === '4K') args.push('--4k');
  else args.push('--1080');

  args.push('--fps', String(s.fps || 60));
  args.push('--bitrate', String(s.bitrate || 20000));

  // windowed 모드로 실행 → 이후 Win32 API로 런처 안에 임베드
  args.push('--display-mode', 'windowed');

  console.log('[Moonlight] CMD:', exePath, args.join(' '));

  moonlightProcess = spawn(exePath, args, {
    detached: false,
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  moonlightProcess.stdout.on('data', (d) => console.log('[Moonlight]', d.toString().trim()));
  moonlightProcess.stderr.on('data', (d) => console.error('[Moonlight]', d.toString().trim()));
  moonlightProcess.on('error', (err) => console.error('[Moonlight] spawn error:', err));
  moonlightProcess.on('exit', (code) => {
    moonlightProcess = null;
    if (loadingHideInterval) { clearInterval(loadingHideInterval); loadingHideInterval = null; }
    if (earlyPosInterval) { clearInterval(earlyPosInterval); earlyPosInterval = null; }
    stopSnapSync();
    if (mainWindow) {
      mainWindow.webContents.send('moonlight:exited', { code });
    }
  });

  // spawn 직후: 로딩 창 숨기기 + 위치 강제
  hideLoadingWindow();
  forceEarlyPosition();
}

// ─── Moonlight 로딩 창 숨기기 + 초기 위치 강제 ────────────────────────────────
let loadingHideInterval = null;
let earlyPosInterval = null;

function hideLoadingWindow() {
  if (loadingHideInterval) clearInterval(loadingHideInterval);
  if (!moonlightProcess) return;
  const pid = moonlightProcess.pid;
  let attempts = 0;

  loadingHideInterval = setInterval(() => {
    attempts++;
    // moonlightHwnd가 설정되면 스트리밍 창이 잡힌 것이므로 중단
    if (!moonlightProcess || moonlightHwnd || attempts > 40) {
      clearInterval(loadingHideInterval);
      loadingHideInterval = null;
      return;
    }
    // 로딩 창 숨기기: 빈 타이틀 또는 "Moonlight" 타이틀만 대상 (REMOTE1 Streaming 제외)
    execFile('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type @"\nusing System;using System.Runtime.InteropServices;using System.Diagnostics;using System.Text;\n` +
      `public class HL{\n` +
      `  [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);\n` +
      `  [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);\n` +
      `  [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);\n` +
      `}\n"@\n` +
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if(!$p){exit}\n` +
      `foreach($w in (Get-Process -Id ${pid}).MainWindowHandle){\n` +
      `  if($w -eq [IntPtr]::Zero){continue}\n` +
      `  $sb=New-Object Text.StringBuilder 256;[void][HL]::GetWindowText($w,$sb,256);$t=$sb.ToString()\n` +
      `  if($t -eq "" -or $t -eq "Moonlight"){if([HL]::IsWindowVisible($w)){[void][HL]::ShowWindow($w,0);Write-Output "HIDDEN"}}\n` +
      `}`
    ], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      const out = (stdout || '').trim();
      if (out.includes('HIDDEN')) {
        console.log('[HideLoading] loading window hidden');
      }
    });
  }, 500);
}

function forceEarlyPosition() {
  if (earlyPosInterval) clearInterval(earlyPosInterval);
  if (!moonlightProcess || !mainWindow) return;
  const pid = moonlightProcess.pid;
  let attempts = 0;

  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const { x: sx, y: sy } = screen.getPrimaryDisplay().workArea;
  const b = mainWindow.getBounds();
  const areaX = b.x + b.width;
  const areaW = (sx + sw) - areaX;
  const bounds = calcMoonlightBounds(areaX, sy, areaW, sh);

  earlyPosInterval = setInterval(() => {
    attempts++;
    if (!moonlightProcess || attempts > 10) {
      clearInterval(earlyPosInterval);
      earlyPosInterval = null;
      return;
    }
    // PID로 창을 찾아서 사이드바 오른쪽으로 강제 이동 (16:9 비율)
    execFile('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type 'using System;using System.Runtime.InteropServices;using System.Diagnostics;` +
      `public class EP{` +
      `[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool r);` +
      `public static void Move(int pid,int x,int y,int w,int h){` +
      `foreach(var p in Process.GetProcesses()){try{if(p.Id==pid&&p.MainWindowHandle!=IntPtr.Zero)MoveWindow(p.MainWindowHandle,x,y,w,h,true);}catch{}}` +
      `}}';` +
      `[EP]::Move(${pid},${bounds.x},${bounds.y},${bounds.width},${bounds.height})`
    ], { windowsHide: true, timeout: 2000 }, () => {});
  }, 100);
}

// ─── 16:9 비율 계산 ──────────────────────────────────────────────────────────
const TITLE_BAR_HEIGHT = 32; // Windows 제목표시줄 높이 (대략)

function calcMoonlightBounds(areaX, areaY, areaW, areaH) {
  // 제목표시줄 높이를 제외한 영역에서 16:9 비율 계산
  const contentH = areaH - TITLE_BAR_HEIGHT;
  const idealW = Math.round(contentH * 16 / 9);
  const w = Math.min(idealW, areaW);
  const h = Math.round(w * 9 / 16) + TITLE_BAR_HEIGHT;
  const x = areaX; // 왼쪽 정렬
  const y = areaY + Math.round((areaH - h) / 2); // 세로 중앙
  return { x, y, width: w, height: h };
}

// ─── Stream Window 동기화 ─────────────────────────────────────────────────────
function syncStreamPosition() {
  // Moonlight를 사이드바 오른쪽에 16:9 비율로 snap 배치
  if (!moonlightHwnd || !mainWindow) return;
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const { x: sx, y: sy } = screen.getPrimaryDisplay().workArea;
  const b = mainWindow.getBounds();
  const areaX = b.x + b.width;
  const areaW = (sx + sw) - areaX;
  if (areaW <= 0) return;
  const bounds = calcMoonlightBounds(areaX, sy, areaW, sh);
  moveMoonlightFast(bounds.x, bounds.y, bounds.width, bounds.height);
}

// ─── Win32: Moonlight 창 관리 ─────────────────────────────────────────────────
const SIDEBAR_WIDTH = 220;
let moonlightHwnd = null;  // Moonlight 창 핸들 (캐시)
let moveListenerActive = false;

// 초기 설정: 테두리 제거 + 위치 + 핸들 캐시
function setupMoonlightWindow(bounds, retries = 15) {
  if (!moonlightProcess) return;
  const pid = moonlightProcess.pid;
  const { x, y, width, height } = bounds;

  const scriptPath = path.join(app.getPath('temp'), 'r1_setup.ps1');
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Diagnostics;',
    'public class R1 {',
    '  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);',
    '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
    '  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);',
    '  public static IntPtr FindByPid(int pid) {',
    '    foreach (var p in Process.GetProcesses()) {',
    '      try { if (p.Id == pid && p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle; } catch {}',
    '    }',
    '    return IntPtr.Zero;',
    '  }',
    '}',
    '"@',
    '',
    `$ml = [R1]::FindByPid(${pid})`,
    'if ($ml -eq [IntPtr]::Zero) { Write-Output "WAIT"; exit }',
    '',
    '# 크기조절만 비활성화 (제목표시줄/테두리 유지)',
    '$s = [R1]::GetWindowLong($ml, -16)',
    '$s = $s -band (-bnot 0x00040000)',
    '[void][R1]::SetWindowLong($ml, -16, $s)',
    '',
    `[void][R1]::MoveWindow($ml, ${x}, ${y}, ${width}, ${height}, $true)`,
    '[void][R1]::ShowWindow($ml, 5)',
    '[void][R1]::SetWindowText($ml, "REMOTE1 Streaming")',
    'Write-Output $ml.ToInt64()',
  ].join('\n');

  fs.writeFileSync(scriptPath, script, 'utf8');

  execFile('powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true, timeout: 5000 },
    (err, stdout) => {
      const r = (stdout || '').trim().split('\n').pop();
      console.log('[Setup] result:', r);
      try { fs.unlinkSync(scriptPath); } catch (_) {}

      if (r === 'WAIT' && retries > 0) {
        setTimeout(() => setupMoonlightWindow(bounds, retries - 1), 500);
      } else if (r && r !== 'WAIT') {
        moonlightHwnd = r; // 핸들 캐시
        console.log('[Setup] Moonlight HWND:', moonlightHwnd);
        startSnapSync();
      }
    }
  );
}

// 빠른 이동: 캐시된 핸들로 SetWindowPos 호출 (MoveWindow보다 강력)
function moveMoonlightFast(x, y, width, height, topmost = false) {
  if (!moonlightHwnd) return;
  const insertAfter = topmost ? '-1' : '-2'; // HWND_TOPMOST(-1) or HWND_NOTOPMOST(-2)
  const flags = '0x0040'; // SWP_SHOWWINDOW
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class M{` +
    `[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int ht,uint f);` +
    `[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}';` +
    `[void][M]::SetWindowPos([IntPtr]${moonlightHwnd},[IntPtr](${insertAfter}),${x},${y},${width},${height},${flags});` +
    (topmost ? `[void][M]::SetForegroundWindow([IntPtr]${moonlightHwnd})` : '')
  ], { windowsHide: true, timeout: 2000 }, (err) => {
    if (err) console.error('[moveMoonlight] error:', err.message);
  });
}

// 사이드바 이동 시 Moonlight snap 동기화
function startSnapSync() {
  if (moveListenerActive || !mainWindow) return;
  moveListenerActive = true;
  mainWindow.on('move', syncStreamPosition);
  mainWindow.on('resize', syncStreamPosition);
}

function stopSnapSync(clearHwnd = true) {
  moveListenerActive = false;
  if (clearHwnd) moonlightHwnd = null;
  if (mainWindow) {
    mainWindow.removeListener('move', syncStreamPosition);
    mainWindow.removeListener('resize', syncStreamPosition);
  }
}

// ─── USB (silent) ─────────────────────────────────────────────────────────────
function silentUsbConnect() {
  try {
    execFile(
      'powershell.exe',
      [
        '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        'Get-PnpDevice | Where-Object {$_.Class -eq "USB"} | Select-Object -First 1 | Out-Null',
      ],
      { windowsHide: true },
      () => {}
    );
  } catch (_) {}
}

function silentUsbDisconnect() {
  try {
    execFile(
      'powershell.exe',
      [
        '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        'Get-PnpDevice | Where-Object {$_.Class -eq "USB"} | Select-Object -First 1 | Out-Null',
      ],
      { windowsHide: true },
      () => {}
    );
  } catch (_) {}
}

// ─── Window Creation ──────────────────────────────────────────────────────────
function createLoginWindow() {
  if (loginWindow) { loginWindow.focus(); return; }

  loginWindow = new BrowserWindow({
    width:     440,
    height:    600,
    resizable: false,
    frame:     false,
    center:    true,
    show:      false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  });

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));

  loginWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (loginWindow) loginWindow.show(); }, 50);
  });

  loginWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Renderer:${tag}] ${message}`);
  });

  loginWindow.on('closed', () => { loginWindow = null; });
}

const SIDEBAR_H = 850;  // 사이드바 내용이 스크롤 없이 전부 보이는 높이
const STREAM_W  = 900;  // 스트림 창 기본 너비

function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  const { screen } = require('electron');
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  // 사이드바만 화면 중앙
  mainWindow = new BrowserWindow({
    width:     SIDEBAR_WIDTH,
    height:    SIDEBAR_H,
    minWidth:  160,
    maxWidth:  SIDEBAR_WIDTH,
    minHeight: 300,
    maxHeight: SIDEBAR_H,
    frame:     false,
    resizable: true,
    center:    true,
    show:      false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

  mainWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Dashboard:${tag}] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    registerGlobalShortcuts();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    killMoonlight();
    unregisterGlobalShortcuts();
  });
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }

  settingsWindow = new BrowserWindow({
    width:     560,
    height:    700,
    resizable: false,
    frame:     false,
    center:    true,
    parent:    mainWindow || undefined,
    modal:     false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Global Shortcuts ─────────────────────────────────────────────────────────
// Moonlight 단축키(Ctrl+Alt+*)와 충돌 방지: Ctrl+Shift+F* 사용
function registerGlobalShortcuts() {
  // Ctrl+Shift+F1: 사이드바 숨기기/보이기
  globalShortcut.register('CommandOrControl+Shift+F1', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) { mainWindow.hide(); }
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });

  // Ctrl+Shift+F2: 전체모드 (Moonlight 전체화면 켜기/끄기)
  globalShortcut.register('CommandOrControl+Shift+F2', () => {
    mainWindow?.webContents.send('shortcut:fired', 'fullscreen');
  });

  // Ctrl+Shift+F3: 전체창모드 (런처 창 최대화 토글)
  globalShortcut.register('CommandOrControl+Shift+F3', () => {
    mainWindow?.webContents.send('shortcut:fired', 'maximizeWindow');
  });

  // Ctrl+Shift+F4: 종료
  globalShortcut.register('CommandOrControl+Shift+F4', () => {
    mainWindow?.webContents.send('shortcut:fired', 'quit');
  });

  // Ctrl+Shift+F5: 음소거
  globalShortcut.register('CommandOrControl+Shift+F5', () => {
    isMuted = !isMuted;
    mainWindow?.webContents.send('shortcut:fired', 'mute');
  });

  // Ctrl+Shift+F6: 마우스 고정
  globalShortcut.register('CommandOrControl+Shift+F6', () => {
    mouseGrabbed = !mouseGrabbed;
    mainWindow?.webContents.send('shortcut:fired', 'mouseGrab');
  });
}

function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createLoginWindow();
});

app.on('window-all-closed', () => {
  unregisterGlobalShortcuts();
  killMoonlight();
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Mouse Events ────────────────────────────────────────────────────────
ipcMain.handle('win:setIgnoreMouseEvents', (_, ignore, opts) => {
  // 오버레이 창이 있으면 오버레이에, 아니면 메인에 적용
  const target = overlayWindow || mainWindow;
  if (!target) return;
  if (ignore) {
    target.setIgnoreMouseEvents(true, opts || { forward: true });
  } else {
    target.setIgnoreMouseEvents(false);
  }
});

// ─── IPC: Overlay ─────────────────────────────────────────────────────────────
ipcMain.handle('overlay:disconnect', async () => {
  try {
    if (auth.accessToken) {
      await authedRequest('POST', '/api/session/disconnect').catch(() => {});
    }
  } catch (_) {}
  showDashboard();
  // 대시보드에 종료 알림
  if (mainWindow) {
    mainWindow.webContents.send('moonlight:exited', { code: 0 });
  }
  return { ok: true };
});

// ─── IPC: Shell ───────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

// ─── IPC: Window Controls ─────────────────────────────────────────────────────
ipcMain.handle('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.handle('win:close',    () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.handle('win:maximize', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (!w) return;
  w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.handle('win:move', (_, { dx, dy }) => {
  const w = BrowserWindow.getFocusedWindow();
  if (!w) return;
  const [x, y] = w.getPosition();
  w.setPosition(x + dx, y + dy);
});

// ─── IPC: Navigation ─────────────────────────────────────────────────────────
ipcMain.handle('nav:toMain', (_, userData) => {
  if (userData) {
    auth.user         = userData.user;
    auth.accessToken  = userData.accessToken;
    if (userData.refreshToken) auth.refreshToken = userData.refreshToken;
  }
  loginWindow?.close();
  createMainWindow();
  return { ok: true };
});

ipcMain.handle('nav:toLogin', () => {
  unregisterGlobalShortcuts();
  stopSnapSync();
  mainWindow?.close();
  killMoonlight();
  auth.accessToken  = null;
  auth.user         = null;
  auth.refreshToken = null;
  createLoginWindow();
  return { ok: true };
});

ipcMain.handle('nav:openSettings', () => {
  createSettingsWindow();
  return { ok: true };
});

ipcMain.handle('nav:closeSettings', () => {
  settingsWindow?.close();
  return { ok: true };
});

// ─── IPC: Auth ────────────────────────────────────────────────────────────────
ipcMain.handle('api:login', async (_, { username, password }) => {
  try {
    const { data, setCookie } = await apiRequest('POST', '/api/auth/login', { username, password });
    auth.accessToken = data.accessToken;
    auth.user        = data.user;
    if (setCookie) {
      const rt = setCookie.find((c) => c.startsWith('refreshToken='));
      if (rt) auth.refreshToken = rt.split(';')[0].replace('refreshToken=', '');
    }
    return { ok: true, data };
  } catch (err) {
    const msg = (err && typeof err.message === 'string' && err.message) ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('api:logout', async () => {
  try {
    if (auth.accessToken) {
      await apiRequest(
        'POST', '/api/auth/logout', null, auth.accessToken,
        auth.refreshToken ? `refreshToken=${auth.refreshToken}` : null
      );
    }
  } catch (_) {}
  auth.accessToken  = null;
  auth.user         = null;
  auth.refreshToken = null;
  return { ok: true };
});

ipcMain.handle('api:getUser', () => {
  if (!auth.user) return { ok: false, error: '로그인이 필요합니다' };
  return { ok: true, data: auth.user };
});

// ─── IPC: Session ─────────────────────────────────────────────────────────────
ipcMain.handle('api:connect', async () => {
  if (!auth.accessToken) return { ok: false, error: '로그인이 필요합니다' };
  try {
    const { data } = await authedRequest('POST', '/api/session/connect');
    return { ok: true, data };
  } catch (err) {
    console.error('[api:connect] error:', err.statusCode, err.message);
    if (err.statusCode === 401) {
      return { ok: false, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
    }
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api:disconnect', async (_, usedMinutes) => {
  try {
    if (auth.accessToken) {
      await authedRequest('POST', '/api/session/disconnect', { usedMinutes: usedMinutes || 0 }).catch(() => {});
    }
  } catch (_) {}
  stopSnapSync();
  killMoonlight();
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(false);
  }
  if (auth.user && usedMinutes) {
    auth.user.credits = Math.max(0, (auth.user.credits || 0) - usedMinutes);
  }
  return { ok: true };
});

ipcMain.handle('api:keepAlive', async () => {
  stopSnapSync();
  killMoonlight();
  if (mainWindow) mainWindow.setAlwaysOnTop(false);
  return { ok: true };
});

// ─── IPC: Moonlight ───────────────────────────────────────────────────────────
ipcMain.handle('moonlight:launch', async (_, host) => {
  try {
    const settings = loadSettings();
    launchMoonlight(host, settings);

    // Moonlight 창 핸들 캐시 + 사이드바 오른쪽에 16:9 snap 배치
    const { screen } = require('electron');
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const { x: sx, y: sy } = screen.getPrimaryDisplay().workArea;
    if (mainWindow) {
      const b = mainWindow.getBounds();
      const areaX = b.x + b.width;
      const areaW = (sx + sw) - areaX;
      const bounds = calcMoonlightBounds(areaX, sy, areaW, sh);
      setupMoonlightWindow(bounds);
    } else {
      const bounds = calcMoonlightBounds(sx, sy, sw, sh);
      setupMoonlightWindow(bounds);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 전체모드: 테두리 제거 + 화면 꽉참 / 해제: 테두리 복원 + snap 배치
ipcMain.handle('moonlight:resizeEmbed', (_, mode) => {
  // mode: 'fullscreen' | 'maximized' | 'normal'
  console.log('[resizeEmbed] mode:', mode, 'hwnd:', moonlightHwnd);
  if (!moonlightHwnd) return;
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const { x: sx, y: sy } = screen.getPrimaryDisplay().workArea;
  // 실제 모니터 전체 크기 (작업표시줄 포함)
  const { width: fullW, height: fullH } = screen.getPrimaryDisplay().size;

  if (mode === 'fullscreen') {
    // 전체모드: 테두리/제목표시줄 제거 + 모니터 전체 꽉 참
    stopSnapSync(false);
    setMoonlightStyle(moonlightHwnd, false); // 테두리 제거
    moveMoonlightFast(0, 0, fullW, fullH, true);
  } else if (mode === 'maximized') {
    // 전체창모드: 테두리 유지 + 작업영역 꽉 참
    stopSnapSync(false);
    setMoonlightStyle(moonlightHwnd, true); // 테두리 복원
    moveMoonlightFast(sx, sy, sw, sh);
  } else {
    // 일반모드: 테두리 복원 + 사이드바 오른쪽 snap 배치
    setMoonlightStyle(moonlightHwnd, true); // 테두리 복원
    syncStreamPosition();
    startSnapSync();
  }
});

// Moonlight 창 스타일 변경 (테두리/제목표시줄)
function setMoonlightStyle(hwnd, showBorder) {
  if (!hwnd) return;
  // showBorder=true: WS_CAPTION+WS_BORDER 복원, false: 제거
  const op = showBorder
    ? '$s = $s -bor 0x00C00000 -bor 0x00800000'
    : '$s = $s -band (-bnot 0x00C00000) -band (-bnot 0x00800000)';
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class WS{` +
    `[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);` +
    `[DllImport("user32.dll")]public static extern int SetWindowLong(IntPtr h,int i,int v);` +
    `[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int ht,uint f);}';` +
    `$s=[WS]::GetWindowLong([IntPtr]${hwnd},-16);` +
    `${op};` +
    `[void][WS]::SetWindowLong([IntPtr]${hwnd},-16,$s);` +
    // SWP_FRAMECHANGED(0x20) | SWP_NOMOVE(2) | SWP_NOSIZE(1) | SWP_NOZORDER(4)
    `[void][WS]::SetWindowPos([IntPtr]${hwnd},[IntPtr]0,0,0,0,0,0x27)`
  ], { windowsHide: true, timeout: 3000 }, () => {});
}

ipcMain.handle('moonlight:kill', () => {
  killMoonlight();
  return { ok: true };
});

ipcMain.handle('moonlight:isInstalled', () => {
  const exePath = findMoonlightExe();
  return { ok: true, installed: !!exePath, path: exePath };
});

ipcMain.handle('moonlight:openInstallPage', () => {
  shell.openExternal('https://moonlight-stream.org');
  return { ok: true };
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:load', () => {
  return loadSettings();
});

ipcMain.handle('settings:save', (_, settings) => {
  return saveSettingsFile(settings);
});

// ─── IPC: Credentials ─────────────────────────────────────────────────────────
ipcMain.handle('credentials:load', () => {
  return loadCredentials();
});

ipcMain.handle('credentials:save', (_, data) => {
  return saveCredentials(data);
});

// ─── IPC: USB ─────────────────────────────────────────────────────────────────
ipcMain.handle('usb:connect', () => {
  silentUsbConnect();
  return { ok: true };
});

ipcMain.handle('usb:disconnect', () => {
  silentUsbDisconnect();
  return { ok: true };
});

// ─── IPC: Notices ─────────────────────────────────────────────────────────────
ipcMain.handle('notices:fetch', async () => {
  try {
    const { data } = await apiRequest('GET', '/api/notices');
    return data;
  } catch (err) {
    return { notices: [] };
  }
});
