'use strict';

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const EnumWindows = user32.func('bool __stdcall EnumWindows(void *, intptr)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *, uint32 *)');
const MoveWindow = user32.func('bool __stdcall MoveWindow(void *, int, int, int, int, bool)');
const SetWindowLongW = user32.func('long __stdcall SetWindowLongW(void *, int, long)');
const GetWindowLongW = user32.func('long __stdcall GetWindowLongW(void *, int)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(void *, int)');
const IsWindow = user32.func('bool __stdcall IsWindow(void *)');

let cachedHwnd = null;

function findWindowByPid(pid) {
  let found = null;
  const cb = koffi.register((hwnd, lParam) => {
    const pidBuf = new Uint32Array(1);
    GetWindowThreadProcessId(hwnd, pidBuf);
    if (pidBuf[0] === pid) { found = hwnd; return false; }
    return true;
  }, 'bool __stdcall(void *, intptr)');
  try { EnumWindows(cb, 0); } catch (_) {}
  koffi.unregister(cb);
  return found;
}

function getHwnd(pid) {
  if (cachedHwnd) { try { if (IsWindow(cachedHwnd)) return cachedHwnd; } catch (_) {} }
  cachedHwnd = findWindowByPid(pid);
  return cachedHwnd;
}

function stripStyle(hwnd) {
  if (!hwnd) return;
  try {
    const s = GetWindowLongW(hwnd, -16);
    SetWindowLongW(hwnd, -16, s & ~0x00C00000 & ~0x00040000 & ~0x00800000);
    const ex = GetWindowLongW(hwnd, -20);
    SetWindowLongW(hwnd, -20, ex | 0x00000080);
    ShowWindow(hwnd, 5);
  } catch (_) {}
}

function move(hwnd, x, y, w, h) {
  if (!hwnd) return;
  try { MoveWindow(hwnd, x, y, w, h, true); } catch (_) {}
}

function snap(pid, x, y, w, h) {
  const hwnd = getHwnd(pid);
  if (!hwnd) return false;
  move(hwnd, x, y, w, h);
  return true;
}

function setup(pid, x, y, w, h) {
  const hwnd = getHwnd(pid);
  if (!hwnd) return false;
  stripStyle(hwnd);
  move(hwnd, x, y, w, h);
  return true;
}

function clear() { cachedHwnd = null; }

module.exports = { snap, setup, clear, stripStyle, getHwnd };
