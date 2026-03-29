'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { execFile, exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  SERVER_URL: 'https://project-six-sable-26.vercel.app',
  REPORT_INTERVAL: 10000,
  PAIR_POLL_INTERVAL: 500,
  MACHINE_ID: null,
  SUNSHINE_USER: 'skylove441',
  SUNSHINE_PASS: '@Lee76177500',
  SUNSHINE_PORT: 47990,
};

// ─── 중복 실행 방지 ──────────────────────────────────────────────────────────
function checkAlreadyRunning() {
  try {
    const result = execSync('tasklist /FI "IMAGENAME eq DisplayHelper*" /FO CSV /NH', { windowsHide: true }).toString();
    const count = result.split('\n').filter(l => l.includes('DisplayHelper')).length;
    return count > 1; // 자기 자신 포함 2개 이상이면 중복
  } catch (_) { return false; }
}

// ─── 실행 모드 분기 ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--run')) {
  // 백그라운드 모드 — 중복 체크 후 메인 실행
  if (checkAlreadyRunning()) {
    console.log('[Monitor] 이미 실행 중 — 종료');
    process.exit(0);
  }
  startMonitor();
} else if (args.includes('--uninstall')) {
  uninstallMonitor();
  process.exit(0);
} else {
  showMenu();
}

// 기존 헬퍼 프로세스 + 캐시 파일 전부 정리
function cleanupOldHelper() {
  // 자기 자신의 파일명은 제외하고 kill
  const myName = path.basename(process.execPath);
  const names = ['DisplayHelper-v1.0.exe','DisplayHelper-v1.1.exe','DisplayHelper-v1.2.exe','DisplayHelper-v1.3.exe','DisplayHelper-v1.4.exe','DisplayHelper.exe','REMOTE1-Monitor-v1.0.3.exe','REMOTE1-Monitor-v1.0.4.exe','REMOTE1-Monitor-v1.0.5.exe','REMOTE1-Monitor-v1.0.6.exe'];
  for (const name of names) {
    if (name === myName) continue; // 자기 자신 스킵
    try { execSync(`taskkill /F /IM "${name}" 2>nul`, { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  }
  // 이전에 추출된 usbip 파일 정리 (새로 추출하기 위해)
  const destDir = path.dirname(process.execPath);
  for (const f of ['usbip.exe', 'attacher.exe']) {
    const p = path.join(destDir, f);
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`  [정리] ${f} 삭제`); } } catch (_) {}
  }
  console.log('  [OK] 이전 버전 정리 완료');
}

function showMenu() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║   REMOTE1 PC Monitor v1.4        ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');
  // 기존 버전 정리
  cleanupOldHelper();
  // 작업 스케줄러 + 방화벽 등록
  try {
    installMonitor();
  } catch (_) {
    console.log('  [참고] 등록 실패 — 직접 실행 모드');
  }
  // USB/IP 드라이버 자동 설치
  try {
    ensureUsbipDriver();
  } catch (_) {
    console.log('  [참고] USB/IP 드라이버 설치 실패');
  }

  console.log('  모니터를 시작합니다...');
  console.log('');
  startMonitor();
}

function getExePath() { return process.execPath; }

