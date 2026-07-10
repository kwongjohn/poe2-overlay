// Phase 1: overlay shell hosting the vendored build-tracker UI.
//   - Spawns the zero-dep companion server (server/index.mjs) via ELECTRON_RUN_AS_NODE
//     and loads the UI it serves at http://127.0.0.1:4517 (same origin as /api).
//   - Panel = frameless always-on-top window: chrome bar (settings) + WebContentsView.
//   - Hotkey (default Ctrl+Alt+O, only while the game is attached) toggles the panel.
//   - Settings (opacity/size/corner/custom drag position/hotkey) persist via
//     PUT /api/settings under `overlay`.
// Compliance: display + clipboard read only. No memory reading, no input injection.

import { app, BrowserWindow, WebContentsView, Tray, Menu, screen, clipboard, ipcMain, nativeImage } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as koffi from 'koffi';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { parseItem, looksLikeItem } from './item-parser';

const ROOT = path.join(__dirname, '..');
const API = 'http://127.0.0.1:4517';
const BAR_H = 34;
const MARGIN = 16;
const SIZES: Record<string, [number, number]> = { S: [900, 600], M: [1100, 720], L: [1400, 850] };
const HOTKEYS: Record<string, { ctrl: boolean; alt: boolean; keycode: number }> = {
  'Ctrl+Alt+O': { ctrl: true, alt: true, keycode: UiohookKey.O },
  'Ctrl+Alt+Space': { ctrl: true, alt: true, keycode: UiohookKey.Space },
  'F8': { ctrl: false, alt: false, keycode: UiohookKey.F8 },
  'F9': { ctrl: false, alt: false, keycode: UiohookKey.F9 },
};

// --- win32 via koffi ---------------------------------------------------------
const user32 = koffi.load('user32.dll');
const GetForegroundWindow = user32.func('GetForegroundWindow', 'void *', []);
const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', 'char16_t *', 'int']);
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const GetWindowRect = user32.func('GetWindowRect', 'bool', ['void *', koffi.out(koffi.pointer(RECT))]);
const FindWindowW = user32.func('FindWindowW', 'void *', ['char16_t *', 'char16_t *']);

function windowTitle(hwnd: unknown): string {
  const buf = Buffer.alloc(512);
  const len = GetWindowTextW(hwnd, buf, 255);
  return len > 0 ? buf.toString('utf16le', 0, len * 2) : '';
}

// --- config / state ----------------------------------------------------------
const targetArg = process.argv.find(a => a.startsWith('--target='))?.slice(9);
const TARGET = new RegExp(targetArg ?? 'Path of Exile 2', 'i');
const TARGET_EXACT = targetArg ? null : 'Path of Exile 2'; // for FindWindowW when hidden

type OverlaySettings = {
  opacity: number; size: string; corner: string; hotkey: string;
  customDx: number; customDy: number;
};
const DEFAULTS: OverlaySettings = {
  opacity: 0.96, size: 'M', corner: 'bottom-right', hotkey: 'Ctrl+Alt+O',
  customDx: 0, customDy: 0,
};

let win: BrowserWindow | null = null;
let priceWin: BrowserWindow | null = null;
let priceTimer: NodeJS.Timeout | null = null;
let view: WebContentsView | null = null;
let tray: Tray | null = null;
let serverProc: ChildProcess | null = null;
let cfg: OverlaySettings = { ...DEFAULTS };
let ownHwnd = 0n;
let attached = false;        // game (or our panel) has foreground
let panelOpen = false;
let lastGameRect: { x: number; y: number; width: number; height: number } | null = null;
let selfMove = false;        // suppress 'move' events we caused
let saveTimer: NodeJS.Timeout | null = null;
let lastItem = '';

function log(msg: string) { console.log(`[overlay] ${msg}`); }

// --- companion server --------------------------------------------------------
function startServer() {
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '4517' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  serverProc.on('exit', code => log(`companion server exited (${code})`));
}

