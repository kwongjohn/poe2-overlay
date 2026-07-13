// NOTE: preloads run SANDBOXED (Electron 20+ default) — no require('path'), no
// __dirname; either one throws/undefines and kills the whole bridge, and with
// it every button in every window (bug found + diagnosed 2026-07-12; see
// wirePreloadDiag in main.ts). Anything environmental comes from main via IPC.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlay', {
  onStatus: (cb: (data: unknown) => void) =>
    ipcRenderer.on('status', (_e, data) => cb(data)),
  onPrice: (cb: (data: unknown) => void) =>
    ipcRenderer.on('price', (_e, data) => cb(data)),
  onRecs: (cb: (data: unknown) => void) =>
    ipcRenderer.on('recs', (_e, data) => cb(data)),
  onNotice: (cb: (data: unknown) => void) =>
    ipcRenderer.on('notice', (_e, data) => cb(data)),
  onPin: (cb: (data: unknown) => void) =>
    ipcRenderer.on('pin', (_e, data) => cb(data)),
  rootPath: ipcRenderer.sendSync('overlay:getRoot'),
  set: (patch: Record<string, unknown>) => ipcRenderer.send('overlay:set', patch),
  hide: () => ipcRenderer.send('overlay:hide'),
  openSettings: () => ipcRenderer.send('overlay:openSettings'),
  settingsSaved: () => ipcRenderer.send('overlay:settingsSaved'),
});
