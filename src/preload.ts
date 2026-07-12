import { contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';

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
  rootPath: path.resolve(__dirname, '..'),
  set: (patch: Record<string, unknown>) => ipcRenderer.send('overlay:set', patch),
  hide: () => ipcRenderer.send('overlay:hide'),
  openSettings: () => ipcRenderer.send('overlay:openSettings'),
  settingsSaved: () => ipcRenderer.send('overlay:settingsSaved'),
});