function installMonitor() {
  const exePath = getExePath();
  console.log(`  경로: ${exePath}`);

  // 관리자 권한 체크
  let isAdminMode = false;
  try {
    execSync('net session', { windowsHide: true, stdio: 'ignore' });
    isAdminMode = true;
    console.log('  [OK] 관리자 권한 확인');
  } catch (_) {
    console.log('  [참고] 관리자 권한 없음 — 방화벽/드라이버 등록이 안 될 수 있습니다');
  }

  // 방화벽 인바운드 규칙 자동 등록 (47991 포트)
  try {
    execSync('netsh advfirewall firewall delete rule name="DisplayHelper" >nul 2>&1', { windowsHide: true, stdio: 'ignore' });
    execSync('netsh advfirewall firewall add rule name="DisplayHelper" dir=in action=allow protocol=TCP localport=47991', { windowsHide: true });
    console.log('  [OK] 방화벽 47991 포트 열림');
  } catch (_) {
    console.log('  [참고] 방화벽 등록 실패');
  }

  try {
    try { execSync('schtasks /delete /tn "DisplayHelper" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
    try { execSync('schtasks /delete /tn "REMOTE1-Monitor" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
    const tr = `"${exePath}" --run`;
    execSync(`schtasks /create /tn "DisplayHelper" /tr ${tr} /sc onlogon /rl highest /f`, { windowsHide: true });
    console.log('  [OK] 부팅 시 자동 실행 등록됨');
  } catch (err) {
    console.log('  [참고] 자동 실행 등록 실패');
  }
}

function uninstallMonitor() {
  console.log('');
  try { execSync('taskkill /f /im "DisplayHelper.exe"', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  try { execSync('schtasks /delete /tn "DisplayHelper" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  try { execSync('schtasks /delete /tn "REMOTE1-Monitor" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}

  console.log('  [완료] 모니터 제거 완료');
  console.log('');
}

function startMonitor() {
  main().catch((err) => {
    console.error('[Fatal]', err);
    console.log('오류 발생 — 30초 후 재시도...');
    setTimeout(main, 30000);
  });
}

// 주요 게임/프로그램 목록 (프로세스명 → 표시명)
const APP_MAP = {
  // 게임
  'lineage.bin':         '리니지 클래식',
  'lin.bin':             '리니지',
  'LOSTARK.exe':         '로스트아크',
  'BlackDesert64.exe':   '검은사막',
  'Maplestory.exe':      '메이플스토리',
  'dnf.exe':             '던전앤파이터',
  'suddenattack.exe':    '서든어택',
  'VALORANT-Win64-Shipping.exe': '발로란트',
  'r5apex.exe':          '에이펙스 레전드',
  'PUBG-Win64-Shipping.exe': '배틀그라운드',
  'LeagueClient.exe':    '리그 오브 레전드',
  'League of Legends.exe': '리그 오브 레전드',
  'overwatch.exe':       '오버워치 2',
  'starcraft.exe':       '스타크래프트',
  'StarCraft II.exe':    '스타크래프트 2',
  'csgo.exe':            'CS2',
  'cs2.exe':             'CS2',
  'GenshinImpact.exe':   '원신',
  'Diablo IV.exe':       '디아블로 4',
  'fifa4.exe':           'FC 온라인',
  'FIFAOnline4.exe':     'FC 온라인',
  'minecraft.exe':       '마인크래프트',
  'javaw.exe':           '마인크래프트',
  'Warframe.x64.exe':    '워프레임',
  'Cyphers.exe':         '사이퍼즈',
  'EternalReturn.exe':   '이터널 리턴',

  // 프로그램
  'chrome.exe':          'Chrome',
  'msedge.exe':          'Edge',
  'firefox.exe':         'Firefox',
  'explorer.exe':        null, // 제외
  'svchost.exe':         null, // 제외
  'SearchHost.exe':      null, // 제외
  'cmd.exe':             null, // 제외
  'conhost.exe':         null, // 제외
  'powershell.exe':      null, // 제외
  'TextInputHost.exe':   null, // 제외
  'REMOTE1-모니터.exe':   null, // 자기 자신 제외
  // PC방 기본 프로그램 제외
  'CRAFTBOX.exe':        null,
  'craftbox.exe':        null,
  'PURPLE.exe':          null,
  'purple.exe':          null,
  'PikaLive.exe':        null,
  'pikalive.exe':        null,
};

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
function apiRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.SERVER_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── 로컬 IP 가져오기 ────────────────────────────────────────────────────────
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('100.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ─── 실행 중인 프로그램 감지 ──────────────────────────────────────────────────
function getRunningApps() {
  return new Promise((resolve) => {
    const cmd = 'powershell.exe';
    const args = [
      '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -Property ProcessName, MainWindowTitle | ConvertTo-Json -Compress'
    ];

    execFile(cmd, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        let procs = JSON.parse(stdout || '[]');
        if (!Array.isArray(procs)) procs = [procs];
        resolve(procs);
      } catch {
        resolve([]);
      }
    });
  });
}

function detectMainApp(processes) {
  // 게임 우선 감지
  for (const proc of processes) {
    const name = proc.ProcessName + '.exe';
    const mapped = APP_MAP[name];
    if (mapped) return mapped;
  }

  // 게임 못 찾으면 창 있는 프로세스 중 첫 번째
  for (const proc of processes) {
    const name = proc.ProcessName + '.exe';
    if (APP_MAP[name] === null) continue;
    if (proc.MainWindowTitle) return proc.MainWindowTitle;
  }

  return null;
}

const TITLE_BLACKLIST = ['CRAFTBOX', '크래프트박스', '피카라이브', 'PikaLive', 'PURPLE', 'Microsoft Text Input'];

function detectAllApps(processes) {
  const apps = [];
  const seen = new Set();
  for (const proc of processes) {
    const name = proc.ProcessName + '.exe';
    if (APP_MAP[name] === null) continue;
    const display = APP_MAP[name] || proc.MainWindowTitle || proc.ProcessName;
    if (!display || seen.has(display)) continue;
    // 창 제목 블랙리스트 체크
    if (TITLE_BLACKLIST.some(b => display.includes(b))) continue;
    seen.add(display);
    apps.push(display);
  }
  return apps;
}

// ─── MAC 주소 자동 감지 ──────────────────────────────────────────────────────
function getLocalMac() {
  const ifaces = os.networkInterfaces();
  const localIp = getLocalIp();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && iface.address === localIp && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.toUpperCase();
      }
    }
  }
  // fallback: 아무 외부 인터페이스
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.toUpperCase();
      }
    }
  }
  return null;
}