async function waitForServer(timeoutMs = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// --- settings ----------------------------------------------------------------
async function loadCfg() {
  try {
    const s = await (await fetch(`${API}/api/settings`)).json();
    cfg = { ...DEFAULTS, ...(s.overlay || {}) };
  } catch { cfg = { ...DEFAULTS }; }
}

function persistCfg() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(`${API}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlay: cfg }),
    }).catch(e => log(`settings save failed: ${e}`));
  }, 500);
}

function applyCfg() {
  if (!win) return;
  win.setOpacity(cfg.opacity);
  const [w, h] = SIZES[cfg.size] || SIZES.M;
  const b = win.getBounds();
  if (b.width !== w || b.height !== h) {
    selfMove = true;
    win.setBounds({ ...b, width: w, height: h });
    selfMove = false;
    layoutView();
  }
  reposition();
  sendStatus();
}

function sendStatus() {
  win?.webContents.send('status', { attached, panelOpen, cfg, item: lastItem });
}

// --- geometry ----------------------------------------------------------------
function layoutView() {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: BAR_H, width: w, height: h - BAR_H });
}

function gameDipRect(): { x: number; y: number; width: number; height: number } | null {
  // Prefer the foreground window if it's the game; else find the game window by title.
  let hwnd = GetForegroundWindow();
  if (!hwnd || !TARGET.test(windowTitle(hwnd))) {
    hwnd = TARGET_EXACT ? FindWindowW(null, TARGET_EXACT) : null;
    if (!hwnd) return null;
  }
  const r = {} as { left: number; top: number; right: number; bottom: number };
  if (!GetWindowRect(hwnd, r)) return null;
  return screen.screenToDipRect(win, {
    x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top,
  });
}

function reposition() {
  if (!win) return;
  const g = gameDipRect();
  if (!g) return;
  lastGameRect = g;
  const [w, h] = win.getSize();
  let x = g.x + g.width - w - MARGIN, y = g.y + g.height - h - MARGIN; // bottom-right default
  if (cfg.corner === 'top-left') { x = g.x + MARGIN; y = g.y + MARGIN; }
  if (cfg.corner === 'top-right') { y = g.y + MARGIN; }
  if (cfg.corner === 'bottom-left') { x = g.x + MARGIN; }
  if (cfg.corner === 'custom') { x = g.x + cfg.customDx; y = g.y + cfg.customDy; }
  selfMove = true;
  win.setPosition(Math.round(x), Math.round(y));
  selfMove = false;
}

// --- attach / panel ----------------------------------------------------------
function setPanel(open: boolean) {
  if (!win) return;
  panelOpen = open;
  if (open) { reposition(); win.show(); win.focus(); }
  else win.hide();
  log(`panel ${open ? 'open' : 'closed'}`);
  sendStatus();
}

function poll() {
  if (!win) return;
  const hwnd = GetForegroundWindow();
  if (!hwnd) return;
  if (koffi.address(hwnd) === ownHwnd) return; // interacting with our panel

  const isGame = TARGET.test(windowTitle(hwnd));
  if (isGame && !attached) { attached = true; log('game attached'); sendStatus(); }
  if (isGame && panelOpen) reposition(); // follow if the game window moves
  if (!isGame && attached) {
    attached = false;
    if (panelOpen) setPanel(false); // never linger over other apps
    priceWin?.hide();
    log('game detached');
    sendStatus();
  }
}

// --- price card ----------------------------------------------------------------
function makePriceWin() {
  // NOTE: no `focusable: false` — on Windows that silently breaks alwaysOnTop
  // (electron quirk), which left the card behind the game. showInactive() +
  // setIgnoreMouseEvents() already keep it from stealing focus or clicks.
  priceWin = new BrowserWindow({
    width: 300, height: 130, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  priceWin.setAlwaysOnTop(true, 'screen-saver');
  priceWin.setIgnoreMouseEvents(true);
  priceWin.loadFile(path.join(ROOT, 'src', 'price-card.html'));
}

function showPriceCard(item: unknown, price: unknown) {
  if (!priceWin) return;
  if (priceWin.webContents.isLoading()) {
    priceWin.webContents.once('did-finish-load', () => showPriceCard(item, price));
    return;
  }
  priceWin.webContents.send('price', { item, price });
  // Near the cursor, clamped to the display the cursor is on.
  const cur = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cur).workArea;
  const [w, h] = priceWin.getSize();
  priceWin.setPosition(
    Math.min(cur.x + 24, wa.x + wa.width - w - 8),
    Math.min(cur.y + 24, wa.y + wa.height - h - 8),
  );
  priceWin.showInactive();
  if (priceTimer) clearTimeout(priceTimer);
  priceTimer = setTimeout(() => priceWin?.hide(), 6000);
}

// --- clipboard capture (user-pressed Ctrl+C only) ------------------------------
function captureClipboard() {
  setTimeout(async () => {
    const text = clipboard.readText();
    if (!looksLikeItem(text)) return;
    const parsed = parseItem(text);
    lastItem = parsed
      ? [parsed.name, parsed.baseType].filter(Boolean).join(' · ')
      : text.split('\n', 2).map(s => s.trim()).join(' · ');
    try {
      await fetch(`${API}/api/current/item`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: text, parsed }),
      });
      lastItem += ' ✓';
    } catch (e) { log(`item ingest failed: ${e}`); }
    log(`item captured (${lastItem})`);
    sendStatus();
    if (parsed) {
      try {
        const price = await (await fetch(`${API}/api/price`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parsed }),
        })).json();
        showPriceCard(parsed, price);
        if (price.found) log(`price: ${price.price} ex (${price.name || parsed.name}) via ${price.source}`);
        else log(`unpriced: ${price.note || 'unknown'}`);
      } catch (e) { log(`price lookup failed: ${e}`); }
    }
  }, 150);
}

// --- hotkeys ------------------------------------------------------------------
function startHotkeys() {
  uIOhook.on('keydown', e => {
    if (!attached) return; // never react outside the game
    const hk = HOTKEYS[cfg.hotkey] || HOTKEYS['Ctrl+Alt+O'];
    if (e.ctrlKey === hk.ctrl && e.altKey === hk.alt && e.keycode === hk.keycode) {
      setPanel(!panelOpen);
    }
    if (e.ctrlKey && e.keycode === UiohookKey.C) captureClipboard();
  });
  uIOhook.start();
  log(`hotkeys active (while attached): ${cfg.hotkey} = toggle panel, Ctrl+C = capture item`);
}

// --- IPC from the chrome bar ---------------------------------------------------
ipcMain.on('overlay:set', (_e, patch: Partial<OverlaySettings>) => {
  cfg = { ...cfg, ...patch };
  applyCfg();
  persistCfg();
});
ipcMain.on('overlay:hide', () => setPanel(false));

// --- app -----------------------------------------------------------------------
app.whenReady().then(async () => {
  startServer();
  const up = await waitForServer();
  if (!up) log('WARNING: companion server did not come up; UI will not load');
  // A foreign server on 4517 (e.g. the standalone build tracker still running)
  // answers /api but can't serve our UI. Detect and say so instead of a blank panel.
  try {
    if ((await fetch(API)).status === 404) {
      log('WARNING: port 4517 is served by another companion server (old build tracker?). Close it and restart the overlay.');
    }
  } catch { /* unreachable = already warned above */ }

  const [w, h] = SIZES[DEFAULTS.size];
  win = new BrowserWindow({
    width: w, height: h, frame: false, resizable: false, show: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#10141c',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenu(null);
  ownHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  await win.loadFile(path.join(ROOT, 'src', 'chrome.html'));

  makePriceWin();
  view = new WebContentsView({ webPreferences: {} });
  win.contentView.addChildView(view);
  layoutView();
  view.webContents.loadURL(API);

  // User dragged the bar → remember position relative to the game window.
  win.on('moved', () => {
    if (selfMove || !win || !lastGameRect) return;
    const [x, y] = win.getPosition();
    cfg.corner = 'custom';
    cfg.customDx = x - lastGameRect.x;
    cfg.customDy = y - lastGameRect.y;
    persistCfg();
    sendStatus();
  });

  await loadCfg();
  applyCfg();

  // Tray: the only always-visible handle on a frameless hidden overlay.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR4nGNgYPj/n4GBgYGJgYGBgYGB4T8DA8N/BgYGBgaG/wwMDAwMAF9uBP2/kkkSAAAAAElFTkSuQmCC');
  tray = new Tray(icon);
  tray.setToolTip('PoE2 Overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Toggle panel', click: () => setPanel(!panelOpen) },
    { label: 'Quit', click: () => app.quit() },
  ]));

  startHotkeys();
  setInterval(poll, 500);
  log(`watching for foreground window matching /${TARGET.source}/i`);
});

app.on('will-quit', () => { uIOhook.stop(); serverProc?.kill(); });
app.on('window-all-closed', () => app.quit());
