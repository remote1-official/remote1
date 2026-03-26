'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { execFile, exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ─── 실행 모드 분기 ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--run')) {
  // 백그라운드 모드 — 바로 메인 실행
} else if (args.includes('--uninstall')) {
  uninstallMonitor();
  process.exit(0);
} else {
  showMenu();
}

function showMenu() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║   REMOTE1 PC 모니터 설치         ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');
  console.log('  설치를 진행합니다...');
  console.log('');
  installMonitor();
  return;
}

function getExePath() { return process.execPath; }

function installMonitor() {
  const exePath = getExePath();
  console.log('');
  console.log(`  경로: ${exePath}`);

  try {
    // 기존 작업 제거
    try { execSync('schtasks /delete /tn "REMOTE1-Monitor" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}

    // 작업 스케줄러 등록 (exe 직접 실행)
    execSync(`schtasks /create /tn "REMOTE1-Monitor" /tr "\\"${exePath}\\" --run" /sc onlogon /rl highest /f`, { windowsHide: true });

    console.log('');
    console.log('  [완료] 설치 완료!');
    console.log('  - PC 부팅 시 자동 실행 (창 안 보임)');
    console.log('  - 제거: 이 프로그램 다시 실행 → 2번');
    console.log('');

    // 바로 백그라운드 실행
    console.log('  모니터를 시작합니다...');
    const { spawn: sp } = require('child_process');
    const child = sp(exePath, ['--run'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();

    console.log('  [실행됨] exe 파일을 삭제하면 자동으로 멈춥니다.');
    console.log('');
    console.log('  5초 후 이 창이 닫힙니다...');
    setTimeout(() => process.exit(0), 5000);
  } catch (err) {
    console.log('');
    console.log('  [오류] 관리자 권한이 필요합니다.');
    console.log('  → 우클릭 → 관리자 권한으로 실행');
    console.log('');
    console.log('  5초 후 종료...');
    setTimeout(() => process.exit(1), 5000);
  }
}

function uninstallMonitor() {
  console.log('');
  try { execSync('taskkill /f /im "REMOTE1-모니터.exe"', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  try { execSync('schtasks /delete /tn "REMOTE1-Monitor" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}

  console.log('  [완료] 모니터 제거 완료');
  console.log('');
}

function startMonitor() {
  main().catch((err) => { console.error('[Fatal]', err); process.exit(1); });
}

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  SERVER_URL: 'https://project-six-sable-26.vercel.app',
  REPORT_INTERVAL: 10000,  // 10초마다 서버에 보고
  PAIR_POLL_INTERVAL: 3000, // 3초마다 페어링 PIN 확인
  MACHINE_ID: null,        // 자동 감지 (IP 기반)
  SUNSHINE_USER: 'skylove441',
  SUNSHINE_PASS: '@Lee76177500',
  SUNSHINE_PORT: 47990,
};

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
      if (iface.family === 'IPv4' && !iface.internal) {
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
