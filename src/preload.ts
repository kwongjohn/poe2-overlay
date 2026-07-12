import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlay', {
  onStatus: (cb: (data: unknown) => void) =>
    ipcRenderer.on('status', (_e, data) => cb(data)),
  onPrice: (cb: (data: unknown) => void) =>
    ipcRenderer.on('price', (_e, data) => cb(data)),
  onRecs: (cb: (data: unknown) => void) =>
    ipcRenderer.on('recs', (_e, data) => cb(data)),
  set: (patch: Record<string, unknown>) => ipcRenderer.send('overlay:set', patch),
  hide: () => ipcRenderer.send('overlay:hide'),
  openSettings: () => ipcRenderer.send('overlay:openSettings'),
  settingsSaved: () => ipcRenderer.send('overlay:settingsSaved'),
});
