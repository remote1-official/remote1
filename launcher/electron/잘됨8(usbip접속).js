'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawn, execFile, execSync } = require('child_process');
const fs = require('fs');

// ─── 관리자 권한 체크 → 없으면 관리자로 재실행 ──────────────────────────────
function isAdmin() {
  try { execSync('net session', { windowsHide: true, stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}
const isPackaged = app.isPackaged;
if (!isAdmin() && isPackaged) {
  // 빌드된 exe일 때만 관리자 재실행 (개발 모드에서는 스킵)
  const { spawn: spawnProc } = require('child_process');
  spawnProc('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Start-Process -FilePath '${process.execPath}' -ArgumentList '${process.argv.slice(1).join("','")}' -Verb RunAs`
  ], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

// ─── 중복 실행 방지 ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ─── 깜빡임 방지 ─────────────────────────────────────────────────────────────
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://project-six-sable-26.vercel.app';

const MOONLIGHT_PATHS = [
  // 1순위: 런처 번들 REMOTE1 (설치 불필요, 개발 모드)
  path.join(__dirname, '..', 'resources', 'REMOTE1', 'REMOTE1.exe'),
  // 1순위: 런처 번들 REMOTE1 (빌드 패키징 후)
  path.join(process.resourcesPath || '', 'resources', 'REMOTE1', 'REMOTE1.exe'),
  // 2순위: 시스템 설치된 Moonlight (폴백)
  path.join('C:', 'Program Files', 'Moonlight Game Streaming', 'Moonlight.exe'),
  path.join('C:', 'Program Files (x86)', 'Moonlight Game Streaming', 'Moonlight.exe'),
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
let usbToggleWindow = null;         // USB/IP 토글 플로팅 버튼
let moonlightProcess = null;
let moonlightTitlePollTimer = null;

const auth = { accessToken: null, user: null, refreshToken: null };

let isMuted      = false;
let mouseGrabbed = false;
let moonlightHwnd = null;          // Moonlight 창 핸들 (캐시)
let moonlightSavedBounds = null;   // 전체화면 전 원래 위치/크기
let isAutoPairing = false;         // 자동 페어링 중 플래그
let pendingUsbDevices = null;     // 가상USB: 스트리밍 연결 후 bind할 장치 목록
let pendingUsbHost = null;        // 가상USB: 접속 대상 호스트
let usbipReleased = false;        // 가상USB: 마우스/키보드 해제 상태 (토글)
let lastBoundDevices = null;       // 가상USB: 마지막 attach한 장치 목록 (re-attach용)
let currentStreamHost = null;     // 현재 스트리밍 중인 PC방 PC IP

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

// ─── AntiHooking.dll 자동 배포 ───────────────────────────────────────────────
function ensureAntiHooking() {
  const exePath = findMoonlightExe();
  if (!exePath) return;

  const moonlightDir = path.dirname(exePath);
  const dest = path.join(moonlightDir, 'AntiHooking.dll');

  // 이미 존재하면 스킵
  if (fs.existsSync(dest)) {
    console.log('[AntiHooking] 이미 존재:', dest);
    return;
  }

  // 소스: 런처 리소스 폴더 또는 RePC 폴더
  const sources = [
    path.join(__dirname, '..', 'resources', 'AntiHooking.dll'),
    path.join(__dirname, 'AntiHooking.dll'),
    'C:\\Program Files\\RePC\\AntiHooking.dll',
  ];

  for (const src of sources) {
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
        console.log('[AntiHooking] 복사 완료:', src, '→', dest);
        return;
      } catch (err) {
        console.log('[AntiHooking] 복사 실패:', err.message);
      }
    }
  }
  console.log('[AntiHooking] DLL 소스를 찾을 수 없음');
}

// ─── USB/IP 가상 USB 공유 ────────────────────────────────────────────────────
const USBIPD_EXE = (() => {
  // 1순위: 한글 없는 시스템 경로
  const system = 'C:\\Program Files\\usbipd-win\\usbipd.exe';
  if (fs.existsSync(system)) return system;
  // 2순위: 런처 번들
  const bundled = path.join(__dirname, '..', 'resources', 'usbipd', 'usbipd.exe');
  if (fs.existsSync(bundled)) return bundled;
  return null;
})();

let usbipdServerProc = null;

// USB 장치 목록 조회 (마우스/키보드만 필터링)
function usbipListDevices() {
  return new Promise((resolve) => {
    if (!USBIPD_EXE) { resolve([]); return; }
    execFile(USBIPD_EXE, ['state'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) { console.log('[USBIP] state 실패:', err.message); resolve([]); return; }
      try {
        const state = JSON.parse(stdout);
        const devices = (state.Devices || []).map(d => ({
          busId: d.BusId,
          description: d.Description,
          instanceId: d.InstanceId,
          vid: (d.InstanceId.match(/VID_([0-9A-F]{4})/i) || [])[1] || '',
          pid: (d.InstanceId.match(/PID_([0-9A-F]{4})/i) || [])[1] || '',
          shared: !!d.PersistedGuid,
          connected: !!d.ClientIPAddress,
        }));
        // 입력 장치 필터 (마우스 + 키보드 = HID)
        const inputDevices = devices.filter(d =>
          d.description.includes('입력') ||
          d.description.toLowerCase().includes('input') ||
          d.description.toLowerCase().includes('mouse') ||
          d.description.toLowerCase().includes('keyboard') ||
          d.description.toLowerCase().includes('hid')
        );
        resolve(inputDevices);
      } catch (e) { console.log('[USBIP] JSON 파싱 실패:', e.message); resolve([]); }
    });
  });
}

// 서버 시작 + 장치 일괄 바인드 (관리자면 직접, 아니면 UAC 1번)
function usbipBindAllAndStartServer(busIds) {
  return new Promise((resolve) => {
    if (!USBIPD_EXE) { resolve(false); return; }
    if (isAdmin()) {
      // 관리자 → 직접 실행
      const serverProc = spawn(USBIPD_EXE, ['server'], { windowsHide: true, stdio: 'ignore', detached: true });
      serverProc.unref();
      console.log('[USBIP] 서버 시작 (관리자)');
      let success = true;
      for (const id of busIds) {
        try {
          execSync(`"${USBIPD_EXE}" bind --busid ${id} --force`, { windowsHide: true, timeout: 10000 });
          console.log('[USBIP] bind 성공:', id);
        } catch (e) { console.log('[USBIP] bind 실패:', id, e.message); success = false; }
      }
      resolve(success || busIds.length === 0);
    } else {
      // 비관리자 → PowerShell 스크립트 파일로 UAC 실행 (경로 문제 회피)
      const scriptPath = 'C:\\temp\\usbip-setup.ps1';
      try { if (!fs.existsSync('C:\\temp')) fs.mkdirSync('C:\\temp', { recursive: true }); } catch (_) {}
      const lines = [];
      lines.push(`$exe = '${USBIPD_EXE}'`);
      lines.push(`Start-Process -FilePath $exe -ArgumentList 'server' -WindowStyle Hidden`);
      for (const id of busIds) {
        lines.push(`& $exe bind --busid ${id} --force`);
      }
      fs.writeFileSync(scriptPath, '\ufeff' + lines.join('\r\n'), 'utf8');
      console.log('[USBIP] PS1 스크립트:', scriptPath);

      try {
        execSync(`powershell.exe -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait -WindowStyle Hidden"`, { windowsHide: true, timeout: 30000 });
      } catch (e) { console.log('[USBIP] bind UAC 실패:', e.message); }

      // 검증: 실제 bind 됐는지 확인
      let verified = false;
      try {
        const state = JSON.parse(execSync(`"${USBIPD_EXE}" state`, { windowsHide: true }).toString());
        const bound = (state.Devices || []).filter(d => d.PersistedGuid && busIds.includes(d.BusId));
        verified = bound.length > 0;
        console.log(`[USBIP] bind 검증: ${bound.length}/${busIds.length}개 성공`);
      } catch (e) { console.log('[USBIP] bind 검증 실패:', e.message); }
      resolve(verified);
    }
  });
}

// 장치 언바인드 (공유 해제)
function usbipUnbind(busId) {
  return new Promise((resolve) => {
    if (!USBIPD_EXE) { resolve(false); return; }
    execFile(USBIPD_EXE, ['unbind', '--busid', busId], { windowsHide: true, timeout: 10000 }, (err) => {
      if (err) { console.log('[USBIP] unbind 실패:', busId, err.message); resolve(false); return; }
      console.log('[USBIP] unbind 성공:', busId);
      resolve(true);
    });
  });
}

// usbipd 서버 시작
function usbipStartServer() {
  if (usbipdServerProc) { console.log('[USBIP] 서버 이미 실행 중'); return true; }
  if (!USBIPD_EXE) { console.log('[USBIP] usbipd.exe 없음'); return false; }

  // usbipd server가 이미 Windows 서비스로 실행 중인지 확인
  try {
    const result = execSync('sc query usbipd 2>nul', { windowsHide: true }).toString();
    if (result.includes('RUNNING')) {
      console.log('[USBIP] Windows 서비스로 이미 실행 중');
      return true;
    }
  } catch (_) {}

  // 서버 시작 (이미 관리자 권한)
  try {
    usbipdServerProc = spawn(USBIPD_EXE, ['server'], { windowsHide: true, stdio: 'ignore', detached: true });
    usbipdServerProc.unref();
    usbipdServerProc.on('exit', () => { usbipdServerProc = null; });
    console.log('[USBIP] 서버 시작');
    return true;
  } catch (e) { console.log('[USBIP] 서버 시작 실패:', e.message); return false; }
}

// usbipd 서버 종료
function usbipStopServer() {
  if (usbipdServerProc) {
    try { usbipdServerProc.kill(); } catch (_) {}
    usbipdServerProc = null;
    console.log('[USBIP] 서버 종료');
  }
}

// 가상USB 준비: 장치 검색 + bind + 서버 시작 (스트리밍 전에 호출, UAC 여기서 뜸)
async function usbipPrepare() {
  const t0 = Date.now();
  console.log(`[USBIP] ========== PREPARE 시작 ==========`);
  console.log(`[USBIP] usbipd.exe 경로: ${USBIPD_EXE}`);
  console.log(`[USBIP] 관리자 권한: ${isAdmin()}`);

  const steps = [];
  const notify = (step, status) => {
    steps.push({ step, status });
    console.log(`[USBIP] [${step}] ${status}`);
    if (mainWindow) mainWindow.webContents.send('usbip:progress', { step, status, steps });
  };

  // 1) 장치 검색
  notify('장치 검색', 'loading');
  const devices = await usbipListDevices();
  console.log(`[USBIP] 검색된 장치: ${JSON.stringify(devices, null, 2)}`);
  if (devices.length === 0) {
    notify('장치 검색', 'error');
    return { ok: false, error: 'USB 입력 장치를 찾을 수 없습니다' };
  }
  notify('장치 검색', `${devices.length}개 발견`);

  // 2) 서버 시작 + bind (UAC 팝업 — 스트리밍 전이라 마우스 정상)
  notify('USB 서버+바인드', 'loading');
  const toBind = devices.filter(d => !d.shared).map(d => d.busId);
  console.log(`[USBIP] bind 대상: ${toBind.join(', ') || '(모두 이미 shared)'}`);
  const ok = await usbipBindAllAndStartServer(toBind);
  if (!ok) {
    notify('USB 서버+바인드', 'error');
    return { ok: false, error: 'USB 서버/바인드 실패 — UAC 허용 필요' };
  }
  notify('USB 서버+바인드', 'ok');

  // 3) 서버가 3240 포트에서 실제로 리스닝하는지 확인
  try {
    const netstat = execSync('netstat -an | findstr ":3240"', { windowsHide: true, timeout: 5000 }).toString();
    console.log(`[USBIP] 3240포트 리스닝 확인:\n${netstat.trim()}`);
  } catch (_) {
    console.log('[USBIP] ⚠️ 3240 포트가 리스닝 상태가 아닙니다! usbipd 서버 확인 필요');
  }

  // 4) bind 상태 최종 확인
  try {
    const state = JSON.parse(execSync(`"${USBIPD_EXE}" state`, { windowsHide: true }).toString());
    const shared = (state.Devices || []).filter(d => d.PersistedGuid);
    console.log(`[USBIP] bind된 장치: ${shared.map(d => `${d.BusId}(${d.Description})`).join(', ')}`);
  } catch (_) {}

  console.log(`[USBIP] ========== PREPARE 완료 (${Date.now() - t0}ms) ==========`);
  pendingUsbDevices = devices;
  return { ok: true, devices };
}

// 모니터 attach (bind 완료 후 호출)
async function usbipActivate(host) {
  const t0 = Date.now();
  const devices = pendingUsbDevices || [];
  console.log(`[USBIP] ========== ACTIVATE 시작 ==========`);
  console.log(`[USBIP] host: ${host}, 장치: ${devices.length}개`);
  console.log(`[USBIP] 장치 목록: ${JSON.stringify(devices.map(d => ({ busId: d.busId, desc: d.description })))}`);
  if (devices.length === 0) { console.log('[USBIP] 장치 없음!'); return { ok: false, error: '준비된 USB 장치 없음' }; }

  const notify = (step, status) => {
    console.log(`[USBIP] [${step}] ${status}`);
    if (mainWindow) mainWindow.webContents.send('usbip:progress', { step, status });
  };

  // 2) 모니터에 attach 요청
  notify('PC방 PC 연결', 'loading');
  console.log(`[USBIP] 모니터 ${host}:47991/usbip 에 attach 요청 전송...`);
  const attachOk = await requestMonitorAttach(host, devices);
  console.log(`[USBIP] 모니터 응답: ${attachOk ? '성공' : '실패'} (${Date.now() - t0}ms)`);
  if (!attachOk) {
    notify('PC방 PC 연결', 'error');
    // 연결 실패 시 USB 즉시 정리 (마우스/키보드 컴1으로 복귀)
    console.log('[USBIP] 연결 실패 → USB 정리 시작');
    pendingUsbHost = host;
    await usbipCleanup();
    return { ok: false, error: 'PC방 PC USB 연결 실패' };
  }
  notify('PC방 PC 연결', 'ok');

  pendingUsbDevices = null;
  pendingUsbHost = host;  // cleanup 시 detach 요청에 필요
  lastBoundDevices = devices;  // re-attach용 장치 목록 저장
  usbipReleased = false;
  console.log(`[USBIP] ========== ACTIVATE 완료 (${Date.now() - t0}ms) ==========`);
  return { ok: true, devices };
}

// 레거시 호환: 기존 usbipConnect (일반 흐름용, UAC 1번)
async function usbipConnect(host) {
  const prep = await usbipPrepare();
  if (!prep.ok) return prep;
  pendingUsbHost = host;
  return await usbipActivate(host);
}

// 모니터에 USB attach 요청 전송
function requestMonitorAttach(host, devices) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const postData = JSON.stringify({
      action: 'usbip-attach',
      devices: devices.map(d => ({ busId: d.busId, vid: d.vid, pid: d.pid, description: d.description })),
    });
    console.log(`[USBIP] POST → http://${host}:47991/usbip`);
    console.log(`[USBIP] body: ${postData}`);
    const req = http.request({
      hostname: host,
      port: 47991,
      path: '/usbip',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        console.log(`[USBIP] 모니터 응답 (${Date.now() - t0}ms): status=${res.statusCode}, body=${body}`);
        try { resolve(JSON.parse(body).ok === true); }
        catch (_) { console.log('[USBIP] 응답 파싱 실패'); resolve(false); }
      });
    });
    req.on('error', (e) => { console.log(`[USBIP] ⚠️ 모니터 연결 에러 (${Date.now() - t0}ms): ${e.message}`); resolve(false); });
    req.on('timeout', () => { console.log(`[USBIP] ⚠️ 모니터 타임아웃 (${Date.now() - t0}ms)`); req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

// 모니터에 USB detach 요청 전송
function requestMonitorDetach(host) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ action: 'usbip-detach' });
    console.log(`[USBIP] 모니터 ${host}:47991 에 detach 요청 전송...`);
    const req = http.request({
      hostname: host,
      port: 47991,
      path: '/usbip',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        console.log(`[USBIP] detach 응답: ${body}`);
        resolve(true);
      });
    });
    req.on('error', (e) => { console.log(`[USBIP] detach 요청 실패: ${e.message}`); resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

// USB/IP 정리 (스트리밍 종료 시)
async function usbipCleanup() {
  console.log('[USBIP] ========== CLEANUP 시작 ==========');
  const host = pendingUsbHost;
  pendingUsbDevices = null;
  pendingUsbHost = null;

  // 시스템 소리 임시 음소거 (USB 분리 소리 방지)
  try { execSync('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"', { windowsHide: true, timeout: 2000 }); } catch (_) {}
  const unmute = () => { try { execSync('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"', { windowsHide: true, timeout: 2000 }); } catch (_) {} };

  // 1) 모니터에 detach 요청 (컴2에서 USB 장치 분리)
  if (host) {
    await requestMonitorDetach(host);
  }

  // 2) 일괄 unbind (컴1에서 USB 공유 해제)
  const devices = await usbipListDevices();
  const toUnbind = devices.filter(d => d.shared).map(d => d.busId);
  if (toUnbind.length > 0) {
    if (isAdmin()) {
      for (const id of toUnbind) {
        try {
          execSync(`"${USBIPD_EXE}" unbind --busid ${id}`, { windowsHide: true, timeout: 10000 });
          console.log('[USBIP] unbind 성공:', id);
        } catch (e) { console.log('[USBIP] unbind 실패:', id, e.message); }
      }
    } else {
      const lines = toUnbind.map(id => `& "${USBIPD_EXE.replace(/\\/g, '\\\\')}" unbind --busid ${id}`);
      const scriptPath = path.join(app.getPath('temp'), 'usbip-cleanup.ps1');
      fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
      try {
        execSync(`powershell.exe -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait -WindowStyle Hidden"`, { windowsHide: true, timeout: 15000 });
        console.log('[USBIP] unbind 성공 (UAC):', toUnbind.join(', '));
      } catch (e) { console.log('[USBIP] unbind 실패:', e.message); }
    }
  }
  usbipStopServer();
  // 소리 복원 (1초 후)
  setTimeout(unmute, 1000);
  console.log('[USBIP] ========== CLEANUP 완료 ==========');
}

function killMoonlight() {
  if (moonlightProcess) {
    try { moonlightProcess.kill(); } catch (_) {}
    moonlightProcess = null;
  }
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /IM REMOTE1.exe 2>nul', { windowsHide: true }); } catch (_) {}
    try { execSync('taskkill /F /IM Moonlight.exe 2>nul', { windowsHide: true }); } catch (_) {}
  }
}

// ─── 자동 페어링 (UI Automation으로 PIN 읽기) ────────────────────────────────
function sendPinToMonitor(host, pin) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ pin });
    const req = http.request({
      hostname: host,
      port: 47991,
      path: '/pin',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body).ok === true); }
        catch (_) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

