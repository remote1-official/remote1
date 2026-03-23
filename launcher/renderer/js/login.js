'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const alertEl = document.getElementById('login-alert');

function toStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Error) return val.message;
  if (typeof val === 'object' && val.message) return String(val.message);
  return JSON.stringify(val);
}

function showAlert(msg) {
  const text = (typeof msg === 'string' && msg) ? msg : (toStr(msg) || '알 수 없는 오류가 발생했습니다.');
  console.log('[showAlert]', text);
  alertEl.textContent = text;
  alertEl.classList.remove('hidden');
}

function hideAlert() {
  alertEl.classList.add('hidden');
  alertEl.textContent = '';
}

function setLoading(loading) {
  const btn     = document.getElementById('btn-login');
  const text    = document.getElementById('btn-text');
  const spinner = document.getElementById('btn-spinner');

  btn.disabled = loading;
  text.textContent = loading ? '로그인 중...' : '로그인';
  spinner.classList.toggle('hidden', !loading);
}

// ─── Global error capture ────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  console.error('[Renderer Error]', e.error || e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Promise]', e.reason);
});

// ─── Window controls ──────────────────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.R1?.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.R1?.close());

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

// ─── Saved credentials ────────────────────────────────────────────────────────
(function loadSaved() {
  const savedId = localStorage.getItem('r1_saved_id');
  const savedPw = localStorage.getItem('r1_saved_pw');

  if (savedId) {
    document.getElementById('username').value = savedId;
    document.getElementById('save-id').checked = true;
  }
  if (savedPw) {
    document.getElementById('password').value = savedPw;
    document.getElementById('save-pw').checked = true;
  }
})();

// ─── Form Submit ──────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showAlert('아이디와 비밀번호를 입력해주세요.');
    return;
  }

  // Save / remove credentials
  const saveId = document.getElementById('save-id').checked;
  const savePw = document.getElementById('save-pw').checked;

  if (saveId) {
    localStorage.setItem('r1_saved_id', username);
  } else {
    localStorage.removeItem('r1_saved_id');
  }

  if (savePw) {
    localStorage.setItem('r1_saved_pw', password);
  } else {
    localStorage.removeItem('r1_saved_pw');
  }

  if (!window.R1) {
    showAlert('런처 초기화 오류가 발생했습니다. 앱을 재시작해주세요.');
    return;
  }

  setLoading(true);

  try {
    const result = await window.R1.login(username, password);
    console.log('[login] result:', JSON.stringify(result));

    if (!result || !result.ok) {
      const errMsg = (result && typeof result.error === 'string' && result.error)
        ? result.error
        : '로그인에 실패했습니다.';
      showAlert(errMsg);
      return;
    }

    await window.R1.goToMain(result.data);

  } catch (err) {
    console.log('[login] catch err:', String(err));
    let errMsg = '오류가 발생했습니다.';
    if (typeof err === 'string' && err) errMsg = err;
    else if (err && typeof err.message === 'string' && err.message) errMsg = err.message;
    showAlert(errMsg);
  } finally {
    setLoading(false);
  }
});

// ─── Homepage button ──────────────────────────────────────────────────────────
document.getElementById('btn-homepage').addEventListener('click', () => {
  window.R1.openExternal('https://project-six-sable-26.vercel.app/remote1.html');
});

// ─── Init ─────────────────────────────────────────────────────────────────────
hideAlert();
const usernameEl = document.getElementById('username');
if (usernameEl && !usernameEl.value) usernameEl.focus();
else if (usernameEl && usernameEl.value) document.getElementById('password').focus();
