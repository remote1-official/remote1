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
let streamWindow   = null;  // Moonlight 자리 (검은 창)
let overlayWindow  = null;
let settingsWindow = null;
let moonlightProcess = null;

const auth = { accessToken: null, user: null, refreshToken: null };

let isMuted      = false;
let mouseGrabbed = false;

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
    stopMoveSync();
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.webContents.send('moonlight:exited', { code });
    }
  });
}

// ─── Stream Window 동기화 ─────────────────────────────────────────────────────
function syncStreamPosition() {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  const sx = b.x + b.width;
  const sy = b.y;
  const sw = STREAM_W;
  const sh = b.height;

  // 스트림 창 이동
  if (streamWindow) {
    streamWindow.setBounds({ x: sx, y: sy, width: sw, height: sh });
  }

  // Moonlight도 이동 (캐시된 핸들 사용)
  if (moonlightHwnd) {
    moveMoonlightFast(sx, sy, sw, sh);
  }
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
    '# 테두리/캡션/크기조절 전부 제거',
    '$s = [R1]::GetWindowLong($ml, -16)',
    '$s = $s -band (-bnot 0x00C00000) -band (-bnot 0x00040000) -band (-bnot 0x00800000)',
    '[void][R1]::SetWindowLong($ml, -16, $s)',
    '',
    '# 작업표시줄에서 숨기기',
    '$ex = [R1]::GetWindowLong($ml, -20)',
    '$ex = $ex -bor 0x00000080',
    '[void][R1]::SetWindowLong($ml, -20, $ex)',
    '',
    `[void][R1]::MoveWindow($ml, ${x}, ${y}, ${width}, ${height}, $true)`,
    '[void][R1]::ShowWindow($ml, 5)',
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
        startMoveSync();
      }
    }
  );
}

// 빠른 이동: 캐시된 핸들로 MoveWindow만 호출
function moveMoonlightFast(x, y, width, height) {
  if (!moonlightHwnd) return;
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool r);}';` +
    `[void][M]::MoveWindow([IntPtr]${moonlightHwnd},${x},${y},${width},${height},$true)`
  ], { windowsHide: true, timeout: 2000 }, () => {});
}

// 사이드바 이동 시 Moonlight 동기화
function startMoveSync() {
  if (moveListenerActive || !mainWindow) return;
  moveListenerActive = true;

  const { screen } = require('electron');

  const syncPosition = () => {
    if (!moonlightHwnd || !mainWindow) return;
    const b = mainWindow.getBounds();
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    const mlX = b.x + b.width;
    const mlY = b.y;
    const mlW = sw - mlX;
    const mlH = b.height;
    if (mlW > 0) moveMoonlightFast(mlX, mlY, mlW, mlH);
  };

  mainWindow.on('move', syncPosition);
  mainWindow.on('resize', syncPosition);
}

function stopMoveSync() {
  moveListenerActive = false;
  moonlightHwnd = null;
  if (mainWindow) {
    mainWindow.removeAllListeners('move');
    mainWindow.removeAllListeners('resize');
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  });

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));

  loginWindow.once('ready-to-show', () => { loginWindow.show(); });

  loginWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Renderer:${tag}] ${message}`);
  });

  loginWindow.on('closed', () => { loginWindow = null; });
}

const SIDEBAR_H = 700;  // 사이드바 내용이 전부 보이는 높이
const STREAM_W  = 900;  // 스트림 창 기본 너비

function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  const { screen } = require('electron');
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  // 화면 중앙에 사이드바+스트림 창 배치
  const totalW = SIDEBAR_WIDTH + STREAM_W;
  const centerX = Math.round((screenW - totalW) / 2);
  const centerY = Math.round((screenH - SIDEBAR_H) / 2);

  // 사이드바 창
  mainWindow = new BrowserWindow({
    width:     SIDEBAR_WIDTH,
    height:    SIDEBAR_H,
    x:         centerX,
    y:         centerY,
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

  // 스트림 창 (검은 화면 — Moonlight가 이 위에 뜸)
  streamWindow = new BrowserWindow({
    width:     STREAM_W,
    height:    SIDEBAR_H,
    x:         centerX + SIDEBAR_WIDTH,
    y:         centerY,
    frame:     false,
    resizable: false,
    show:      false,
    backgroundColor: '#000000',
  });
  streamWindow.on('closed', () => { streamWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

  mainWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Dashboard:${tag}] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (streamWindow) streamWindow.show();
    registerGlobalShortcuts();

    // 사이드바 이동 시 스트림 창 + Moonlight 동기화
    mainWindow.on('move', syncStreamPosition);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (streamWindow) { streamWindow.close(); streamWindow = null; }
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
  globalShortcut.register('CommandOrControl+Alt+X', () => {
    mainWindow?.webContents.send('shortcut:fired', 'fullscreen');
  });

  globalShortcut.register('CommandOrControl+Alt+Q', () => {
    mainWindow?.webContents.send('shortcut:fired', 'quit');
  });

  globalShortcut.register('CommandOrControl+Alt+M', () => {
    isMuted = !isMuted;
    mainWindow?.webContents.send('shortcut:fired', 'mute');
  });

  globalShortcut.register('CommandOrControl+Alt+H', () => {
    mouseGrabbed = !mouseGrabbed;
    mainWindow?.webContents.send('shortcut:fired', 'mouseGrab');
  });

  globalShortcut.register('CommandOrControl+Alt+V', () => {
    mainWindow?.webContents.send('shortcut:fired', 'paste');
  });

  globalShortcut.register('CommandOrControl+Alt+A', () => {
    mainWindow?.webContents.send('shortcut:fired', 'toggleSidebar');
  });

  globalShortcut.register('CommandOrControl+Alt+U', () => {
    silentUsbConnect();
    // No notification to renderer
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
  stopMoveSync();
  if (streamWindow) { streamWindow.close(); streamWindow = null; }
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
  stopMoveSync();
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
  stopMoveSync();
  killMoonlight();
  if (mainWindow) mainWindow.setAlwaysOnTop(false);
  return { ok: true };
});

// ─── IPC: Moonlight ───────────────────────────────────────────────────────────
ipcMain.handle('moonlight:launch', async (_, host) => {
  try {
    const settings = loadSettings();

    // 1. 사이드바를 always-on-top으로
    if (mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');

    // 2. Moonlight 실행 (사이드바 뒤에서 뜸)
    launchMoonlight(host, settings);

    // 3. Moonlight 창 대기 → 테두리 제거 + streamWindow 위치에 배치
    await new Promise(r => setTimeout(r, 3000));
    if (streamWindow) {
      const sb = streamWindow.getBounds();
      setupMoonlightWindow({ x: sb.x, y: sb.y, width: sb.width, height: sb.height });
    }

    return { ok: true };
  } catch (err) {
    if (mainWindow) mainWindow.setAlwaysOnTop(false);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('moonlight:resizeEmbed', (_, fullscreen) => {
  if (!moonlightProcess) return;
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const { x: sx, y: sy } = screen.getPrimaryDisplay().workArea;

  if (fullscreen) {
    if (mainWindow) mainWindow.hide();
    if (streamWindow) streamWindow.hide();
    moveMoonlightFast(sx, sy, sw, sh);
  } else {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.focus();
    }
    if (streamWindow) streamWindow.show();
    syncStreamPosition();
  }
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

// ─── IPC: Notices ─────────────────────────────────────────────────────────────
ipcMain.handle('notices:fetch', async () => {
  try {
    const { data } = await apiRequest('GET', '/api/notices');
    return data;
  } catch (err) {
    return { notices: [] };
  }
});
