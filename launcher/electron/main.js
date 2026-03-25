'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawn, execFile, execSync } = require('child_process');
const fs = require('fs');

// ─── 깜빡임 방지 ─────────────────────────────────────────────────────────────
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

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
let overlayWindow  = null;
let settingsWindow = null;
let moonlightProcess = null;
let moonlightTitlePollTimer = null;

const auth = { accessToken: null, user: null, refreshToken: null };

let isMuted      = false;
let mouseGrabbed = false;
let moonlightHwnd = null;          // Moonlight 창 핸들 (캐시)
let moonlightSavedBounds = null;   // 전체화면 전 원래 위치/크기

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

  // windowed 모드로 독립 실행 (로딩 창 포함 그대로 표시)
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
    moonlightHwnd = null;
    moonlightSavedBounds = null;
    stopMoonlightTitlePoll();
    if (mainWindow) {
      mainWindow.webContents.send('moonlight:exited', { code });
    }
  });
}

// ─── Moonlight 창 타이틀 감지 (스트리밍 연결 완료 감지) ──────────────────────
const SIDEBAR_WIDTH = 220;

function startMoonlightTitlePoll() {
  stopMoonlightTitlePoll();
  console.log('[TitlePoll] Started polling for Moonlight streaming title...');

  moonlightTitlePollTimer = setInterval(() => {
    if (!moonlightProcess) {
      stopMoonlightTitlePoll();
      return;
    }

    // 타이틀 + HWND를 동시에 가져오기
    const cmd = [
      '$p = Get-Process Moonlight -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1;',
      'if ($p) { Write-Output "$($p.MainWindowHandle)|$($p.MainWindowTitle)" }'
    ].join(' ');

    execFile('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd
    ], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      const line = (stdout || '').trim();
      if (!line) return;
      const sepIdx = line.indexOf('|');
      if (sepIdx < 0) return;
      const hwnd = line.substring(0, sepIdx);
      const title = line.substring(sepIdx + 1);

      if (title && title.includes(' - Moonlight')) {
        console.log('[TitlePoll] Streaming connected! Title:', title, 'HWND:', hwnd);
        moonlightHwnd = hwnd;
        stopMoonlightTitlePoll();
        if (mainWindow) {
          mainWindow.webContents.send('moonlight:streamConnected');
        }
      }
    });
  }, 1000);
}

function stopMoonlightTitlePoll() {
  if (moonlightTitlePollTimer) {
    clearInterval(moonlightTitlePollTimer);
    moonlightTitlePollTimer = null;
    console.log('[TitlePoll] Stopped.');
  }
}