// ─── 자동 Machine ID 찾기 ────────────────────────────────────────────────────
async function findMyMachineId() {
  const localIp = getLocalIp();
  console.log(`[Monitor] 로컬 IP: ${localIp}`);

  try {
    const result = await apiRequest('GET', '/api/admin/machines');
    const machines = result.machines || [];
    const mine = machines.find((m) => m.sunshineHost === localIp || m.localIp === localIp);
    if (mine) {
      console.log(`[Monitor] 매칭된 PC: ${mine.name} (${mine.id})`);
      return mine.id;
    }
    console.log(`[Monitor] IP ${localIp}에 매칭되는 PC를 찾을 수 없습니다`);
  } catch (err) {
    console.error('[Monitor] 서버 연결 실패:', err.message);
  }
  return null;
}

// ─── 서버에 보고 ──────────────────────────────────────────────────────────────
let macReported = false;

async function report() {
  if (!CONFIG.MACHINE_ID) return;

  const processes = await getRunningApps();
  const currentApp = detectMainApp(processes);

  const allApps = detectAllApps(processes);

  const data = {
    currentApp: allApps.length > 0 ? allApps.join(', ') : null,
    lastPing: new Date().toISOString(),
  };

  // MAC 주소 자동 등록 (첫 1회)
  if (!macReported) {
    const mac = getLocalMac();
    if (mac) {
      data.macAddress = mac;
      macReported = true;
      console.log(`[Report] MAC 주소 자동 등록: ${mac}`);
    }
  }

  try {
    await apiRequest('PATCH', `/api/admin/machines/${CONFIG.MACHINE_ID}`, data);

    if (currentApp) {
      console.log(`[Report] ${currentApp}`);
    }
  } catch (err) {
    console.error('[Report] 실패:', err.message);
  }
}

// ─── 셧다운 명령 수신 (서버 폴링) ────────────────────────────────────────────
// 향후 WebSocket이나 서버 push로 대체 가능
// 현재는 서버에서 status를 OFF로 바꾸면 자체 셧다운

async function checkShutdownCommand() {
  if (!CONFIG.MACHINE_ID) return;

  try {
    const result = await apiRequest('GET', '/api/admin/machines');
    const machines = result.machines || [];
    const mine = machines.find((m) => m.id === CONFIG.MACHINE_ID);

    if (mine && mine.status === 'OFF') {
      console.log('[Monitor] 서버에서 셧다운 명령 수신. PC를 종료합니다.');
      exec('shutdown /s /t 5 /f', { windowsHide: true });
    }
  } catch (_) {}
}

// ─── PIN 직접 수신 HTTP 서버 (런처에서 직접 호출) ─────────────────────────────
const PIN_SERVER_PORT = 47991;

function startPinServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'POST' && req.url === '/pin') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { pin } = JSON.parse(body);
          console.log(`[PinServer] PIN 수신: ${pin}`);
          const ok = await acceptSunshinePin(pin);
          res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/usbip') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (data.action === 'usbip-attach') {
            console.log(`[USBIP] attach 요청 수신 — 장치 ${data.devices.length}개`);
            const ok = await usbipAttachDevices(data.devices, req.socket.remoteAddress);
            if (ok) {
              launcherIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
              console.log(`[Hotkey] 런처 IP 저장: ${launcherIp}`);
              startHotkeyListener();
            }
            res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok }));
          } else if (data.action === 'usbip-detach') {
            console.log('[USBIP] detach 요청 수신');
            await usbipDetachAll();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'unknown action' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/remote-cmd') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.action === 'taskmgr') {
            console.log('[RemoteCmd] 작업관리자 열기');
            exec('taskmgr.exe', { windowsHide: false });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else if (data.action === 'alt-tab') {
            console.log('[RemoteCmd] Win+Tab (작업 보기) 전송');
            exec('powershell.exe -NonInteractive -WindowStyle Hidden -Command "Add-Type -MemberDefinition \'[DllImport(\\\"user32.dll\\\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);\' -Name KE -Namespace W; [W.KE]::keybd_event(0x5B,0,0,[UIntPtr]::Zero); [W.KE]::keybd_event(0x09,0,0,[UIntPtr]::Zero); [W.KE]::keybd_event(0x09,0,2,[UIntPtr]::Zero); [W.KE]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)"', { windowsHide: true }, () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            });
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'unknown action' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    } else {
      res.writeHead(404); res.end();
    }
  });

  server.listen(PIN_SERVER_PORT, '0.0.0.0', () => {
    console.log(`[PinServer] PIN 서버 시작 (포트 ${PIN_SERVER_PORT})`);
  });
  server.on('error', (err) => {
    console.log(`[PinServer] 서버 시작 실패: ${err.message}`);
  });
}

// ─── USB/IP 드라이버 자동 설치 + 클라이언트 ────────────────────────────────────
function ensureUsbipDriver() {
  console.log('[USBIP] === 드라이버 설치 시작 ===');
  const destDir = path.dirname(process.execPath);

  // 1) 번들에서 드라이버 파일 추출
  console.log('[USBIP] 1단계: 파일 추출');
  const driverFiles = [
    'usbip_vhci.inf', 'usbip_vhci.sys', 'usbip_vhci.cat',
    'usbip_vhci_ude.inf', 'usbip_vhci_ude.sys', 'usbip_vhci_ude.cat',
    'usbip_root.inf', 'usbip_test.pfx'
  ];
  for (const f of driverFiles) {
    try {
      const src = path.join(__dirname, f);
      const dest = path.join(destDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`  [OK] ${f}`);
      } else {
        console.log(`  [없음] ${f} (번들에 없음)`);
      }
    } catch (e) {
      console.log(`  [에러] ${f}: ${e.message}`);
    }
  }

  // 2) 테스트 인증서 설치
  console.log('[USBIP] 2단계: 인증서 설치');
  const pfxPath = path.join(destDir, 'usbip_test.pfx');
  try {
    if (fs.existsSync(pfxPath)) {
      try { execSync(`certutil -p "" -importpfx Root "${pfxPath}"`, { windowsHide: true }); } catch (_) {}
      try { execSync(`certutil -p "" -importpfx TrustedPublisher "${pfxPath}"`, { windowsHide: true }); } catch (_) {}
      console.log('  [OK] 인증서 설치 완료');
    } else {
      console.log('  [스킵] pfx 파일 없음');
    }
  } catch (e) {
    console.log('  [에러] 인증서:', e.message);
  }

  // 3) 테스트 서명 모드
  console.log('[USBIP] 3단계: 테스트 서명 모드');
  try {
    const r = execSync('bcdedit /set testsigning on', { windowsHide: true }).toString();
    console.log('  [OK]', r.trim());
  } catch (e) {
    console.log('  [참고]', e.message.split('\n')[0]);
  }

  // 4) VHCI 드라이버 설치
  console.log('[USBIP] 4단계: 드라이버 설치');
  const infPath = path.join(destDir, 'usbip_vhci.inf');
  const udeInfPath = path.join(destDir, 'usbip_vhci_ude.inf');

  if (fs.existsSync(infPath)) {
    try {
      const r = execSync(`pnputil /add-driver "${infPath}" /install`, { windowsHide: true, timeout: 30000 }).toString();
      console.log('  [VHCI]', r.trim());
    } catch (e) { console.log('  [VHCI 실패]', e.message.split('\n').slice(0, 3).join(' | ')); }
  } else {
    console.log('  [VHCI] inf 파일 없음:', infPath);
  }

  if (fs.existsSync(udeInfPath)) {
    try {
      const r = execSync(`pnputil /add-driver "${udeInfPath}" /install`, { windowsHide: true, timeout: 30000 }).toString();
      console.log('  [UDE]', r.trim());
    } catch (e) { console.log('  [UDE 실패]', e.message.split('\n').slice(0, 3).join(' | ')); }
  } else {
    console.log('  [UDE] inf 파일 없음:', udeInfPath);
  }

  // 5) 확인
  console.log('[USBIP] 5단계: 드라이버 로드 확인');
  try {
    const result = execSync('driverquery /fo csv', { windowsHide: true, timeout: 15000 }).toString();
    if (result.toLowerCase().includes('usbip')) {
      console.log('  [OK] VHCI 드라이버 로드됨!');
    } else {
      console.log('  [경고] 드라이버 로드 안 됨 — 재부팅 필요할 수 있음');
    }
  } catch (e) {
    console.log('  [에러] driverquery:', e.message);
  }
  console.log('[USBIP] === 드라이버 설치 완료 ===');
}

