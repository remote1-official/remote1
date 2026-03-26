'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { exec } = require('child_process');
const dgram = require('dgram');

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  SERVER_URL: 'https://project-six-sable-26.vercel.app',
  POLL_INTERVAL: 10000,       // 10초마다 서버 폴링
  PING_INTERVAL: 30000,       // 30초마다 PC 핑 체크
  MIN_READY_PCS: 4,           // 최소 대기 PC 수
  HEARTBEAT_INTERVAL: 60000,  // 1분마다 heartbeat
  WOL_PORT: 9,
  IPTIME_WOL: null,           // iptime 공유기 WOL URL (설정 시 백업으로 사용)
};

// ─── 상태 ─────────────────────────────────────────────────────────────────────
let machines = [];
let running = true;

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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── WOL (Wake-on-LAN) ───────────────────────────────────────────────────────
function sendWol(macAddress) {
  return new Promise((resolve, reject) => {
    if (!macAddress) {
      reject(new Error('MAC 주소 없음'));
      return;
    }

    const mac = macAddress.replace(/[:-]/g, '');
    if (mac.length !== 12) {
      reject(new Error('잘못된 MAC 주소'));
      return;
    }

    // 매직 패킷: FF x 6 + MAC x 16
    const macBuf = Buffer.from(mac, 'hex');
    const magic = Buffer.alloc(102);
    magic.fill(0xFF, 0, 6);
    for (let i = 0; i < 16; i++) {
      macBuf.copy(magic, 6 + i * 6);
    }

    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => { socket.close(); reject(err); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(magic, 0, magic.length, CONFIG.WOL_PORT, '255.255.255.255', (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// iptime 공유기를 통한 WOL (백업)
function sendWolViaRouter(macAddress) {
  if (!CONFIG.IPTIME_WOL) return Promise.resolve();
  // iptime 공유기 WOL API 호출 (기종에 따라 URL 다름)
  const mac = macAddress.replace(/[:-]/g, ':');
  const url = `${CONFIG.IPTIME_WOL}?mac=${mac}`;
  return apiRequest('GET', url).catch(() => {});
}

// ─── Ping 체크 ────────────────────────────────────────────────────────────────
function pingHost(ip) {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w 2000 ${ip}`, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(!err && stdout.includes('TTL='));
    });
  });
}

// ─── 원격 셧다운 ─────────────────────────────────────────────────────────────
function shutdownHost(ip) {
  return new Promise((resolve) => {
    exec(`shutdown /s /m \\\\${ip} /t 0 /f`, { windowsHide: true, timeout: 10000 }, (err) => {
      if (err) console.log(`[Shutdown] ${ip} 실패:`, err.message);
      else console.log(`[Shutdown] ${ip} 셧다운 명령 전송`);
      resolve(!err);
    });
  });
}

// ─── 메인 루프 ────────────────────────────────────────────────────────────────
async function fetchMachines() {
  try {
    const result = await apiRequest('GET', '/api/admin/machines');
    machines = result.machines || [];
    return machines;
  } catch (err) {
    console.error('[Fetch] 서버 연결 실패:', err.message);
    return machines;
  }
}

async function updateMachineStatus(id, data) {
  try {
    await apiRequest('PATCH', `/api/admin/machines/${id}`, data);
  } catch (err) {
    console.error('[Update] 실패:', err.message);
  }
}

async function pingAllMachines() {
  console.log('[Ping] PC 상태 확인 중...');
  const now = new Date().toISOString();

  for (const m of machines) {
    if (!m.localIp) continue;
    if (m.status === 'OFF') continue; // 꺼진 PC는 핑 안 함

    const alive = await pingHost(m.localIp);

    if (alive) {
      // 핑 성공 → lastPing 업데이트, BOOTING이면 READY로
      const update = { lastPing: now };
      if (m.status === 'BOOTING') {
        update.status = 'READY';
        update.isAvailable = true;
        console.log(`[Ping] ${m.name} (${m.localIp}) 부팅 완료 → READY`);
      }
      await updateMachineStatus(m.id, update);
    } else {
      // 핑 실패
      if (m.status === 'READY' || m.status === 'IN_USE') {
        console.log(`[Ping] ${m.name} (${m.localIp}) 응답 없음 → OFF`);
        await updateMachineStatus(m.id, { status: 'OFF', isAvailable: true, currentApp: null, currentAppIcon: null });
      }
    }
  }
}

async function autoScale() {
  const readyCount = machines.filter((m) => m.status === 'READY').length;
  const deficit = CONFIG.MIN_READY_PCS - readyCount;

  if (deficit <= 0) return;

  console.log(`[AutoScale] 대기 PC ${readyCount}대 (최소 ${CONFIG.MIN_READY_PCS}대) → ${deficit}대 추가 부팅`);

  // OFF 상태이고 MAC 주소가 있는 PC를 부팅
  const offMachines = machines.filter((m) => m.status === 'OFF' && m.macAddress && m.isAvailable);

  for (let i = 0; i < Math.min(deficit, offMachines.length); i++) {
    const m = offMachines[i];
    console.log(`[AutoScale] ${m.name} WOL 전송 (${m.macAddress})`);

    try {
      await sendWol(m.macAddress);
      // 백업: 공유기 경유
      await sendWolViaRouter(m.macAddress);
      await updateMachineStatus(m.id, { status: 'BOOTING' });
    } catch (err) {
      console.error(`[AutoScale] ${m.name} WOL 실패:`, err.message);
    }
  }

  if (deficit > offMachines.length) {
    console.log(`[AutoScale] MAC 미등록 PC가 있어 ${deficit - offMachines.length}대를 부팅할 수 없습니다`);
  }
}

async function mainLoop() {
  console.log('═══════════════════════════════════════');
  console.log('  REMOTE1 카운터 에이전트 시작');
  console.log(`  서버: ${CONFIG.SERVER_URL}`);
  console.log(`  최소 대기 PC: ${CONFIG.MIN_READY_PCS}대`);
  console.log('═══════════════════════════════════════');

  // 초기 로드
  await fetchMachines();
  console.log(`[Init] PC ${machines.length}대 등록됨`);

  // 주기적 작업
  setInterval(async () => {
    await fetchMachines();
    await autoScale();
  }, CONFIG.POLL_INTERVAL);

  // 핑 체크 (별도 주기)
  setInterval(async () => {
    await fetchMachines();
    await pingAllMachines();
  }, CONFIG.PING_INTERVAL);

  // Heartbeat (서버에 에이전트 살아있음 알림)
  setInterval(() => {
    const ts = new Date().toLocaleTimeString('ko-KR');
    console.log(`[Heartbeat] ${ts} — PC ${machines.length}대 관리 중`);
  }, CONFIG.HEARTBEAT_INTERVAL);
}

// ─── 시작 ─────────────────────────────────────────────────────────────────────
mainLoop().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

// graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Agent] 종료 중...');
  running = false;
  process.exit(0);
});