const PIN_EXCLUDE = ['2060','2070','2080','3060','3070','3080','3090','4060','4070','4080','4090'];

function readPinFromDialog() {
  return new Promise((resolve) => {
    const psScript = [
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      '$auto = [System.Windows.Automation.AutomationElement]',
      '$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Moonlight")',
      '$wins = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)',
      'foreach ($win in $wins) {',
      '  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
      '  foreach ($el in $all) {',
      '    $name = $el.Current.Name',
      '    if ($name) { Write-Output $name }',
      '  }',
      '}',
    ].join('\n');

    const scriptPath = path.join(app.getPath('temp'), 'r1_pin.ps1');
    fs.writeFileSync(scriptPath, psScript, 'utf8');

    execFile('powershell.exe',
      ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        try { fs.unlinkSync(scriptPath); } catch (_) {}
        const text = (stdout || '');
        console.log('[AutoPair] Dialog text:', text.trim().substring(0, 200));

        const match = text.match(/\b(\d{4})\b/g);
        if (match) {
          for (const candidate of match) {
            if (!PIN_EXCLUDE.includes(candidate)) {
              resolve(candidate);
              return;
            }
          }
        }
        resolve(null);
      }
    );
  });
}

function autoPair(host) {
  return new Promise((resolve) => {
    const exePath = findMoonlightExe();
    if (!exePath) { resolve(false); return; }

    console.log('[AutoPair] moonlight pair 시작 (GUI):', host);
    const pairProc = spawn(exePath, ['pair', host], {
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pairProc.stdout.on('data', (d) => console.log('[AutoPair]', d.toString().trim()));
    pairProc.stderr.on('data', (d) => console.log('[AutoPair]', d.toString().trim()));

    let pinSent = false;

    const pinPoll = setInterval(async () => {
      if (pinSent) return;

      const pin = await readPinFromDialog();
      if (pin) {
        pinSent = true;
        clearInterval(pinPoll);
        console.log('[AutoPair] PIN 발견:', pin);

        const ok = await sendPinToMonitor(host, pin);
        console.log('[AutoPair] 모니터 PIN 전송:', ok ? '성공' : '실패');

        // PIN 전송 성공하면 pair 프로세스 즉시 종료
        if (ok) {
          setTimeout(() => {
            if (pairProc && !pairProc.killed) {
              try { pairProc.kill(); } catch (_) {}
              console.log('[AutoPair] pair 프로세스 강제 종료');
            }
          }, 1000);
        }
      }
    }, 1000);

    const timeout = setTimeout(() => {
      clearInterval(pinPoll);
      if (pairProc && !pairProc.killed) {
        try { pairProc.kill(); } catch (_) {}
      }
      resolve(pinSent);
    }, 30000);

    pairProc.on('exit', (code) => {
      clearTimeout(timeout);
      clearInterval(pinPoll);
      console.log('[AutoPair] pair 종료 (code=' + code + ')');
      resolve(code === 0 || pinSent);
    });
  });
}

function launchMoonlight(host, settings) {
  const exePath = findMoonlightExe();
  if (!exePath) {
    throw new Error(
      'REMOTE1 스트리밍 모듈이 설치되어 있지 않습니다.\n\n런처를 재설치해주세요.'
    );
  }

  ensureAntiHooking();
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
    if (mainWindow && !isAutoPairing) {
      mainWindow.webContents.send('moonlight:exited', { code });
    }
  });
}

