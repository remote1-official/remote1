'use strict';

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  resolution:  '1080p',
  fps:         60,
  bitrate:     20000,
  displayMode: 'fullscreen',
  vsync:       true,
  audio:       'stereo',
  muteHost:    false,
  mouseOpt:    true,
  gamepad:     true,
  videoDecoder: 'auto',
  videoCodec:  'auto',
  language:    'auto',
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const bitrateSlider  = document.getElementById('bitrate-slider');
const bitrateDisplay = document.getElementById('bitrate-display');
const vsyncEl        = document.getElementById('vsync');
const muteHostEl     = document.getElementById('mute-host');
const mouseOptEl     = document.getElementById('mouse-opt');
const gamepadEl      = document.getElementById('gamepad');
const videoDecoderEl = document.getElementById('video-decoder');
const videoCodecEl   = document.getElementById('video-codec');
const languageEl     = document.getElementById('language');
const btnSave        = document.getElementById('btn-save');
const btnCancel      = document.getElementById('btn-cancel');
const btnClose       = document.getElementById('btn-close-settings');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setRadio(name, value) {
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  radios.forEach((r) => {
    r.checked = (r.value === String(value));
  });
}

function getRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function updateBitrateDisplay(val) {
  const v = parseInt(val, 10);
  const mbps = (v / 1000).toFixed(1);
  let label;
  if (v <= 10000) label = '낮음';
  else if (v <= 25000) label = '보통';
  else label = '높음';
  bitrateDisplay.textContent = `${mbps} Mbps (${label})`;
}

// ─── Populate form with settings ──────────────────────────────────────────────
function populateForm(settings) {
  const s = Object.assign({}, DEFAULT_SETTINGS, settings);

  setRadio('resolution',   s.resolution);
  setRadio('fps',          String(s.fps));
  setRadio('display-mode', s.displayMode);
  setRadio('audio-mode',   s.audio);

  bitrateSlider.value = s.bitrate;
  updateBitrateDisplay(s.bitrate);

  vsyncEl.checked    = !!s.vsync;
  muteHostEl.checked = !!s.muteHost;
  mouseOptEl.checked = !!s.mouseOpt;
  gamepadEl.checked  = !!s.gamepad;

  videoDecoderEl.value = s.videoDecoder || 'auto';
  videoCodecEl.value   = s.videoCodec   || 'auto';
  languageEl.value     = s.language     || 'auto';
}

// ─── Collect form values ──────────────────────────────────────────────────────
function collectForm() {
  return {
    resolution:   getRadio('resolution')   || DEFAULT_SETTINGS.resolution,
    fps:          parseInt(getRadio('fps') || DEFAULT_SETTINGS.fps, 10),
    bitrate:      parseInt(bitrateSlider.value, 10),
    displayMode:  getRadio('display-mode') || DEFAULT_SETTINGS.displayMode,
    vsync:        vsyncEl.checked,
    audio:        getRadio('audio-mode')   || DEFAULT_SETTINGS.audio,
    muteHost:     muteHostEl.checked,
    mouseOpt:     mouseOptEl.checked,
    gamepad:      gamepadEl.checked,
    videoDecoder: videoDecoderEl.value,
    videoCodec:   videoCodecEl.value,
    language:     languageEl.value,
  };
}

// ─── Bitrate slider live update ───────────────────────────────────────────────
bitrateSlider.addEventListener('input', () => {
  updateBitrateDisplay(bitrateSlider.value);
});

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const settings = collectForm();
  await window.R1.saveSettings(settings).catch(() => {});
  window.R1.closeSettings();
});

// ─── Cancel / Close ───────────────────────────────────────────────────────────
btnCancel.addEventListener('click', () => window.R1.closeSettings());
btnClose.addEventListener('click',  () => window.R1.closeSettings());

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

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const settings = await window.R1.loadSettings();
    populateForm(settings || DEFAULT_SETTINGS);
  } catch (_) {
    populateForm(DEFAULT_SETTINGS);
  }
}

init();