// pkg 번들에서 파일 읽기를 강제하기 위한 참조
const __bundled_usbip = path.join(__dirname, 'usbip.exe');
const __bundled_attacher = path.join(__dirname, 'attacher.exe');
const __bundled_vhci_inf = path.join(__dirname, 'usbip_vhci.inf');
const __bundled_vhci_sys = path.join(__dirname, 'usbip_vhci.sys');
const __bundled_vhci_cat = path.join(__dirname, 'usbip_vhci.cat');
const __bundled_vhci_ude_inf = path.join(__dirname, 'usbip_vhci_ude.inf');
const __bundled_vhci_ude_sys = path.join(__dirname, 'usbip_vhci_ude.sys');
const __bundled_vhci_ude_cat = path.join(__dirname, 'usbip_vhci_ude.cat');
const __bundled_root_inf = path.join(__dirname, 'usbip_root.inf');
const __bundled_test_pfx = path.join(__dirname, 'usbip_test.pfx');

// 내장된 usbip 파일들을 exe 옆에 자동 추출
function extractUsbipFiles() {
  const destDir = path.dirname(process.execPath);
  const bundled = {
    'usbip.exe': __bundled_usbip,
    'attacher.exe': __bundled_attacher,
  };
  for (const [name, src] of Object.entries(bundled)) {
    const dest = path.join(destDir, name);
    if (fs.existsSync(dest)) { console.log(`[USBIP] ${name} 이미 존재`); continue; }
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
        console.log(`[USBIP] ${name} 추출 완료:`, dest);
      } catch (e) { console.log(`[USBIP] ${name} 추출 실패:`, e.message); }
    } else {
      console.log(`[USBIP] ${name} 번들 없음:`, src);
    }
  }
  const usbipDest = path.join(destDir, 'usbip.exe');
  return fs.existsSync(usbipDest) ? usbipDest : null;
}

const USBIP_EXE = (() => {
  // 1순위: 시스템 설치 (usbip-win2 최신 버전, VHCI 드라이버 호환)
  const systemPaths = [
    'C:\\Program Files\\USBip\\usbip.exe',
    'C:\\Program Files (x86)\\USBip\\usbip.exe',
  ];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) { console.log('[USBIP] 시스템 설치 usbip.exe 사용:', p); return p; }
  }
  // 2순위: exe 옆에 추출된 usbip.exe (번들 폴백)
  const extracted = extractUsbipFiles();
  if (extracted) { console.log('[USBIP] 번들 usbip.exe 사용:', extracted); return extracted; }
  console.log('[USBIP] usbip.exe를 찾을 수 없음!');
  return null;
})();