// ─── Moonlight 창 타이틀 감지 (스트리밍 연결 완료 감지) ──────────────────────
const SIDEBAR_WIDTH = 220;

let moonlightTitlePhase = 'waiting'; // 'waiting' | 'loading' | 'done'

function setMoonlightTitle(hwnd, title) {
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class WT{[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern bool SetWindowText(IntPtr h,string t);}';` +
    `[WT]::SetWindowText([IntPtr]${hwnd},"${title}")`
  ], { windowsHide: true, timeout: 2000 }, () => {});
}

function hideMoonlightWindow(hwnd) {
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class SW{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}';` +
    `[SW]::ShowWindow([IntPtr]${hwnd},0)`
  ], { windowsHide: true, timeout: 2000 }, () => {});
}

function showMoonlightWindow(hwnd) {
  execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type 'using System;using System.Runtime.InteropServices;public class SW{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}';` +
    `[SW]::ShowWindow([IntPtr]${hwnd},5);[SW]::SetForegroundWindow([IntPtr]${hwnd})`
  ], { windowsHide: true, timeout: 2000 }, () => {});
}

function setMoonlightIcon(hwnd) {
  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico').replace(/\\/g, '\\\\');
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class ICO {',
    '  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern IntPtr LoadImage(IntPtr inst, string name, uint type, int cx, int cy, uint flags);',
    '  public static void SetIcon(IntPtr hwnd, string path) {',
    '    IntPtr big = LoadImage(IntPtr.Zero, path, 1, 32, 32, 0x10);',
    '    IntPtr small = LoadImage(IntPtr.Zero, path, 1, 16, 16, 0x10);',
    '    if (big != IntPtr.Zero) SendMessage(hwnd, 0x0080, (IntPtr)1, big);',
    '    if (small != IntPtr.Zero) SendMessage(hwnd, 0x0080, IntPtr.Zero, small);',
    '  }',
    '}',
    '"@',
    `[ICO]::SetIcon([IntPtr]${hwnd}, "${icoPath}")`,
  ].join('\n');

  const scriptPath = path.join(app.getPath('temp'), 'r1_icon.ps1');
  fs.writeFileSync(scriptPath, script, 'utf8');
  execFile('powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true, timeout: 5000 },
    () => { try { fs.unlinkSync(scriptPath); } catch (_) {} }
  );
}

function startMoonlightTitlePoll() {
  stopMoonlightTitlePoll();
  moonlightTitlePhase = 'waiting';
  console.log('[TitlePoll] Started polling...');

  moonlightTitlePollTimer = setInterval(() => {
    if (!moonlightProcess) {
      stopMoonlightTitlePoll();
      return;
    }

    const cmd = [
      '$p = Get-Process REMOTE1,Moonlight -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1;',
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

      if (!hwnd || hwnd === '0') return;

      if (title && (title.includes(' - Moonlight') || title.includes(' - REMOTE1'))) {
        // 스트리밍 연결 완료 → 이 HWND가 진짜 스트리밍 창
        console.log('[TitlePoll] Streaming connected! Title:', title, 'HWND:', hwnd);
        moonlightHwnd = hwnd;
        setMoonlightTitle(hwnd, 'REMOTE1');
        setMoonlightIcon(hwnd);
        moonlightTitlePhase = 'done';
        stopMoonlightTitlePoll();
        if (mainWindow) {
          mainWindow.webContents.send('moonlight:streamConnected');
        }
        // 가상USB: 스트리밍 연결 확인 후 bind + attach 실행 (1회만)
        const usbHost = pendingUsbHost;
        const usbDevices = pendingUsbDevices;
        pendingUsbDevices = null;  // 중복 호출 방지 (host는 유지)
        if (usbDevices && usbHost) {
          console.log('[USBIP] 스트리밍 연결 확인됨 → USB bind+attach 시작');
          usbipActivate(usbHost).then(r => {
            console.log('[USBIP] activate 결과:', JSON.stringify(r));
            if (mainWindow) mainWindow.webContents.send('usbip:activated', r);
          }).catch(e => {
            console.log('[USBIP] activate 실패:', e.message);
            if (mainWindow) mainWindow.webContents.send('usbip:activated', { ok: false, error: e.message });
          });
        }
      } else if (moonlightTitlePhase === 'waiting') {
        // 로딩 중 — 제목만 변경, HWND는 아직 저장 안 함 (스트리밍 창이 아닐 수 있음)
        moonlightTitlePhase = 'loading';
        setMoonlightTitle(hwnd, 'REMOTE1 - 접속중');
        setMoonlightIcon(hwnd);
        console.log('[TitlePoll] Loading phase, title set (was:', title, ')');
        console.log('[TitlePoll] Set title "REMOTE1 - 접속중" (was:', title, ')');
      }
    });
  }, 300);
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
// (USB/IP 기능은 위쪽 usbipConnect / usbipCleanup 으로 대체됨)

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
        mainWindow.webContents.openDevTools({ mode: 'detach' });
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

// ─── 원격 PC 명령 전송 (모니터 API) ──────────────────────────────────────────
function sendRemoteCmd(action) {
  if (!currentStreamHost) { console.log('[RemoteCmd] 스트리밍 중이 아님'); return; }
  const postData = JSON.stringify({ action });
  const req = http.request({
    hostname: currentStreamHost,
    port: 47991,
    path: '/remote-cmd',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 5000,
  }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => console.log('[RemoteCmd]', action, '응답:', body));
  });
  req.on('error', (e) => console.log('[RemoteCmd]', action, '실패:', e.message));
  req.on('timeout', () => { req.destroy(); });
  req.write(postData);
  req.end();
}

// ─── 원격 단축키 수신 서버 (컴2 모니터 → 컴1 런처) ──────────────────────────
let shortcutServer = null;

function startShortcutServer() {
  if (shortcutServer) return;

  shortcutServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/shortcut') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { key } = JSON.parse(body);
          console.log(`[RemoteKey] 수신: Ctrl+Alt+${key}`);
          handleRemoteShortcut(key);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      });
    } else {
      res.writeHead(404); res.end();
    }
  });

  shortcutServer.listen(47992, '0.0.0.0', () => {
    console.log('[RemoteKey] 단축키 수신 서버 시작 — 포트 47992');
  });
  shortcutServer.on('error', (err) => {
    console.log(`[RemoteKey] 서버 에러: ${err.message}`);
  });
}

function stopShortcutServer() {
  if (shortcutServer) {
    shortcutServer.close();
    shortcutServer = null;
    console.log('[RemoteKey] 단축키 수신 서버 종료');
  }
}

function handleRemoteShortcut(key) {
  switch (key) {
    case 'F1':
      mainWindow?.webContents.send('shortcut:fired', 'toggleSidebar');
      break;
    case 'F2':
      mainWindow?.webContents.send('shortcut:fired', 'fullscreen');
      break;
    case 'F3':
      mainWindow?.webContents.send('shortcut:fired', 'windowedFull');
      break;
    case 'F4':
      mainWindow?.webContents.send('shortcut:fired', 'quit');
      break;
    case 'F5':
      isMuted = !isMuted;
      mainWindow?.webContents.send('shortcut:fired', 'mute');
      break;
    case 'F6':
      mouseGrabbed = !mouseGrabbed;
      mainWindow?.webContents.send('shortcut:fired', 'mouseGrab');
      break;
    case 'F7':
      console.log('[RemoteKey] F7 — 원격 작업관리자');
      sendRemoteCmd('taskmgr');
      break;
    case 'F8':
      console.log('[RemoteKey] F8 — 원격 Alt+Tab');
      sendRemoteCmd('alt-tab');
      break;
    case 'F9':
      console.log('[RemoteKey] F9 — 컴1 바탕화면 전환');
      toggleShowDesktop();
      break;
  }
}

let desktopShown = false;

function toggleShowDesktop() {
  if (!desktopShown) {
    // Moonlight 최소화 → 컴1 바탕화면 표시
    console.log('[F9] Moonlight 최소화 → 컴1 바탕화면');
    execFile('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      '(New-Object -ComObject Shell.Application).MinimizeAll()'
    ], { windowsHide: true }, () => {});
    desktopShown = true;
  } else {
    // Moonlight 복원
    console.log('[F9] Moonlight 복원');
    execFile('powershell.exe', [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      '(New-Object -ComObject Shell.Application).UndoMinimizeAll()'
    ], { windowsHide: true }, () => {});
    desktopShown = false;
  }
}

async function handleUsbToggle() {
  const host = pendingUsbHost;
  if (!host) {
    console.log('[USBIP Toggle] 활성 USB/IP 연결 없음');
    return;
  }
  if (!usbipReleased) {
    // 컴2 → 컴1: detach + unbind (마우스/키보드 컴1 복귀)
    console.log('[USBIP Toggle] 해제 → 컴1으로 전환');
    await requestMonitorDetach(host);
    // unbind하여 컴1에서 마우스/키보드 사용 가능하게 (UAC 필요)
    if (lastBoundDevices) {
      const busIds = lastBoundDevices.map(d => d.busId);
      if (isAdmin()) {
        for (const id of busIds) {
          try {
            execSync(`"${USBIPD_EXE}" unbind --busid ${id}`, { windowsHide: true, timeout: 5000 });
            console.log(`[USBIP Toggle] unbind ${id}`);
          } catch (_) {}
        }
      } else {
        const lines = busIds.map(id => `& "${USBIPD_EXE.replace(/\\/g, '\\\\')}" unbind --busid ${id}`);
        const scriptPath = path.join(app.getPath('temp'), 'usbip-toggle-unbind.ps1');
        fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
        try {
          execSync(`powershell.exe -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait -WindowStyle Hidden"`, { windowsHide: true, timeout: 15000 });
          console.log(`[USBIP Toggle] unbind 성공 (UAC): ${busIds.join(', ')}`);
        } catch (e) { console.log(`[USBIP Toggle] unbind 실패: ${e.message}`); }
      }
    }
    usbipReleased = true;
    console.log('[USBIP Toggle] 컴1 모드 (unbind 완료)');
    if (mainWindow) mainWindow.webContents.send('shortcut:fired', 'usbRelease');
  } else {
    // 컴1 → 컴2: bind + attach (마우스/키보드 컴2로)
    console.log('[USBIP Toggle] 재연결 → 컴2로 전환');
    if (lastBoundDevices && lastBoundDevices.length > 0) {
      const busIds = lastBoundDevices.map(d => d.busId);
      // re-bind (서버는 이미 실행 중, UAC 필요)
      if (isAdmin()) {
        for (const id of busIds) {
          try {
            execSync(`"${USBIPD_EXE}" bind --busid ${id} --force`, { windowsHide: true, timeout: 5000 });
            console.log(`[USBIP Toggle] bind ${id}`);
          } catch (_) {}
        }
      } else {
        const lines = busIds.map(id => `& "${USBIPD_EXE.replace(/\\/g, '\\\\')}" bind --busid ${id} --force`);
        const scriptPath = path.join(app.getPath('temp'), 'usbip-toggle-bind.ps1');
        fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
        try {
          execSync(`powershell.exe -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait -WindowStyle Hidden"`, { windowsHide: true, timeout: 15000 });
          console.log(`[USBIP Toggle] bind 성공 (UAC): ${busIds.join(', ')}`);
        } catch (e) { console.log(`[USBIP Toggle] bind 실패: ${e.message}`); }
      }
      // 잠시 대기 후 attach
      await new Promise(r => setTimeout(r, 500));
      const ok = await requestMonitorAttach(host, lastBoundDevices);
      if (ok) {
        usbipReleased = false;
        console.log('[USBIP Toggle] 컴2 모드');
        if (mainWindow) mainWindow.webContents.send('shortcut:fired', 'usbReattach');
      } else {
        console.log('[USBIP Toggle] 재연결 실패 — unbind 복원');
        for (const id of busIds) {
          try { execSync(`"${USBIPD_EXE}" unbind --busid ${id}`, { windowsHide: true, timeout: 5000 }); } catch (_) {}
        }
      }
    }
  }
}

