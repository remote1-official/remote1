'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { exec, execSync } = require('child_process');
const dgram = require('dgram');
const path = require('path');
const readline = require('readline');

// ─── 실행 모드 분기 ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--run')) {
  // 백그라운드 모드 — 바로 메인 루프 실행
} else if (args.includes('--uninstall')) {
  uninstall();
  process.exit(0);
} else {
  // 메뉴 모드
  showMenu();
}

function showMenu() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║   REMOTE1 카운터 에이전트 v2.0   ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');
  console.log('  설치 + 실행을 진행합니다...');
  console.log('');
  install();
  return;
}

function getExePath() {
  return process.execPath;
}

function install() {
  const exePath = getExePath();
  console.log('');
  console.log(`  에이전트 경로: ${exePath}`);

  try {
    // 기존 작업 제거
    try { execSync('schtasks /delete /tn "REMOTE1-Agent" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}

    // 작업 스케줄러 등록 (로그온 시 자동 실행, 최소화)
    execSync(`schtasks /create /tn "REMOTE1-Agent" /tr "\\"${exePath}\\" --run" /sc onlogon /rl highest /f`, { windowsHide: true });

    console.log('');
    console.log('  [완료] 자동 시작 등록 완료!');
    console.log('  - PC 부팅 시 자동 실행됩니다');
    console.log('  - 제거: 이 프로그램 다시 실행 → 3번');
    console.log('');
  } catch (err) {
    console.log('');
    console.log('  [오류] 관리자 권한이 필요합니다.');
    console.log('  → 이 파일을 우클릭 → 관리자 권한으로 실행');
    console.log('');
    console.log('  5초 후 종료...');
    setTimeout(() => process.exit(1), 5000);
    return;
  }

  // 바로 실행
  startAgent();
}

function uninstall() {
  console.log('');
  try { execSync('taskkill /f /im "REMOTE1-에이전트.exe"', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  try { execSync('schtasks /delete /tn "REMOTE1-Agent" /f', { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  console.log('  [완료] 에이전트 제거 완료');
  console.log('');
}

function startAgent() {
  mainLoop().catch((err) => { console.error('[Fatal]', err); process.exit(1); });
}

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  SERVER_URL: 'https://project-six-sable-26.vercel.app',
  POLL_INTERVAL: 5000,        // 5초마다 서버 폴링
  PING_INTERVAL: 30000,       // 30초마다 PC 핑 체크
  WOL_PORT: 9,
};

// ─── 상태 ─────────────────────────────────────────────────────────────────────
let machines = [];
let adminSettings = { autoManage: false, minReadyPCs: 4 };
let lastPingTime = 0;

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

// ─── WOL (Wake-on-LAN) ───────────────────────────────────────────────────────
function sendWol(macAddress, name) {
  return new Promise((resolve, reject) => {
    if (!macAddress) { reject(new Error('MAC 주소 없음')); return; }

    const mac = macAddress.replace(/[:-]/g, '');
    if (mac.length !== 12) { reject(new Error('잘못된 MAC 주소')); return; }

    const macBuf = Buffer.from(mac, 'hex');
    const magic = Buffer.alloc(102);
    magic.fill(0xFF, 0, 6);
    for (let i = 0; i < 16; i++) macBuf.copy(magic, 6 + i * 6);

    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => { socket.close(); reject(err); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(magic, 0, magic.length, CONFIG.WOL_PORT, '255.255.255.255', (err) => {
        socket.close();
        if (err) reject(err);
        else {
          console.log(`  [WOL] ${name} (${macAddress}) 매직패킷 전송 완료`);
          resolve();
        }
      });
    });
  });
}

// ─── Ping ─────────────────────────────────────────────────────────────────────
function pingHost(ip) {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w 2000 ${ip}`, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(!err && stdout.includes('TTL='));
    });
  });
}

// ─── 원격 셧다운 ─────────────────────────────────────────────────────────────
function shutdownHost(ip, name) {
  return new Promise((resolve) => {
    exec(`shutdown /s /m \\\\${ip} /t 5 /f`, { windowsHide: true, timeout: 10000 }, (err) => {
      if (err) console.log(`  [Shutdown] ${name} (${ip}) 실패: ${err.message}`);
      else console.log(`  [Shutdown] ${name} (${ip}) 셧다운 명령 전송`);
      resolve(!err);
    });
  });
}

// ─── 서버 데이터 가져오기 ─────────────────────────────────────────────────────
async function fetchData() {
  try {
    const [mRes, sRes] = await Promise.all([
      apiRequest('GET', '/api/admin/machines'),
      apiRequest('GET', '/api/admin/settings'),
    ]);
    machines = mRes.machines || [];
    adminSettings = {
      autoManage: sRes.autoManage ?? false,
      minReadyPCs: sRes.minReadyPCs ?? 4,
    };
  } catch (err) {
    console.error('[Fetch] 서버 연결 실패:', err.message);
  }
}

async function updateMachine(id, data) {
  try {
    await apiRequest('PATCH', `/api/admin/machines/${id}`, data);
  } catch (err) {
    console.error('[Update] 실패:', err.message);
  }
}

// ─── 명령 처리: BOOTING → WOL 전송 ──────────────────────────────────────────
async function processBootingMachines() {
  const booting = machines.filter(m => m.status === 'BOOTING' && m.macAddress);
  for (const m of booting) {
    try {
      await sendWol(m.macAddress, m.name);
    } catch (err) {
      console.log(`  [WOL] ${m.name} 실패: ${err.message}`);
    }
  }
}

// ─── 핑 체크 ──────────────────────────────────────────────────────────────────
async function pingCheck() {
  const now = Date.now();
  if (now - lastPingTime < CONFIG.PING_INTERVAL) return;
  lastPingTime = now;

  console.log('[Ping] 상태 확인 중...');
  const ts = new Date().toISOString();

  for (const m of machines) {
    if (!m.localIp || m.status === 'OFF') continue;

    const alive = await pingHost(m.localIp);

    if (alive) {
      const update = { lastPing: ts };
      if (m.status === 'BOOTING') {
        update.status = 'READY';
        update.isAvailable = true;
        console.log(`  [Ping] ${m.name} 부팅 완료 → READY`);
      }
      await updateMachine(m.id, update);
    } else {
      if (m.status === 'READY' || m.status === 'BOOTING') {
        // 5분 이상 응답 없으면 OFF로 변경
        if (m.lastPing) {
          const lastPingMs = new Date(m.lastPing).getTime();
          if (now - lastPingMs > 5 * 60 * 1000) {
            console.log(`  [Ping] ${m.name} 5분 이상 무응답 → OFF`);
            await updateMachine(m.id, { status: 'OFF', isAvailable: true });
          }
        }
      }
    }
  }
}

// ─── 자동관리 로직 ────────────────────────────────────────────────────────────
async function autoManage() {
  if (!adminSettings.autoManage) return;

  const minReady = adminSettings.minReadyPCs;
  const readyPCs = machines.filter(m => m.status === 'READY');
  const bootingPCs = machines.filter(m => m.status === 'BOOTING');
  const readyCount = readyPCs.length;
  const bootingCount = bootingPCs.length;

  // 대기 PC가 부족하면 → OFF 상태 PC를 BOOTING으로 변경 (에이전트가 WOL 전송)
  const deficit = minReady - readyCount - bootingCount;
  if (deficit > 0) {
    const offPCs = machines.filter(m => m.status === 'OFF' && m.macAddress && m.isAvailable);
    const toWake = Math.min(deficit, offPCs.length);

    if (toWake > 0) {
      console.log(`[AutoManage] 대기 ${readyCount}대 + 부팅중 ${bootingCount}대 (최소 ${minReady}대) → ${toWake}대 부팅`);
      for (let i = 0; i < toWake; i++) {
        await updateMachine(offPCs[i].id, { status: 'BOOTING' });
      }
    }
  }

  // 대기 PC 초과분은 자동으로 끄지 않음 (관리자가 수동으로 켠 것일 수 있음)
  // 단, READY 상태에서 30분 이상 이용자가 없으면 → 최소 대기 수를 초과한 PC만 셧다운
  const IDLE_TIMEOUT = 30 * 60 * 1000; // 30분
  const now = Date.now();

  if (readyCount > minReady) {
    const idlePCs = readyPCs.filter(m => {
      if (!m.lastPing) return false;
      const idleTime = now - new Date(m.lastPing).getTime();
      return idleTime > IDLE_TIMEOUT;
    });

    // 최소 대기 수는 유지하면서, 30분 이상 미사용 초과분만 끄기
    const canShutdown = Math.min(idlePCs.length, readyCount - minReady);
    if (canShutdown > 0) {
      console.log(`[AutoManage] ${canShutdown}대 30분 이상 미사용 → 셧다운`);
      for (let i = 0; i < canShutdown; i++) {
        if (idlePCs[i].localIp) {
          await shutdownHost(idlePCs[i].localIp, idlePCs[i].name);
          await updateMachine(idlePCs[i].id, { status: 'OFF', isAvailable: true });
        }
      }
    }
  }
}

// ─── 메인 루프 ────────────────────────────────────────────────────────────────
async function mainLoop() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║   REMOTE1 카운터 에이전트 v2.0   ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log(`  서버: ${CONFIG.SERVER_URL}`);
  console.log(`  폴링: ${CONFIG.POLL_INTERVAL / 1000}초`);
  console.log('');

  await fetchData();
  console.log(`[Init] PC ${machines.length}대 | 자동관리: ${adminSettings.autoManage ? 'ON' : 'OFF'} | 최소대기: ${adminSettings.minReadyPCs}대`);
  console.log('');

  // 메인 폴링 (5초마다)
  setInterval(async () => {
    await fetchData();

    // 1. BOOTING 상태 PC에 WOL 전송
    await processBootingMachines();

    // 2. 핑 체크 (30초 간격으로 내부 throttle)
    await pingCheck();

    // 3. 자동관리 로직
    await autoManage();

  }, CONFIG.POLL_INTERVAL);

  // 상태 로그 (1분마다)
  setInterval(() => {
    const ready = machines.filter(m => m.status === 'READY').length;
    const inUse = machines.filter(m => m.status === 'IN_USE').length;
    const booting = machines.filter(m => m.status === 'BOOTING').length;
    const off = machines.filter(m => m.status === 'OFF').length;
    const ts = new Date().toLocaleTimeString('ko-KR');
    console.log(`[${ts}] 대기:${ready} 사용:${inUse} 부팅:${booting} 꺼짐:${off} | 자동관리:${adminSettings.autoManage ? 'ON' : 'OFF'}`);
  }, 60000);
}

process.on('SIGINT', () => {
  console.log('\n[Agent] 종료');
  process.exit(0);
});