let attachedPorts = [];
let launcherIp = null;        // 런처(컴1) IP — attach 시 자동 저장
let hotkeyProcess = null;     // 핫키 감지 PowerShell 프로세스

function usbipAttachDevices(devices, remoteAddr) {
  return new Promise(async (resolve) => {
    const t0 = Date.now();
    console.log(`[USBIP] ========== ATTACH 시작 ==========`);
    console.log(`[USBIP] usbip.exe 경로: ${USBIP_EXE}`);
    console.log(`[USBIP] usbip.exe 존재: ${USBIP_EXE ? fs.existsSync(USBIP_EXE) : false}`);
    console.log(`[USBIP] 요청 장치: ${JSON.stringify(devices)}`);
    console.log(`[USBIP] remoteAddr 원본: ${remoteAddr}`);

    if (!USBIP_EXE) {
      console.log('[USBIP] usbip.exe를 찾을 수 없음');
      resolve(false);
      return;
    }

    // VHCI 드라이버 로드 확인
    try {
      const drvResult = execSync('driverquery /fo csv /nh', { windowsHide: true, timeout: 10000 }).toString();
      const vhciLoaded = drvResult.toLowerCase().includes('usbip');
      console.log(`[USBIP] VHCI 드라이버 로드됨: ${vhciLoaded}`);
      if (!vhciLoaded) console.log('[USBIP] ⚠️ VHCI 드라이버가 로드되지 않았습니다! attach 실패할 수 있음');
    } catch (e) {
      console.log(`[USBIP] 드라이버 확인 실패: ${e.message}`);
    }

    // remoteAddr에서 IPv4 추출 (::ffff:192.168.x.x → 192.168.x.x)
    const clientIp = (remoteAddr || '').replace(/^::ffff:/, '');
    console.log(`[USBIP] 클라이언트 IP (추출): ${clientIp}`);

    // 네트워크 연결 테스트 (3240 포트 — usbipd 서버)
    console.log(`[USBIP] 네트워크 테스트: ${clientIp}:3240 연결 시도...`);
    try {
      const t1 = Date.now();
      execSync(`powershell -Command "Test-NetConnection -ComputerName ${clientIp} -Port 3240 -InformationLevel Quiet"`,
        { windowsHide: true, timeout: 8000 });
      console.log(`[USBIP] 네트워크 테스트 성공 (${Date.now() - t1}ms)`);
    } catch (e) {
      console.log(`[USBIP] ⚠️ 네트워크 테스트 실패: ${clientIp}:3240 연결 불가! usbipd 서버가 실행 중인지, 방화벽 확인 필요`);
    }

    // 먼저 서버에서 사용 가능한 장치 목록 조회
    let serverBusIds = [];
    try {
      console.log(`[USBIP] list -r ${clientIp} 실행 중...`);
      const t2 = Date.now();
      const listResult = execSync(
        `"${USBIP_EXE}" list -r ${clientIp}`,
        { windowsHide: true, timeout: 10000 }
      ).toString();
      console.log(`[USBIP] list 완료 (${Date.now() - t2}ms)`);
      console.log(`[USBIP] 서버 장치 목록:\n${listResult}`);
      // bus ID 추출 (예: "1-1", "2-3" 등)
      const matches = listResult.matchAll(/^\s*(\d+-[\d.]+)\s*:/gm);
      for (const m of matches) serverBusIds.push(m[1]);
      console.log(`[USBIP] 서버 bus IDs: ${serverBusIds.join(', ') || '(없음)'}`);
    } catch (err) {
      console.log(`[USBIP] ⚠️ 서버 목록 조회 실패: ${err.message}`);
      // stderr도 출력
      if (err.stderr) console.log(`[USBIP] stderr: ${err.stderr.toString()}`);
      if (err.stdout) console.log(`[USBIP] stdout: ${err.stdout.toString()}`);
    }

    let success = false;
    // 서버 목록에서 가져온 bus ID로 순서대로 attach 시도
    const idsToTry = serverBusIds.length > 0 ? serverBusIds : devices.map(d => d.busId);
    console.log(`[USBIP] attach 시도할 IDs: ${idsToTry.join(', ') || '(없음)'}`);

    if (idsToTry.length === 0) {
      console.log('[USBIP] ⚠️ attach할 장치가 없음! 서버에서 bind된 장치가 없거나 list 실패');
      resolve(false);
      return;
    }

    for (const busId of idsToTry) {
      try {
        const t3 = Date.now();
        console.log(`[USBIP] attach 시도: busId=${busId}, server=${clientIp}`);
        console.log(`[USBIP] 실행: "${USBIP_EXE}" attach -r ${clientIp} -b ${busId}`);
        const result = execSync(
          `"${USBIP_EXE}" attach -r ${clientIp} -b ${busId}`,
          { windowsHide: true, timeout: 15000 }
        ).toString();
        console.log(`[USBIP] attach 완료 (${Date.now() - t3}ms): ${result.trim()}`);

        // 포트 번호 추출
        const portMatch = result.match(/port\s+(\d+)/i);
        if (portMatch) {
          attachedPorts.push(portMatch[1]);
          console.log(`[USBIP] 포트 할당됨: ${portMatch[1]}`);
        }
        success = true;
      } catch (err) {
        console.log(`[USBIP] ⚠️ attach 실패 (${busId}): ${err.message}`);
        if (err.stderr) console.log(`[USBIP] stderr: ${err.stderr.toString()}`);
        if (err.stdout) console.log(`[USBIP] stdout: ${err.stdout.toString()}`);
        if (err.killed) console.log(`[USBIP] ⚠️ 프로세스가 타임아웃으로 kill됨!`);
      }
    }
    console.log(`[USBIP] ========== ATTACH 종료 (${Date.now() - t0}ms, 성공=${success}) ==========`);
    resolve(success);
  });
}