// ─── USB/IP 플로팅 토글 버튼 ─────────────────────────────────────────────────
function createUsbToggleWindow() {
  if (usbToggleWindow) { usbToggleWindow.show(); return; }

  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  usbToggleWindow = new BrowserWindow({
    width: 48,
    height: 48,
    x: width - 60,
    y: 12,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });

  usbToggleWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html><html><head><style>
  * { margin:0; padding:0; -webkit-app-region: drag; }
  body { background: transparent; display:flex; align-items:center; justify-content:center; height:100vh; }
  .btn {
    width:42px; height:42px; border-radius:50%; border:2px solid rgba(255,255,255,0.3);
    background:rgba(0,180,80,0.85); color:#fff; font-size:18px; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    -webkit-app-region: no-drag; transition: background 0.2s;
  }
  .btn:hover { background:rgba(0,200,100,0.95); transform:scale(1.1); }
  .btn.released { background:rgba(220,60,60,0.85); }
  .btn.released:hover { background:rgba(240,80,80,0.95); }
</style></head><body>
  <button class="btn" id="toggle" title="USB/IP 토글 (마우스/키보드 전환)">&#x1F5B1;</button>
  <script>
    const btn = document.getElementById('toggle');
    let released = false;
    btn.addEventListener('click', () => {
      window.R1?.invoke('usbip-toggle');
    });
    window.R1?.on('usbip:toggleState', (state) => {
      released = state.released;
      btn.classList.toggle('released', released);
      btn.title = released ? 'USB: 컴1 (클릭→컴2)' : 'USB: 컴2 (클릭→컴1)';
    });
  </script>
</body></html>
  `)}`);

  usbToggleWindow.on('closed', () => { usbToggleWindow = null; });
}

