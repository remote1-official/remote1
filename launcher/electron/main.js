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
              reject(new Error(errText));
            }
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
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
    if (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')) {
      await refreshAccessToken();
      return apiRequest(method, endpoint, body, auth.accessToken);
    }
    throw err;
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

  // Build args
  const args = ['stream', host, 'Desktop'];

  // Resolution
  if (s.resolution === '720p') {
    args.push('--width', '1280', '--height', '720');
  } else if (s.resolution === '1440p') {
    args.push('--width', '2560', '--height', '1440');
  } else if (s.resolution === '4K') {
    args.push('--width', '3840', '--height', '2160');
  } else {
    // Default 1080p
    args.push('--width', '1920', '--height', '1080');
  }

  // FPS
  args.push('--fps', String(s.fps || 60));

  // Bitrate
  args.push('--bitrate', String(s.bitrate || 20000));

  // Display mode
  if (s.displayMode === 'window') {
    args.push('--windowed');
  } else if (s.displayMode === 'borderless') {
    args.push('--borderless');
  } else {
    args.push('--fullscreen');
  }

  // VSync
  if (s.vsync) {
    args.push('--vsync');
  } else {
    args.push('--novsync');
  }

  // Audio
  if (s.audio === 'surround') {
    args.push('--surround');
  }

  // Mute host speakers
  if (s.muteHost) {
    args.push('--mute-host-speakers');
  }

  moonlightProcess = spawn(exePath, args, {
    detached: false,
    windowsHide: false,
  });

  moonlightProcess.on('error', (err) => console.error('[Moonlight] error:', err));
  moonlightProcess.on('exit', (code) => {
    moonlightProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send('moonlight:exited', { code });
    }
  });
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

function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const mainW = Math.round(screenW * 0.75);
  const mainH = Math.round(screenH * 0.75);

  mainWindow = new BrowserWindow({
    width:     mainW,
    height:    mainH,
    minWidth:  860,
    minHeight: 600,
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

  mainWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

  mainWindow.webContents.on('console-message', (_, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[Dashboard:${tag}] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api:disconnect', async () => {
  try {
    if (auth.accessToken) {
      await authedRequest('POST', '/api/session/disconnect').catch(() => {});
    }
  } catch (_) {}
  killMoonlight();
  return { ok: true };
});

ipcMain.handle('api:keepAlive', async () => {
  // Kill Moonlight without calling backend disconnect
  killMoonlight();
  return { ok: true };
});

// ─── IPC: Moonlight ───────────────────────────────────────────────────────────
ipcMain.handle('moonlight:launch', async (_, host) => {
  try {
    const settings = loadSettings();
    launchMoonlight(host, settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
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