function usbipDetachAll() {
  if (!USBIP_EXE) return;
  // 개별 포트 detach (가장 안전한 방식)
  if (attachedPorts.length > 0) {
    for (const port of attachedPorts) {
      try {
        execSync(`"${USBIP_EXE}" detach -p ${port}`, { windowsHide: true, timeout: 5000 });
        console.log(`[USBIP] detach port ${port} 완료`);
      } catch (_) {}
    }
  } else {
    // 포트 정보 없으면 0~3번 포트 시도
    for (let p = 0; p <= 3; p++) {
      try {
        execSync(`"${USBIP_EXE}" detach -p ${p}`, { windowsHide: true, timeout: 5000 });
        console.log(`[USBIP] detach port ${p} 완료`);
      } catch (_) {}
    }
  }
  console.log('[USBIP] detach 완료');
  attachedPorts = [];
}

// ─── 자동 페어링: Sunshine API로 PIN 수락 ─────────────────────────────────────
function acceptSunshinePin(pin) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ pin: pin.toString() });
    const auth = Buffer.from(`${CONFIG.SUNSHINE_USER}:${CONFIG.SUNSHINE_PASS}`).toString('base64');

    const req = https.request({
      hostname: '127.0.0.1',
      port: CONFIG.SUNSHINE_PORT,
      path: '/api/pin',
      method: 'POST',
      rejectUnauthorized: false, // Sunshine은 self-signed cert 사용
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Basic ${auth}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        console.log(`[Pair] Sunshine 응답: ${res.statusCode} ${data}`);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (err) => {
      console.log(`[Pair] Sunshine 연결 실패: ${err.message}`);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

async function checkPendingPin() {
  if (!CONFIG.MACHINE_ID) return;

  try {
    const result = await apiRequest('GET', `/api/session/pair?machineId=${CONFIG.MACHINE_ID}`);
    if (result.pin) {
      console.log(`[Pair] PIN 수신: ${result.pin} → Sunshine에 전달 중...`);
      const ok = await acceptSunshinePin(result.pin);
      if (ok) {
        console.log('[Pair] 페어링 성공!');
      } else {
        console.log('[Pair] 페어링 실패 — Sunshine 응답 확인 필요');
      }
    }
  } catch (_) {}
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  REMOTE1 PC 모니터링 에이전트');
  console.log(`  서버: ${CONFIG.SERVER_URL}`);
  console.log('═══════════════════════════════════════');

  // Machine ID 자동 감지
  CONFIG.MACHINE_ID = await findMyMachineId();
  if (!CONFIG.MACHINE_ID) {
    console.error('[Monitor] PC를 찾을 수 없습니다. 서버에 PC를 먼저 등록해주세요.');
    console.log('[Monitor] 30초 후 재시도...');
    setTimeout(main, 30000);
    return;
  }

  // PIN 직접 수신 서버 시작
  startPinServer();

  // 주기적 보고
  setInterval(report, CONFIG.REPORT_INTERVAL);

  // 셧다운 명령 체크 (30초마다)
  setInterval(checkShutdownCommand, 30000);

  // 자동 페어링 PIN 폴링 (3초마다)
  setInterval(checkPendingPin, CONFIG.PAIR_POLL_INTERVAL);

  // 즉시 첫 보고
  await report();
  console.log('[Monitor] 모니터링 시작 (자동 페어링 활성)');
}

// --run 모드일 때만 자동 실행
if (args.includes('--run')) {
  startMonitor();
}

process.on('SIGINT', () => {
  console.log('\n[Monitor] 종료');
  process.exit(0);
});

// ─── 핫키 감지 → 런처(컴1)로 전달 ───────────────────────────────────────────
const HOTKEY_PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HK {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$VK_CONTROL = 0x11; $VK_ALT = 0x12
$fkeys = @{ 0x70='F1'; 0x71='F2'; 0x72='F3'; 0x73='F4'; 0x74='F5'; 0x75='F6'; 0x76='F7'; 0x77='F8'; 0x78='F9' }
$lastFired = ''
while ($true) {
  $ctrl = [HK]::GetAsyncKeyState($VK_CONTROL) -band 0x8000
  $alt  = [HK]::GetAsyncKeyState($VK_ALT) -band 0x8000
  if ($ctrl -and $alt) {
    foreach ($vk in $fkeys.Keys) {
      if ([HK]::GetAsyncKeyState($vk) -band 0x8000) {
        $name = $fkeys[$vk]
        if ($lastFired -ne $name) {
          Write-Output $name
          [Console]::Out.Flush()
          $lastFired = $name
        }
        break
      }
    }
  } else {
    $lastFired = ''
  }
  Start-Sleep -Milliseconds 50
}
`;

function startHotkeyListener() {
  if (hotkeyProcess) return;
  if (!launcherIp) return;

  console.log('[Hotkey] 핫키 리스너 시작');
  hotkeyProcess = execFile('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', HOTKEY_PS_SCRIPT
  ], { windowsHide: true });

  hotkeyProcess.stdout.on('data', (data) => {
    const keys = data.toString().trim().split(/\r?\n/);
    for (const key of keys) {
      if (!key) continue;
      console.log(`[Hotkey] 감지: Ctrl+Alt+${key} → 런처(${launcherIp})로 전달`);
      sendToLauncher(key);
    }
  });

  hotkeyProcess.stderr.on('data', (d) => console.log('[Hotkey] stderr:', d.toString().trim()));
  hotkeyProcess.on('exit', (code) => {
    console.log(`[Hotkey] 프로세스 종료 (code=${code})`);
    hotkeyProcess = null;
  });
}

function stopHotkeyListener() {
  if (hotkeyProcess) {
    hotkeyProcess.kill();
    hotkeyProcess = null;
    console.log('[Hotkey] 리스너 중지');
  }
}

function sendToLauncher(fkey) {
  if (!launcherIp) return;
  const postData = JSON.stringify({ key: fkey });
  const req = http.request({
    hostname: launcherIp,
    port: 47992,
    path: '/shortcut',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 3000,
  }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => console.log(`[Hotkey] 런처 응답: ${body}`));
  });
  req.on('error', (e) => console.log(`[Hotkey] 런처 전달 실패: ${e.message}`));
  req.on('timeout', () => { req.destroy(); });
  req.write(postData);
  req.end();
}

process.on('uncaughtException', (err) => {
  console.error('[오류]', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[오류]', err);
});