function destroyUsbToggleWindow() {
  if (usbToggleWindow) { usbToggleWindow.close(); usbToggleWindow = null; }
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

  // Ctrl+Alt+F7 — 원격 PC 작업관리자 열기
  globalShortcut.register('CommandOrControl+Alt+F7', () => {
    console.log('[Shortcut] F7 — 원격 작업관리자');
    sendRemoteCmd('taskmgr');
  });

  // Ctrl+Alt+F8 — 원격 PC Alt+Tab (게임 밖으로 나가기)
  globalShortcut.register('CommandOrControl+Alt+F8', () => {
    console.log('[Shortcut] F8 — 원격 Alt+Tab');
    sendRemoteCmd('alt-tab');
  });

  // Ctrl+Alt+F9 — USB/IP 토글 (컴1 ↔ 컴2 마우스/키보드 전환)
  globalShortcut.register('CommandOrControl+Alt+F9', async () => {
    const host = pendingUsbHost;
    if (!host) {
      console.log('[USBIP] 활성 USB/IP 연결 없음');
      return;
    }

    if (!usbipReleased) {
      // 컴2 → 컴1: detach하여 마우스/키보드를 컴1으로 복귀
      console.log('[Shortcut] F9 — USB/IP 해제 (컴1으로 전환)');
      await requestMonitorDetach(host);
      usbipReleased = true;
      console.log('[USBIP] 마우스/키보드 해제 완료 — 컴1 모드');
      if (mainWindow) mainWindow.webContents.send('shortcut:fired', 'usbRelease');
    } else {
      // 컴1 → 컴2: re-attach하여 마우스/키보드를 컴2로 전달
      console.log('[Shortcut] F9 — USB/IP 재연결 (컴2로 전환)');
      if (lastBoundDevices && lastBoundDevices.length > 0) {
        const ok = await requestMonitorAttach(host, lastBoundDevices);
        if (ok) {
          usbipReleased = false;
          console.log('[USBIP] 마우스/키보드 재연결 완료 — 컴2 모드');
          if (mainWindow) mainWindow.webContents.send('shortcut:fired', 'usbReattach');
        } else {
          console.log('[USBIP] 재연결 실패');
        }
      } else {
        console.log('[USBIP] 재연결할 장치 정보 없음');
      }
    }
  });

}