// ─── Moonlight 전체화면 / 전체창모드 ─────────────────────────────────────────
// mode: 'fullscreen' = 테두리 없이 모니터 전체 (작업표시줄 덮음)
// mode: 'windowed'   = 테두리 있는 상태로 작업영역 꽉 채움
function setMoonlightDisplayMode(mode) {
  if (!moonlightHwnd) {
    console.log('[Display] No Moonlight HWND cached');
    return;
  }

  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();

  let x, y, w, h, styleCmd;

  if (mode === 'fullscreen') {
    // 모니터 전체 (작업표시줄 포함) — 테두리/캡션 제거
    const { width, height } = display.size;
    x = 0; y = 0; w = width; h = height;
    styleCmd = [
      '$s = [R1]::GetWindowLong($ml, -16)',
      '$s = $s -band (-bnot 0x00C00000) -band (-bnot 0x00040000) -band (-bnot 0x00800000)',
      '[void][R1]::SetWindowLong($ml, -16, $s)',
    ].join('\n');
  } else if (mode === 'windowed') {
    // 작업영역 (작업표시줄 제외) — 테두리/캡션 복원
    const wa = display.workArea;
    x = wa.x; y = wa.y; w = wa.width; h = wa.height;
    styleCmd = [
      '$s = [R1]::GetWindowLong($ml, -16)',
      '$s = $s -bor 0x00C00000 -bor 0x00040000 -bor 0x00800000',
      '[void][R1]::SetWindowLong($ml, -16, $s)',
    ].join('\n');
  } else if (mode === 'restore') {
    // 원래 크기로 복원 — 테두리/캡션 복원
    styleCmd = [
      '$s = [R1]::GetWindowLong($ml, -16)',
      '$s = $s -bor 0x00C00000 -bor 0x00040000 -bor 0x00800000',
      '[void][R1]::SetWindowLong($ml, -16, $s)',
    ].join('\n');
    if (moonlightSavedBounds) {
      x = moonlightSavedBounds.x;
      y = moonlightSavedBounds.y;
      w = moonlightSavedBounds.w;
      h = moonlightSavedBounds.h;
    } else {
      // 저장된 위치가 없으면 화면 중앙 적당한 크기로
      const wa = display.workArea;
      w = Math.round(wa.width * 0.7);
      h = Math.round(wa.height * 0.7);
      x = wa.x + Math.round((wa.width - w) / 2);
      y = wa.y + Math.round((wa.height - h) / 2);
    }
  }

  const scriptPath = path.join(app.getPath('temp'), 'r1_display.ps1');
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class R1 {',
    '  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);',
    '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
    '  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }',
    '}',
    '"@',
    '',
    `$ml = [IntPtr]${moonlightHwnd}`,
    '',
    '# 현재 위치 저장용 출력',
    '$rc = New-Object R1+RECT',
    '[void][R1]::GetWindowRect($ml, [ref]$rc)',
    'Write-Output "$($rc.L)|$($rc.T)|$($rc.R - $rc.L)|$($rc.B - $rc.T)"',
    '',
    styleCmd,
    '',
    `[void][R1]::MoveWindow($ml, ${x}, ${y}, ${w}, ${h}, $true)`,
    '[void][R1]::SetForegroundWindow($ml)',
  ].join('\n');

  fs.writeFileSync(scriptPath, script, 'utf8');

  execFile('powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true, timeout: 5000 },
    (err, stdout) => {
      const line = (stdout || '').trim().split('\n')[0];
      try { fs.unlinkSync(scriptPath); } catch (_) {}

      // 원래 위치 저장 (fullscreen/windowed로 바꾸기 전 위치)
      if (mode !== 'restore' && line) {
        const parts = line.split('|');
        if (parts.length === 4 && !moonlightSavedBounds) {
          moonlightSavedBounds = {
            x: parseInt(parts[0], 10),
            y: parseInt(parts[1], 10),
            w: parseInt(parts[2], 10),
            h: parseInt(parts[3], 10),
          };
          console.log('[Display] Saved original bounds:', moonlightSavedBounds);
        }
      } else if (mode === 'restore') {
        moonlightSavedBounds = null;
      }

      console.log('[Display] Mode set to:', mode);
    }
  );
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  });

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));

  loginWindow.once('ready-to-show', () => {
    setTimeout(() => { if (loginWindow) loginWindow.show(); }, 200);
  });

  loginWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Renderer:${tag}] ${message}`);
  });

  loginWindow.on('closed', () => { loginWindow = null; });
}

const SIDEBAR_H = 700;  // 사이드바 내용이 전부 보이는 높이

function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  // 사이드바만 화면 중앙에 표시
  mainWindow = new BrowserWindow({
    width:     SIDEBAR_WIDTH,
    height:    SIDEBAR_H,
    center:    true,
    minWidth:  SIDEBAR_WIDTH,
    maxWidth:  SIDEBAR_WIDTH,
    minHeight: SIDEBAR_H,
    frame:     false,
    resizable: false,
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
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.show();
        registerGlobalShortcuts();
      }
    }, 200);
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
function registerGlobalShortcuts() {
  // Ctrl+Alt+F1 — 사이드바 열기/닫기
  globalShortcut.register('CommandOrControl+Alt+F1', () => {
    mainWindow?.webContents.send('shortcut:fired', 'toggleSidebar');
  });

  // Ctrl+Alt+F2 — 전체화면 (테두리 없음, 작업표시줄 덮음)
  globalShortcut.register('CommandOrControl+Alt+F2', () => {
    mainWindow?.webContents.send('shortcut:fired', 'fullscreen');
  });

  // Ctrl+Alt+F3 — 전체창모드 (테두리 있음, 작업표시줄 제외)
  globalShortcut.register('CommandOrControl+Alt+F3', () => {
    mainWindow?.webContents.send('shortcut:fired', 'windowedFull');
  });

  // Ctrl+Alt+F4 — 종료
  globalShortcut.register('CommandOrControl+Alt+F4', () => {
    mainWindow?.webContents.send('shortcut:fired', 'quit');
  });

  // Ctrl+Alt+F5 — 음소거
  globalShortcut.register('CommandOrControl+Alt+F5', () => {
    isMuted = !isMuted;
    mainWindow?.webContents.send('shortcut:fired', 'mute');
  });

  // Ctrl+Alt+F6 — 마우스 고정
  globalShortcut.register('CommandOrControl+Alt+F6', () => {
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

ipcMain.handle('win:toggleSidebar', () => {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
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
  stopMoonlightTitlePoll();
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
  stopMoonlightTitlePoll();
  killMoonlight();
  if (auth.user && usedMinutes) {
    auth.user.credits = Math.max(0, (auth.user.credits || 0) - usedMinutes);
  }
  return { ok: true };
});

ipcMain.handle('api:keepAlive', async () => {
  stopMoonlightTitlePoll();
  killMoonlight();
  return { ok: true };
});

// ─── IPC: Moonlight ───────────────────────────────────────────────────────────
ipcMain.handle('moonlight:launch', async (_, host) => {
  try {
    const settings = loadSettings();

    // Moonlight를 독립 창모드로 실행 (사이드바와 별개)
    launchMoonlight(host, settings);

    // 스트리밍 연결 완료 감지 시작 (Moonlight 창 타이틀 폴링)
    startMoonlightTitlePoll();

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('moonlight:resizeEmbed', (_, fullscreen) => {
  // Moonlight는 독립 창이므로 별도 제어 불필요
  if (fullscreen) {
    if (mainWindow) mainWindow.hide();
  } else {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

// Moonlight 전체화면 (테두리 없음, 작업표시줄 덮음)
ipcMain.handle('moonlight:fullscreen', (_, mode) => {
  setMoonlightDisplayMode(mode);
  return { ok: true };
});

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

// ─── IPC: USB ─────────────────────────────────────────────────────────────────
ipcMain.handle('usb:connect', () => {
  silentUsbConnect();
  return { ok: true };
});

ipcMain.handle('usb:disconnect', () => {
  silentUsbDisconnect();
  return { ok: true };
});

// ─── IPC: Credentials (파일 기반) ──────────────────────────────────────────────
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

ipcMain.handle('credentials:load', () => {
  try {
    const raw = fs.readFileSync(getCredentialsPath(), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
});

ipcMain.handle('credentials:save', (_, data) => {
  try {
    fs.writeFileSync(getCredentialsPath(), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
