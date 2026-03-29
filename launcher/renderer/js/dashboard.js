'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  status: 'idle',          // 'idle' | 'connecting' | 'connected'
  user: null,              // { id, email, name, credits, username }
  session: null,           // { host, machineName, machineSpec }
  credits: 0,              // current credits (minutes)
  elapsed: 0,              // seconds since connected
  scheduleMinutes: null,   // null = no schedule; number = minutes until stop
  scheduleRemaining: null, // seconds remaining until schedule fires
  notices: [],             // array of notice objects
  noticeIndex: 0,          // current notice index
  muted: false,
  mouseGrabbed: false,
};

let timerInterval  = null;
let creditInterval = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  // Window / Titlebar
  minimize:  $('btn-minimize'),
  maximize:  $('btn-maximize'),
  close:     $('btn-close'),
  settings:  $('btn-settings'),

  // Sidebar
  logout:      $('btn-logout'),
  endSession:  $('btn-end-session'),
  userAvatar:  $('user-avatar'),
  userName:    $('user-name'),
  userPlan:    $('user-plan'),
  creditsValue: $('credits-value'),
  creditsSub:   $('credits-sub'),
  statusDot:    $('status-dot'),
  statusText:   $('status-text'),
  statusSub:    $('status-sub'),

  // Views
  viewIdle:       $('view-idle'),
  viewConnecting: $('view-connecting'),
  viewConnected:  $('view-connected'),
  connectingMsg:  $('connecting-msg'),

  // Idle
  btnConnect:          $('btn-connect'),
  moonlightWarning:    $('moonlight-warning'),
  btnInstallMoonlight: $('btn-install-moonlight'),
  idleAlert:           $('idle-alert'),

  // Notice board
  noticeContent: $('notice-content'),
  noticeDots:    $('notice-dots'),
  noticePrev:    $('notice-prev'),
  noticeNext:    $('notice-next'),

  // Connected
  pcName:           $('pc-name'),
  pcSpec:           $('pc-spec'),
  elapsedTime:      $('elapsed-time'),
  elapsedSub:       $('elapsed-sub'),
  timer2Label:      $('timer2-label'),
  remainingDisplay: $('remaining-display'),
  remainingSub:     $('remaining-sub'),

  // Schedule
  schedMinutes:     $('sched-minutes'),
  schedMinus:       $('sched-minus'),
  schedPlus:        $('sched-plus'),
  btnSchedSet:      $('btn-sched-set'),
  btnSchedCancel:   $('btn-sched-cancel'),
  schedInfo:        $('sched-info'),
  schedActiveBadge: $('schedule-active-badge'),

  // Moonlight status
  moonlightStatus:     $('moonlight-status'),
  moonlightStatusText: $('moonlight-status-text'),

  connectedAlert: $('connected-alert'),
  btnDisconnect:  $('btn-disconnect'),

  // Modal
  modalOverlay: $('modal-overlay'),
  modalBox:     $('modal-box'),
  modalTitle:   $('modal-title'),
  modalBody:    $('modal-body'),
  modalConfirm: $('modal-confirm'),
  modalCancel:  $('modal-cancel'),
  modalAlt:     $('modal-alt'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPcName(session) {
  if (session && session.host) {
    const parts = session.host.split('.');
    if (parts.length === 4) return 'PC-' + parts[3];
  }
  return session?.machineName || 'Gaming PC';
}

function formatTime(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showAlert(elId, msg, type = 'error') {
  const el = $(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}

function hideAlert(elId) {
  $(elId)?.classList.add('hidden');
}

// ─── Modal System ─────────────────────────────────────────────────────────────
let _modalResolve = null;

function showModal(title, body, confirmText = '확인', cancelText = '취소', altText = null) {
  return new Promise((resolve) => {
    _modalResolve = resolve;

    els.modalTitle.textContent   = title;
    els.modalBody.textContent    = body;
    els.modalConfirm.textContent = confirmText;
    els.modalCancel.textContent  = cancelText;

    if (altText) {
      els.modalAlt.textContent = altText;
      els.modalAlt.classList.remove('hidden');
    } else {
      els.modalAlt.classList.add('hidden');
    }

    if (cancelText) {
      els.modalCancel.classList.remove('hidden');
    } else {
      els.modalCancel.classList.add('hidden');
    }

    els.modalOverlay.classList.remove('hidden');
  });
}

function closeModal(result) {
  els.modalOverlay.classList.add('hidden');
  if (_modalResolve) {
    _modalResolve(result);
    _modalResolve = null;
  }
}

els.modalConfirm.addEventListener('click', () => closeModal('confirm'));
els.modalCancel.addEventListener('click',  () => closeModal('cancel'));
els.modalAlt.addEventListener('click',     () => closeModal('alt'));

// ─── View Switcher ────────────────────────────────────────────────────────────
function showView(name) {
  els.viewIdle.classList.add('hidden');
  els.viewConnecting.classList.add('hidden');
  els.viewConnected.classList.add('hidden');
  const streamView = $('view-streaming');
  if (streamView) streamView.classList.add('hidden');

  $(`view-${name}`)?.classList.remove('hidden');

  if (name === 'streaming') {
    state.status = 'connected';
    // 메인 패널을 검은색 배경으로 (Moonlight 임베드 영역)
    const panel = document.getElementById('main-panel');
    panel.classList.add('streaming-mode');
  } else {
    const panel = document.getElementById('main-panel');
    panel.classList.remove('streaming-mode');
    state.status = name === 'connecting' ? 'connecting' : name === 'connected' ? 'connected' : 'idle';
  }

  // Show/hide end session button
  if (name === 'connected') {
    els.endSession.classList.remove('hidden');
  } else {
    els.endSession.classList.add('hidden');
  }
}

// ─── Sidebar Updates ──────────────────────────────────────────────────────────
function updateSidebar() {
  const u = state.user;
  if (u) {
    const displayName = u.name || u.username || u.email || '사용자';
    const initial = displayName[0].toUpperCase();
    els.userAvatar.textContent = initial;
    els.userName.textContent   = displayName;
    // 사용중인 요금제 표시 (크레딧 기반 추정)
    const planMap = [
      { max: 600, name: '스타터' },
      { max: 1980, name: '스탠다드' },
      { max: 3960, name: '프리미엄' },
      { max: 6660, name: '프로' },
      { max: 19980, name: '프로 MAX' },
    ];
    const credits = u.credits || 0;
    let planName = '서비스';
    for (const p of planMap) {
      if (credits <= p.max) { planName = p.name; break; }
    }
    if (credits > 19980) planName = '프로 MAX';
    els.userPlan.textContent = planName + ' 이용중';
  }
  updateCreditsDisplay();
  updateStatusDisplay();
}

function updateCreditsDisplay() {
  const c = state.credits;
  els.creditsValue.textContent = c;
  const h = Math.floor(c / 60);
  const m = c % 60;
  if (h > 0 && m > 0) {
    els.creditsSub.textContent = `≈ ${h}시간 ${m}분 이용 가능`;
  } else if (h > 0) {
    els.creditsSub.textContent = `≈ ${h}시간 이용 가능`;
  } else {
    els.creditsSub.textContent = c > 0 ? `≈ ${m}분 이용 가능` : '이용 시간이 없습니다';
  }
}

function updateStatusDisplay() {
  const { status } = state;
  const dot  = els.statusDot;
  const text = els.statusText;
  const sub  = els.statusSub;

  dot.className = 'status-dot';

  if (status === 'idle') {
    dot.classList.add('offline');
    text.textContent = '연결 안됨';
    sub.textContent  = 'PC를 배정받으려면 접속하기를 눌러주세요';
  } else if (status === 'connecting') {
    dot.classList.add('loading');
    text.textContent = '연결 중...';
    sub.textContent  = 'PC 배정 중입니다';
  } else if (status === 'connected') {
    dot.classList.add('online');
    text.textContent = '연결됨';
    sub.textContent  = getPcName(state.session);
  }
}

// ─── Notice Board ─────────────────────────────────────────────────────────────
function renderNotice() {
  const notices = state.notices;
  const idx     = state.noticeIndex;

  if (!notices || notices.length === 0) {
    els.noticeContent.innerHTML = '<div class="notice-title text-muted">공지사항이 없습니다</div>';
    els.noticeDots.innerHTML = '';
    return;
  }

  const notice = notices[idx];
  els.noticeContent.innerHTML = `
    <div class="notice-title">${escapeHtml(notice.title)}</div>
    <div class="notice-body">${escapeHtml(notice.body)}</div>
    ${notice.date ? `<div class="notice-date">${escapeHtml(notice.date)}</div>` : ''}
  `;

  // Dots
  els.noticeDots.innerHTML = '';
  notices.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'notice-dot' + (i === idx ? ' active' : '');
    dot.addEventListener('click', () => {
      state.noticeIndex = i;
      renderNotice();
    });
    els.noticeDots.appendChild(dot);
  });

  // Nav buttons
  els.noticePrev.disabled = idx <= 0;
  els.noticeNext.disabled = idx >= notices.length - 1;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

els.noticePrev.addEventListener('click', () => {
  if (state.noticeIndex > 0) {
    state.noticeIndex--;
    renderNotice();
  }
});

els.noticeNext.addEventListener('click', () => {
  if (state.noticeIndex < state.notices.length - 1) {
    state.noticeIndex++;
    renderNotice();
  }
});

async function loadNotices() {
  try {
    const result = await window.R1.fetchNotices();
    if (result && result.notices) {
      state.notices = result.notices;
    } else if (Array.isArray(result)) {
      state.notices = result;
    } else {
      state.notices = [];
    }
  } catch (_) {
    state.notices = [];
  }
  state.noticeIndex = 0;
  renderNotice();
}

// ─── Timer Logic ──────────────────────────────────────────────────────────────
function startTimers() {
  stopTimers();
  state.elapsed = 0;

  timerInterval = setInterval(() => {
    state.elapsed++;

    // Elapsed display
    els.elapsedTime.textContent = formatTime(state.elapsed);

    // Schedule countdown (지금부터 X분 기준 — 매 초 1씩 감소)
    if (state.scheduleRemaining !== null && state.scheduleRemaining > 0) {
      state.scheduleRemaining--;

      if (state.scheduleRemaining <= 0) {
        clearInterval(timerInterval);
        disconnect('⏰ 예약된 종료 시간이 되어 자동 종료되었습니다.');
        return;
      }

      // Warning alerts at specific thresholds
      if (state.scheduleRemaining === 300) {
        showAlert('connected-alert', '⚠️ 5분 후 자동 종료됩니다!', 'warn');
      } else if (state.scheduleRemaining === 60) {
        showAlert('connected-alert', '🚨 1분 후 자동 종료됩니다!', 'warn');
      }

      els.timer2Label.textContent      = '남은 시간';
      els.remainingDisplay.textContent = formatTime(state.scheduleRemaining);
      const remMin = Math.ceil(state.scheduleRemaining / 60);
      els.remainingSub.textContent     = `${remMin}분 남음`;

      els.remainingDisplay.className = 'timer-value';
      if (state.scheduleRemaining <= 300) {
        els.remainingDisplay.classList.add('danger');
      } else if (state.scheduleRemaining <= 600) {
        els.remainingDisplay.classList.add('warn');
      } else {
        els.remainingDisplay.classList.add('gradient');
      }
    } else {
      els.timer2Label.textContent      = '남은 크레딧';
      els.remainingDisplay.textContent = `${state.credits}분`;
      els.remainingDisplay.className   = 'timer-value gradient';
      els.remainingSub.textContent     = '';
    }
  }, 1000);

  // Credits: decrement 1 per 60 seconds
  creditInterval = setInterval(() => {
    if (state.credits > 0) {
      state.credits--;
      updateCreditsDisplay();
    }
    if (state.credits <= 0) {
      clearInterval(creditInterval);
      disconnect('이용 시간이 모두 소진되었습니다.');
    }
  }, 60_000);
}

function stopTimers() {
  clearInterval(timerInterval);
  clearInterval(creditInterval);
  timerInterval  = null;
  creditInterval = null;
}

// ─── Schedule Controls ────────────────────────────────────────────────────────
function getSchedMinutes() {
  return Math.max(1, parseInt(els.schedMinutes.value, 10) || 60);
}

els.schedMinus.addEventListener('click', () => {
  const v = getSchedMinutes();
  els.schedMinutes.value = Math.max(1, v - 1);
});

els.schedPlus.addEventListener('click', () => {
  const v = getSchedMinutes();
  els.schedMinutes.value = Math.min(999, v + 1);
});

els.schedMinutes.addEventListener('input', () => {
  let v = parseInt(els.schedMinutes.value, 10);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 999) v = 999;
  els.schedMinutes.value = v;
});

function applySchedule(mins) {
  state.scheduleMinutes   = mins;
  state.scheduleRemaining = mins * 60;

  if (state.scheduleRemaining <= 0) {
    showAlert('connected-alert', '이미 지난 시간입니다. 더 큰 값을 입력해주세요.', 'warn');
    state.scheduleMinutes = null;
    return;
  }

  hideAlert('connected-alert');
  els.schedActiveBadge.classList.remove('hidden');
  els.btnSchedCancel.classList.remove('hidden');
  els.btnSchedSet.textContent = '변경';
  els.schedMinutes.value = mins;

  const endTime = new Date(Date.now() + state.scheduleRemaining * 1000);
  const hh = String(endTime.getHours()).padStart(2, '0');
  const mm = String(endTime.getMinutes()).padStart(2, '0');

  const remMin = Math.ceil(state.scheduleRemaining / 60);
  els.schedInfo.textContent = `⏰ ${remMin}분 뒤 종료됩니다 (${hh}:${mm})`;
  els.schedInfo.classList.remove('hidden');

  // Show alert notification
  showAlert('connected-alert', `⏰ ${remMin}분 뒤 자동 종료됩니다 (${hh}:${mm})`, 'info');
  setTimeout(() => hideAlert('connected-alert'), 4000);

  updateSidebarSchedule();
}

function cancelSchedule() {
  state.scheduleMinutes   = null;
  state.scheduleRemaining = null;
  els.schedActiveBadge.classList.add('hidden');
  els.btnSchedCancel.classList.add('hidden');
  els.btnSchedSet.textContent = '예약';
  els.schedInfo.classList.add('hidden');

  els.timer2Label.textContent      = '남은 크레딧';
  els.remainingDisplay.textContent = `${state.credits}분`;
  els.remainingDisplay.className   = 'timer-value gradient';

  // Reset sidebar controls
  if (typeof unlockSidebarSched === 'function') unlockSidebarSched();

  showAlert('connected-alert', '예약 종료가 취소되었습니다.', 'info');
  setTimeout(() => hideAlert('connected-alert'), 3000);

  updateSidebarSchedule();
}

els.btnSchedSet.addEventListener('click', () => {
  applySchedule(getSchedMinutes());
});

els.btnSchedCancel.addEventListener('click', () => {
  cancelSchedule();
});

// ─── Moonlight Events ─────────────────────────────────────────────────────────
window.R1.on('moonlight:exited', ({ code } = {}) => {
  // 전체화면 모드 해제
  isStreamFullscreen = false;
  isStreamWindowedFull = false;
  document.body.classList.remove('stream-fullscreen');

  if (state.status === 'connected') {
    disconnect('원격 스트리밍이 종료되었습니다.');
  } else if (state.status === 'connecting') {
    // Moonlight가 연결 완료 전에 종료됨
    const connectBtns = $('connect-buttons');
    const viewConnecting = $('view-connecting');
    if (connectBtns) connectBtns.classList.remove('hidden');
    if (viewConnecting) viewConnecting.classList.add('hidden');
    const usbipProg = $('usbip-progress');
    if (usbipProg) usbipProg.classList.add('hidden');
    state.status = 'idle';
    showAlert('idle-alert', '스트리밍 연결이 실패했습니다.', 'warn');
    window.R1.usbipDisconnect().catch(() => {});
    window.R1.disconnect().catch(() => {});
    updateStatusDisplay();
  }
});

// ─── Moonlight 스트리밍 연결 완료 감지 ─────────────────────────────────────────
window.R1.on('moonlight:streamConnected', () => {
  console.log('[Dashboard] Moonlight stream connected!');
  if (state.status !== 'connecting' || !state.session) return;

  const viewConnecting = $('view-connecting');
  if (viewConnecting) viewConnecting.classList.add('hidden');
  const sessionInfo = $('session-info');
  if (sessionInfo) sessionInfo.classList.remove('hidden');
  $('pc-name').textContent = getPcName(state.session);
  els.endSession.classList.remove('hidden');

  state.status = 'connected';
  state.elapsed = 0;
  startTimers();
  updateStatusDisplay();
});

// ─── Shortcut Events ──────────────────────────────────────────────────────────
let isStreamFullscreen = false;   // 'fullscreen' 모드 활성 여부
let isStreamWindowedFull = false; // 'windowedFull' 모드 활성 여부

window.R1.on('shortcut:fired', (action) => {
  if (action === 'fullscreen') {
    // Ctrl+Alt+F — 전체화면 (테두리 없음, 작업표시줄 덮음)
    if (state.status === 'connected') {
      if (isStreamFullscreen) {
        // 복원
        window.R1.moonlightFullscreen('restore');
        isStreamFullscreen = false;
      } else {
        // 전체창모드가 켜져있으면 먼저 해제
        isStreamWindowedFull = false;
        window.R1.moonlightFullscreen('fullscreen');
        isStreamFullscreen = true;
      }
    }
  } else if (action === 'windowedFull') {
    // Ctrl+Alt+W — 전체창모드 (테두리 있음, 작업표시줄 제외)
    if (state.status === 'connected') {
      if (isStreamWindowedFull) {
        // 복원
        window.R1.moonlightFullscreen('restore');
        isStreamWindowedFull = false;
      } else {
        // 전체화면이 켜져있으면 먼저 해제
        isStreamFullscreen = false;
        window.R1.moonlightFullscreen('windowed');
        isStreamWindowedFull = true;
      }
    }
  } else if (action === 'quit') {
    if (state.status === 'connected') {
      showModal('종료 확인', '현재 원격 접속 중입니다. 종료하시겠습니까?', '종료', '취소').then((res) => {
        if (res === 'confirm') {
          disconnect().then(() => window.R1.close());
        }
      });
    } else {
      window.R1.close();
    }
  } else if (action === 'mute') {
    state.muted = !state.muted;
    if (els.moonlightStatusText) {
      els.moonlightStatusText.textContent = state.muted
        ? 'REMOTE1 스트리밍 중 (음소거)'
        : 'REMOTE1 스트리밍 연결 중';
    }
  } else if (action === 'mouseGrab') {
    state.mouseGrabbed = !state.mouseGrabbed;
  } else if (action === 'toggleSidebar') {
    toggleSidebar();
  }
});

// ─── Connect Flow ─────────────────────────────────────────────────────────────
els.btnConnect.addEventListener('click', () => connect());

// ─── 가상USB 접속 Flow ───────────────────────────────────────────────────────
const btnConnectUsb = $('btn-connect-usb');
if (btnConnectUsb) btnConnectUsb.addEventListener('click', () => connectWithUSB());

// USB/IP 진행상태 표시
window.R1.on('usbip:progress', ({ step, status }) => {
  const stepsEl = $('usbip-steps');
  if (!stepsEl) return;
  const icon = status === 'loading' ? '⏳' : status === 'error' ? '❌' : '✅';
  const line = document.createElement('div');
  line.textContent = `${icon} ${step}: ${status}`;
  line.style.padding = '2px 0';
  stepsEl.appendChild(line);
  stepsEl.scrollTop = stepsEl.scrollHeight;
});

async function connectWithUSB() {
  if (state.status !== 'idle') return;
  if (state.credits <= 0) {
    showAlert('idle-alert', '이용 시간이 없습니다. 충전해주세요.', 'warn');
    return;
  }

  hideAlert('idle-alert');

  // 버튼 숨기고 진행상태 표시
  const connectBtns = $('connect-buttons');
  const usbipProgress = $('usbip-progress');
  const usbipSteps = $('usbip-steps');
  const viewConnecting = $('view-connecting');

  if (connectBtns) connectBtns.classList.add('hidden');
  if (usbipProgress) usbipProgress.classList.remove('hidden');
  if (usbipSteps) usbipSteps.innerHTML = '';

  state.status = 'connecting';
  updateStatusDisplay();

  try {
    // 1) PC 배정
    const addStep = (text) => {
      if (usbipSteps) {
        const line = document.createElement('div');
        line.textContent = text;
        line.style.padding = '2px 0';
        usbipSteps.appendChild(line);
      }
    };

    addStep('⏳ 빈 PC 배정 중...');
    const result = await window.R1.connect();

    if (!result.ok) {
      addStep('❌ PC 배정 실패: ' + (result.error || ''));
      resetUSBFlow(connectBtns, usbipProgress);
      return;
    }
    addStep('✅ PC 배정 완료');

    const session = result.data;
    state.session = session;

    // 2) USB/IP 연결 (원스톱)
    addStep('⏳ 가상USB 연결 시작...');
    const usbResult = await window.R1.usbipConnect(session.host);

    if (!usbResult.ok) {
      addStep('❌ 가상USB 연결 실패: ' + (usbResult.error || ''));
      // USB 실패해도 일반 접속으로 계속할지 물어보기
      const fallback = await showModal(
        'USB 연결 실패',
        '가상USB 연결에 실패했습니다. 일반 접속으로 계속하시겠습니까?',
        '일반 접속', '취소'
      );
      if (fallback !== 'confirm') {
        await window.R1.disconnect().catch(() => {});
        resetUSBFlow(connectBtns, usbipProgress);
        return;
      }
    } else {
      addStep('✅ 가상USB 연결 완료');
    }

    // 3) 스트리밍 시작
    addStep('⏳ 스트리밍 시작 중...');
    if (usbipProgress) usbipProgress.classList.add('hidden');
    if (viewConnecting) viewConnecting.classList.remove('hidden');
    els.connectingMsg.textContent = '스트리밍 연결 중...';

    if (session.host) {
      const mlResult = await window.R1.moonlightLaunch(session.host);
      if (!mlResult.ok) {
        if (connectBtns) connectBtns.classList.remove('hidden');
        if (viewConnecting) viewConnecting.classList.add('hidden');
        state.status = 'idle';
        showAlert('idle-alert', mlResult.error || '스트리밍 연결에 실패했습니다.', 'warn');
        await window.R1.usbipDisconnect().catch(() => {});
        await window.R1.disconnect().catch(() => {});
        updateStatusDisplay();
        return;
      }
    }

    els.connectingMsg.textContent = '원격 PC 연결 대기 중...';

  } catch (err) {
    if (connectBtns) connectBtns.classList.remove('hidden');
    if (usbipProgress) usbipProgress.classList.add('hidden');
    const viewConnecting2 = $('view-connecting');
    if (viewConnecting2) viewConnecting2.classList.add('hidden');
    state.status = 'idle';
    showAlert('idle-alert', err.message || '연결 중 오류가 발생했습니다.', 'warn');
    await window.R1.usbipDisconnect().catch(() => {});
    await window.R1.disconnect().catch(() => {});
    updateStatusDisplay();
  }
}

function resetUSBFlow(connectBtns, usbipProgress) {
  if (connectBtns) connectBtns.classList.remove('hidden');
  if (usbipProgress) usbipProgress.classList.add('hidden');
  state.status = 'idle';
  updateStatusDisplay();
}

async function connect() {
  if (state.status !== 'idle') return;
  if (state.credits <= 0) {
    showAlert('idle-alert', '이용 시간이 없습니다. 충전해주세요.', 'warn');
    return;
  }

  hideAlert('idle-alert');

  // 접속 버튼 숨기고 스피너 표시
  const connectBtns = $('connect-buttons');
  const viewConnecting = $('view-connecting');
  if (connectBtns) connectBtns.classList.add('hidden');
  if (viewConnecting) viewConnecting.classList.remove('hidden');

  state.status = 'connecting';
  updateStatusDisplay();

  try {
    els.connectingMsg.textContent = '빈 PC 배정 중...';
    const result = await window.R1.connect();

    if (!result.ok) {
      if (connectBtns) connectBtns.classList.remove('hidden');
      if (viewConnecting) viewConnecting.classList.add('hidden');
      state.status = 'idle';
      showAlert('idle-alert', result.error || 'PC 배정에 실패했습니다.', 'warn');
      updateStatusDisplay();
      return;
    }

    const session = result.data;
    state.session = session;

    els.connectingMsg.textContent = '스트리밍 연결 중...';

    if (session.host) {
      const mlResult = await window.R1.moonlightLaunch(session.host);
      if (!mlResult.ok) {
        if (btnConnect) btnConnect.classList.remove('hidden');
        if (viewConnecting) viewConnecting.classList.add('hidden');
        state.status = 'idle';
        showAlert('idle-alert', mlResult.error || '스트리밍 연결에 실패했습니다.', 'warn');
        await window.R1.disconnect().catch(() => {});
        updateStatusDisplay();
        return;
      }
    }

    // (일반 접속은 USB/IP 없이 바로 스트리밍)

    // Moonlight 실행 성공 — 스트리밍 연결 대기 중 (버튼 상태 유지)
    // moonlight:streamConnected 이벤트가 오면 그때 "이용 차감 중"으로 전환
    els.connectingMsg.textContent = '원격 PC 연결 대기 중...';

  } catch (err) {
    if (btnConnect) btnConnect.classList.remove('hidden');
    if (viewConnecting) viewConnecting.classList.add('hidden');
    state.status = 'idle';
    showAlert('idle-alert', err.message || '연결 중 오류가 발생했습니다.', 'warn');
    await window.R1.disconnect().catch(() => {});
    updateStatusDisplay();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function enterConnected(session) {
  els.pcName.textContent = getPcName(session);
  els.pcSpec.textContent = session.machineSpec || '';

  state.elapsed           = 0;
  state.scheduleMinutes   = null;
  state.scheduleRemaining = null;
  els.schedMinutes.value  = 60;
  els.schedActiveBadge.classList.add('hidden');
  els.btnSchedCancel.classList.add('hidden');
  els.btnSchedSet.textContent = '예약';
  els.schedInfo.classList.add('hidden');

  els.moonlightStatusText.textContent = 'REMOTE1 스트리밍 연결 중';
  els.moonlightStatus.classList.remove('hidden');

  hideAlert('connected-alert');

  showView('connected');
  updateStatusDisplay();
  startTimers();
}

// ─── Disconnect Flow ──────────────────────────────────────────────────────────
els.btnDisconnect.addEventListener('click', () => promptDisconnect());
els.endSession.addEventListener('click', () => promptDisconnect());

async function promptDisconnect() {
  const result = await showModal(
    '접속 종료',
    '원격 PC 접속을 종료하시겠습니까?',
    '접속 종료',
    '취소',
    '오프라인 유지'
  );

  if (result === 'confirm') {
    await disconnect();
  } else if (result === 'alt') {
    // Kill Moonlight but don't call backend disconnect
    await keepAlive();
  }
  // 'cancel' -> do nothing
}

async function disconnect(reason) {
  stopTimers();

  const usedMinutes = Math.ceil(state.elapsed / 60);
  state.scheduleMinutes = null;
  state.scheduleRemaining = null;

  window.R1.usbipDisconnect().catch(() => {});
  await window.R1.disconnect(usedMinutes).catch(() => {});

  state.session = null;
  state.status = 'idle';
  state.elapsed = 0;

  // 예약 종료 UI 리셋
  if (typeof unlockSidebarSched === 'function') unlockSidebarSched();
  updateSidebarSchedule();

  // UI 복원: 접속 버튼 보이기, 세션 정보 숨기기
  const connectBtns = $('connect-buttons');
  const sessionInfo = $('session-info');
  const usbipProgress = $('usbip-progress');
  if (connectBtns) connectBtns.classList.remove('hidden');
  if (sessionInfo) sessionInfo.classList.add('hidden');
  if (usbipProgress) usbipProgress.classList.add('hidden');
  els.endSession.classList.add('hidden');
  updateStatusDisplay();
  updateCreditsDisplay();

  if (reason) {
    showAlert('idle-alert', reason, 'info');
  }
}

async function keepAlive() {
  // Kill Moonlight without calling backend disconnect
  await window.R1.keepAlive().catch(() => {});

  stopTimers();
  state.scheduleMinutes = null;
  state.scheduleRemaining = null;
  state.session = null;
  state.status = 'idle';
  state.elapsed = 0;

  const connectBtns = $('connect-buttons');
  const sessionInfo = $('session-info');
  if (connectBtns) connectBtns.classList.remove('hidden');
  if (sessionInfo) sessionInfo.classList.add('hidden');

  showView('idle');
  updateStatusDisplay();
  updateCreditsDisplay();
  showAlert('idle-alert', '오프라인 모드로 전환되었습니다. 세션은 유지됩니다.', 'info');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
els.settings?.addEventListener('click', () => {
  window.R1.openSettings();
});

// ─── Logout ───────────────────────────────────────────────────────────────────
els.logout.addEventListener('click', async () => {
  if (state.status === 'connected') {
    const res = await showModal('로그아웃', '현재 접속 중입니다. 접속을 종료하고 로그아웃하시겠습니까?', '로그아웃', '취소');
    if (res !== 'confirm') return;
    await disconnect();
  }
  stopTimers();
  await window.R1.logout();
  await window.R1.goToLogin();
});

// ─── Window Controls ──────────────────────────────────────────────────────────
els.minimize.addEventListener('click', () => window.R1.minimize());
els.maximize.addEventListener('click', () => window.R1.maximize());
els.close.addEventListener('click', async () => {
  if (state.status === 'connected') {
    const res = await showModal('종료 확인', '현재 원격 접속 중입니다. 종료하시겠습니까?', '종료', '취소');
    if (res !== 'confirm') return;
    await disconnect();
  }
  stopTimers();
  await window.R1.moonlightKill().catch(() => {});
  window.R1.close();
});

// ─── Titlebar drag ────────────────────────────────────────────────────────────
(function () {
  const titlebar = document.getElementById('titlebar') || document.querySelector('.titlebar');
  let dragging = false, lastX = 0, lastY = 0;
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.titlebar-controls')) return;
    dragging = true; lastX = e.screenX; lastY = e.screenY;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    window.R1?.moveWindow(e.screenX - lastX, e.screenY - lastY);
    lastX = e.screenX; lastY = e.screenY;
  });
  document.addEventListener('mouseup', () => { dragging = false; });
})();

// (Moonlight install page removed - bundled with launcher)

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await window.R1.getUser();
  if (!res.ok) {
    await window.R1.goToLogin();
    return;
  }

  state.user    = res.data;
  state.credits = res.data.credits ?? 0;
  updateSidebar();

  // Load notices
  await loadNotices();

  // Streaming module check (silent - no user-facing warning)

  showView('idle');
}

// ─── Sidebar Toggle ──────────────────────────────────────────────────────────
let toggleSidebar = function() {
  window.R1.toggleSidebar();
};

// ─── Sidebar Settings Button ─────────────────────────────────────────────────
document.getElementById('btn-sidebar-settings').addEventListener('click', () => {
  window.R1.openSettings();
});

// ─── Sidebar Schedule Widget ─────────────────────────────────────────────────
const sidebarSchedEl       = document.getElementById('sidebar-schedule');
const sidebarSchedStat     = document.getElementById('sidebar-sched-status');
const sidebarSchedMin      = document.getElementById('sidebar-sched-min');
const sidebarSchedCanEl    = document.getElementById('sidebar-sched-cancel');
const sidebarCountdownEl   = document.getElementById('sidebar-sched-countdown');
const sidebarCountdownTime = document.getElementById('sidebar-sched-countdown-time');
const sidebarCountdownSub  = document.getElementById('sidebar-sched-countdown-sub');

function formatCountdown(secs) {
  if (secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateSidebarSchedule() {
  // Always keep all buttons and input enabled
  sidebarSchedEl.style.opacity = '1';

  if (state.scheduleMinutes !== null && state.scheduleRemaining > 0) {
    const remaining = Math.max(0, Math.round(state.scheduleRemaining));
    const endTime = new Date(Date.now() + remaining * 1000);
    const hh = String(endTime.getHours()).padStart(2, '0');
    const mm = String(endTime.getMinutes()).padStart(2, '0');

    // Show countdown
    sidebarCountdownEl.classList.remove('hidden');
    sidebarCountdownTime.textContent = `종료 시간 : ${hh}시 ${mm}분`;
    sidebarCountdownSub.textContent = `남은 시간 ${formatCountdown(remaining)}`;

    // Color warning
    sidebarCountdownEl.classList.remove('warning', 'danger');
    if (remaining <= 300) {
      sidebarCountdownEl.classList.add('danger');
    } else if (remaining <= 600) {
      sidebarCountdownEl.classList.add('warning');
    }

    sidebarSchedStat.style.display = 'none';
  } else {
    sidebarCountdownEl.classList.add('hidden');
    sidebarSchedStat.style.display = '';
    if (state.status === 'connected') {
      sidebarSchedStat.textContent = '예약 가능';
    } else {
      sidebarSchedStat.textContent = '접속 후 설정 가능';
    }
    sidebarSchedStat.className = 'sidebar-sched-status';
  }
}

setInterval(updateSidebarSchedule, 1000);
setTimeout(updateSidebarSchedule, 100);

function sidebarStepMin(delta) {
  if (sidebarSchedLocked) return;
  let v = parseInt(sidebarSchedMin.value, 10) || 60;
  v = Math.max(1, Math.min(999, v + delta));
  sidebarSchedMin.value = v;
}

// Step buttons
document.getElementById('ss-m10').addEventListener('click', () => sidebarStepMin(-10));
document.getElementById('ss-m1').addEventListener('click', () => sidebarStepMin(-1));
document.getElementById('ss-p1').addEventListener('click', () => sidebarStepMin(1));
document.getElementById('ss-p10').addEventListener('click', () => sidebarStepMin(10));

// Quick buttons — add minutes to current value
function sidebarAddMin(delta) {
  if (sidebarSchedLocked) return;
  let v = parseInt(sidebarSchedMin.value, 10) || 0;
  v = Math.max(1, Math.min(999, v + delta));
  sidebarSchedMin.value = v;
}
document.getElementById('ss-q60').addEventListener('click', () => sidebarAddMin(60));
document.getElementById('ss-q120').addEventListener('click', () => sidebarAddMin(120));
document.getElementById('ss-q180').addEventListener('click', () => sidebarAddMin(180));

// Set button
const sidebarSetBtn = document.getElementById('sidebar-sched-set-btn');
const sidebarSchedMsgEl = document.getElementById('sidebar-sched-msg');

let sidebarSchedLocked = false;

function lockSidebarSched() {
  sidebarSchedLocked = true;
  // Disable step buttons, quick buttons, input
  document.querySelectorAll('#ss-m10,#ss-m1,#ss-p1,#ss-p10,#ss-q60,#ss-q120,#ss-q180').forEach(el => {
    el.disabled = true;
    el.style.opacity = '0.3';
    el.style.pointerEvents = 'none';
  });
  sidebarSchedMin.disabled = true;
  sidebarSchedMin.style.opacity = '0.3';
  sidebarSetBtn.style.display = 'none';
  sidebarSchedCanEl.style.display = '';
}

function unlockSidebarSched() {
  sidebarSchedLocked = false;
  document.querySelectorAll('#ss-m10,#ss-m1,#ss-p1,#ss-p10,#ss-q60,#ss-q120,#ss-q180').forEach(el => {
    el.disabled = false;
    el.style.opacity = '';
    el.style.pointerEvents = '';
  });
  sidebarSchedMin.disabled = false;
  sidebarSchedMin.style.opacity = '';
  sidebarSetBtn.style.display = '';
  sidebarSetBtn.textContent = '설정';
  sidebarSetBtn.style.background = '';
  sidebarSetBtn.style.color = '';
  sidebarSetBtn.style.borderColor = '';
  sidebarSchedCanEl.style.display = 'none';
  sidebarSchedMsgEl.classList.add('hidden');
}

sidebarSetBtn.addEventListener('click', () => {
  if (sidebarSchedLocked) return;
  if (state.status !== 'connected') return;
  const v = parseInt(sidebarSchedMin.value, 10);
  if (!v || v < 1) return;

  // Show message
  sidebarSchedMsgEl.textContent = `✅ ${v}분 뒤 자동 종료 예약 완료`;
  sidebarSchedMsgEl.classList.remove('hidden');

  // Lock controls
  lockSidebarSched();

  // Apply actual schedule
  applySchedule(v);
});

// Cancel button
sidebarSchedCanEl.addEventListener('click', () => {
  unlockSidebarSched();
  if (state.status === 'connected') {
    cancelSchedule();
  }
});

init();