function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createLoginWindow();
  startShortcutServer();
});

app.on('window-all-closed', () => {
  unregisterGlobalShortcuts();
  stopShortcutServer();
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
    currentStreamHost = host;
    const settings = loadSettings();

    // 기존 Moonlight 프로세스 완전 정리
    killMoonlight();
    try { execSync('taskkill /F /IM REMOTE1.exe 2>nul', { windowsHide: true }); } catch (_) {}
    try { execSync('taskkill /F /IM Moonlight.exe 2>nul', { windowsHide: true }); } catch (_) {}

    // 1) Moonlight stream 실행 → "not been paired" 감지
    launchMoonlight(host, settings);

    const pairNeeded = await new Promise((resolve) => {
      let detected = false;

      const checkPair = (data) => {
        if (data.toString().includes('not been paired') && !detected) {
          detected = true;
          isAutoPairing = true;  // 즉시 플래그 설정 (exited 이벤트 차단)
          resolve(true);
        }
      };

      if (moonlightProcess) {
        moonlightProcess.stdout.on('data', checkPair);
        moonlightProcess.stderr.on('data', checkPair);
        moonlightProcess.on('exit', () => {
          setTimeout(() => { if (!detected) resolve(false); }, 500);
        });
      }

      setTimeout(() => { if (!detected) resolve(false); }, 3000);
    });

    if (pairNeeded) {
      console.log('[Launch] 페어링 안됨 → 자동 페어링 시도');
      isAutoPairing = true;
      killMoonlight();

      let paired = false;
      for (let i = 1; i <= 3; i++) {
        console.log(`[Launch] 페어링 시도 ${i}/3`);
        paired = await autoPair(host);
        if (paired) break;
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!paired) {
        isAutoPairing = false;
        return { ok: false, error: '자동 페어링에 실패했습니다. Sunshine 설정을 확인해주세요.' };
      }

      console.log('[Launch] 페어링 성공 → Moonlight 잔여 프로세스 정리');
      isAutoPairing = false;
      // pair 프로세스 포함 Moonlight 전부 kill 후 재실행
      try { execSync('taskkill /F /IM REMOTE1.exe 2>nul', { windowsHide: true }); } catch (_) {}
      try { execSync('taskkill /F /IM Moonlight.exe 2>nul', { windowsHide: true }); } catch (_) {}
      moonlightHwnd = null;
      await new Promise(r => setTimeout(r, 2000));
      console.log('[Launch] 스트리밍 시작');
      launchMoonlight(host, settings);
    }

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
// ─── IPC: USB/IP 가상 USB ────────────────────────────────────────────────────
ipcMain.handle('usbip:listDevices', async () => {
  const devices = await usbipListDevices();
  return { ok: true, devices };
});

ipcMain.handle('usbip:connect', async (_, host) => {
  // [테스트] USB/IP 비활성화 — Moonlight 가상 입력만 사용
  console.log('[USBIP] 비활성화됨 — 가상 입력 테스트 모드');
  currentStreamHost = host;
  return { ok: true, devices: [] };
});

ipcMain.handle('usbip:disconnect', async () => {
  await usbipCleanup();
  return { ok: true };
});

// USB/IP 토글 (플로팅 버튼에서 호출)
ipcMain.handle('usbip-toggle', async () => {
  const host = pendingUsbHost;
  if (!host) {
    console.log('[USBIP Toggle] 활성 USB/IP 연결 없음');
    return { ok: false };
  }

  if (!usbipReleased) {
    console.log('[USBIP Toggle] 해제 → 컴1으로 전환');
    await requestMonitorDetach(host);
    usbipReleased = true;
    console.log('[USBIP Toggle] 컴1 모드');
  } else {
    console.log('[USBIP Toggle] 재연결 → 컴2로 전환');
    if (lastBoundDevices && lastBoundDevices.length > 0) {
      const ok = await requestMonitorAttach(host, lastBoundDevices);
      if (ok) {
        usbipReleased = false;
        console.log('[USBIP Toggle] 컴2 모드');
      } else {
        console.log('[USBIP Toggle] 재연결 실패');
        return { ok: false };
      }
    }
  }

  // 토글 상태를 플로팅 버튼에 전달
  if (usbToggleWindow) {
    usbToggleWindow.webContents.send('usbip:toggleState', { released: usbipReleased });
  }
  return { ok: true, released: usbipReleased };
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
