'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('R1', {
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  // ── Window Controls ──────────────────────────────────────────────────────
  minimize:   () => ipcRenderer.invoke('win:minimize'),
  maximize:   () => ipcRenderer.invoke('win:maximize'),
  close:      () => ipcRenderer.invoke('win:close'),
  moveWindow: (dx, dy) => ipcRenderer.invoke('win:move', { dx, dy }),

  // ── Navigation ───────────────────────────────────────────────────────────
  goToMain:      (userData) => ipcRenderer.invoke('nav:toMain', userData),
  goToLogin:     ()         => ipcRenderer.invoke('nav:toLogin'),
  openSettings:  ()         => ipcRenderer.invoke('nav:openSettings'),
  closeSettings: ()         => ipcRenderer.invoke('nav:closeSettings'),

  // ── Auth API ─────────────────────────────────────────────────────────────
  login:   (username, password) => ipcRenderer.invoke('api:login', { username, password }),
  logout:  ()                   => ipcRenderer.invoke('api:logout'),
  getUser: ()                   => ipcRenderer.invoke('api:getUser'),

  // ── Session API ──────────────────────────────────────────────────────────
  connect:    () => ipcRenderer.invoke('api:connect'),
  disconnect: () => ipcRenderer.invoke('api:disconnect'),
  keepAlive:  () => ipcRenderer.invoke('api:keepAlive'),

  // ── Moonlight ────────────────────────────────────────────────────────────
  moonlightLaunch:          (host) => ipcRenderer.invoke('moonlight:launch', host),
  moonlightKill:            ()     => ipcRenderer.invoke('moonlight:kill'),
  moonlightIsInstalled:     ()     => ipcRenderer.invoke('moonlight:isInstalled'),
  moonlightOpenInstallPage: ()     => ipcRenderer.invoke('moonlight:openInstallPage'),

  // ── Settings ─────────────────────────────────────────────────────────────
  loadSettings: ()  => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

  // ── USB (silent) ─────────────────────────────────────────────────────────
  usbConnect:    () => ipcRenderer.invoke('usb:connect'),
  usbDisconnect: () => ipcRenderer.invoke('usb:disconnect'),

  // ── Notices ──────────────────────────────────────────────────────────────
  fetchNotices: () => ipcRenderer.invoke('notices:fetch'),

  // ── Events (renderer listeners) ─────────────────────────────────────────
  on: (channel, fn) => {
    const allowed = ['moonlight:exited', 'shortcut:fired'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => fn(...args));
    }
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
