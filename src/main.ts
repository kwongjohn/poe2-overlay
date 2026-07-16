// Phase 1: overlay shell hosting the vendored build-tracker UI.
//   - Spawns the zero-dep companion server (server/index.mjs) via ELECTRON_RUN_AS_NODE
//     and loads the UI it serves at http://127.0.0.1:4517 (same origin as /api).
//   - Panel = frameless always-on-top window: chrome bar (settings) + WebContentsView.
//   - Hotkey (default Ctrl+Alt+O, only while the game is attached) toggles the panel.
//   - Settings (opacity/size/corner/custom drag position/hotkey) persist via
//     PUT /api/settings under `overlay`.
// Compliance: display + clipboard read only. No memory reading, no input injection.

import { app, BrowserWindow, WebContentsView, Tray, Menu, screen, clipboard, ipcMain, nativeImage, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as koffi from 'koffi';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { parseItem, looksLikeItem } from './item-parser';

// Packaged: read-only app files live in resources/ (extraResources) and state
// goes to userData; dev: everything is the project root.
const ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const STATE_DIR = app.isPackaged ? app.getPath('userData') : ROOT;
const API = 'http://127.0.0.1:4517';
const BAR_H = 34;
const MARGIN = 16;
const SIZES: Record<string, [number, number]> = { S: [900, 600], M: [1100, 720], L: [1400, 850] };

// "Ctrl+Alt+O" / "Shift+F8" / "Space" → uiohook chord. Supported keys: A–Z,
// F1–F12, Space (what UiohookKey names directly).
function parseHotkey(s: string, fallback = 'Ctrl+Alt+O') {
  const parts = (s || fallback).split('+').map((p) => p.trim()).filter(Boolean);
  const raw = parts.pop() || 'O';
  const name = raw.length === 1 ? raw.toUpperCase() : raw[0].toUpperCase() + raw.slice(1);
  const keycode = (UiohookKey as unknown as Record<string, number>)[name];
  const has = (m: string) => parts.some((p) => p.toLowerCase() === m);
  return {
    ctrl: has('ctrl'), alt: has('alt'), shift: has('shift'),
    keycode: keycode ?? (UiohookKey as unknown as Record<string, number>).O,
  };
}

// --- win32 via koffi ---------------------------------------------------------
const user32 = koffi.load('user32.dll');
const GetForegroundWindow = user32.func('GetForegroundWindow', 'void *', []);
const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', 'char16_t *', 'int']);
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const GetWindowRect = user32.func('GetWindowRect', 'bool', ['void *', koffi.out(koffi.pointer(RECT))]);
const FindWindowW = user32.func('FindWindowW', 'void *', ['char16_t *', 'char16_t *']);
const GetClassNameW = user32.func('GetClassNameW', 'int', ['void *', 'char16_t *', 'int']);

function windowTitle(hwnd: unknown): string {
  const buf = Buffer.alloc(512);
  const len = GetWindowTextW(hwnd, buf, 255);
  return len > 0 ? buf.toString('utf16le', 0, len * 2) : '';
}

function windowClass(hwnd: unknown): string {
  const buf = Buffer.alloc(512);
  const len = GetClassNameW(hwnd, buf, 255);
  return len > 0 ? buf.toString('utf16le', 0, len * 2) : '';
}

// The game's window class (verified live 2026-07-12: PathOfExileSteam.exe,
// class POEWindowClass). Title alone is spoofable by browser tabs / Explorer
// folders named after the game — that re-attached the HUD over other apps.
const GAME_CLASS = 'POEWindowClass';
function isGameWindow(hwnd: unknown, title: string): boolean {
  if (!TARGET.test(title)) return false;
  return targetArg ? true : windowClass(hwnd) === GAME_CLASS;
}

// --- config / state ----------------------------------------------------------
const targetArg = process.argv.find(a => a.startsWith('--target='))?.slice(9);
let TARGET = new RegExp(targetArg ?? 'Path of Exile 2', 'i');

type OverlaySettings = {
  opacity: number; size: string; corner: string; hotkey: string; recsHotkey: string;
  customDx: number; customDy: number; hud: boolean; hudPos: string; target: string;
  quitOnGameExit: boolean; startWithWindows: boolean;
};
const DEFAULTS: OverlaySettings = {
  opacity: 0.96, size: 'M', corner: 'bottom-right', hotkey: 'Ctrl+Alt+O',
  recsHotkey: 'Ctrl+Alt+U', customDx: 0, customDy: 0, hud: true,
  hudPos: 'top-center', target: 'Path of Exile 2',
  quitOnGameExit: false, startWithWindows: false,
};

let win: BrowserWindow | null = null;
let priceWin: BrowserWindow | null = null;
let hudWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
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
let lastTradeUrl: string | null = null;
let pinned = false;
let lastGameSeen = 0;   // for quit-on-game-exit
let everSawGame = false;

function log(msg: string) { console.log(`[overlay] ${msg}`); }

// A broken preload silently kills window.overlay and every button with it —
// make it loud in the log instead.
function wirePreloadDiag(w: BrowserWindow, name: string) {
  w.webContents.on('preload-error', (_e, p, err) => log(`PRELOAD ERROR in ${name} (${p}): ${err}`));
  w.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) log(`[${name}] ${msg}`);
  });
}

// --- companion server --------------------------------------------------------
function startServer() {
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '4517',
      POE2_STATE_DIR: STATE_DIR,
    },
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
  // The CLI --target flag (spike/testing) wins over the setting.
  if (!targetArg && cfg.target) TARGET = new RegExp(cfg.target, 'i');
  win.setOpacity(cfg.opacity);
  app.setLoginItemSettings({
    openAtLogin: !!cfg.startWithWindows,
    path: process.execPath,
    args: [ROOT],
  });
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
  // Prefer the foreground window if it's the game; else find the game window
  // by class (or by exact title in --target test mode).
  let hwnd = GetForegroundWindow();
  if (!hwnd || !isGameWindow(hwnd, windowTitle(hwnd))) {
    hwnd = targetArg ? FindWindowW(null, targetArg) : FindWindowW(GAME_CLASS, null);
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

  const isGame = isGameWindow(hwnd, windowTitle(hwnd));
  // Quit-with-the-game: once we've seen the game, if its window is gone
  // (not just unfocused) for >2 min and the option is on, exit.
  const gameExists = isGame
    || !!(targetArg ? FindWindowW(null, targetArg) : FindWindowW(GAME_CLASS, null));
  if (gameExists) { lastGameSeen = Date.now(); everSawGame = true; }
  else if (cfg.quitOnGameExit && everSawGame && Date.now() - lastGameSeen > 120000) {
    log('game closed >2 min and quitOnGameExit is on — exiting');
    app.quit();
    return;
  }
  if (isGame && !attached) {
    attached = true;
    setHudVisible(cfg.hud !== false);
    log('game attached');
    sendStatus();
  }
  if (isGame) {
    if (panelOpen) reposition(); // follow if the game window moves
    if (cfg.hud !== false) positionHud();
  }
  if (!isGame && attached) {
    attached = false;
    if (panelOpen) setPanel(false); // never linger over other apps
    priceWin?.hide();
    setHudVisible(false);
    log('game detached');
    sendStatus();
  }
  // Self-heal: whatever the cause, a visible HUD while detached is wrong.
  if (!isGame && !attached && hudWin?.isVisible()) {
    hudWin.hide();
    log('hud self-heal: hidden while detached');
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
  wirePreloadDiag(priceWin, 'price-card');
  priceWin.loadFile(path.join(ROOT, 'src', 'price-card.html'));
}

function showPriceCard(item: unknown, price: { advice?: { findings: unknown[], rewards: unknown[] } }) {
  if (!priceWin) return;
  if (priceWin.webContents.isLoading()) {
    priceWin.webContents.once('did-finish-load', () => showPriceCard(item, price));
    return;
  }
  // Taller card when pick advice is present (verdict + findings + rewards).
  const a = price.advice;
  const cardH = a ? Math.min(150 + 20 + Math.min(a.findings.length, 5) * 16 + (a.rewards.length ? 20 : 0), 280) : 130;
  priceWin.setSize(a ? 340 : 300, cardH);
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
  if (!pinned) priceTimer = setTimeout(() => priceWin?.hide(), 6000);
}

// First-run/setup notice: one toast listing anything that degrades features,
// shown once per launch and only when something is actually missing.
async function startupNotice() {
  try {
    const h = await (await fetch(`${API}/api/health`)).json();
    const missing: string[] = [];
    if (!h.trade?.poesessid) missing.push('POESESSID not set (⚙ Settings → Account) — rare-item pricing disabled');
    if (!h.target) missing.push('No compare target build (panel → Library → 🎯) — advisor & shopping list limited');
    if (!h.clientTxt) missing.push('Client.txt not found (⚙ Settings → Game) — live tracking off');
    if (!missing.length || !priceWin) return;
    const show = () => {
      priceWin!.setSize(400, 88 + missing.length * 30);
      priceWin!.webContents.send('notice', { title: 'Setup checklist', lines: missing });
      const wa = screen.getPrimaryDisplay().workArea;
      const [w, h2] = priceWin!.getSize();
      priceWin!.setPosition(wa.x + wa.width - w - 16, wa.y + wa.height - h2 - 16);
      priceWin!.showInactive();
      priceTimer = setTimeout(() => priceWin?.hide(), 15000);
    };
    if (priceWin.webContents.isLoading()) priceWin.webContents.once('did-finish-load', show);
    else show();
  } catch { /* server not up — nothing to say */ }
}

// --- session HUD strip -----------------------------------------------------------
function makeHudWin() {
  hudWin = new BrowserWindow({
    width: 480, height: 34, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {}, // plain page; talks to the companion server directly
  });
  hudWin.setAlwaysOnTop(true, 'screen-saver');
  hudWin.setIgnoreMouseEvents(true);
  hudWin.loadFile(path.join(ROOT, 'src', 'hud.html'));
}

function positionHud() {
  if (!hudWin) return;
  const g = gameDipRect();
  if (!g) return;
  const [w, h] = hudWin.getSize();
  let x = g.x + (g.width - w) / 2, y = g.y + 6; // top-center default
  if (cfg.hudPos === 'top-left') x = g.x + 16;
  if (cfg.hudPos === 'top-right') x = g.x + g.width - w - 16;
  if (cfg.hudPos === 'bottom-center') y = g.y + g.height - h - 6;
  hudWin.setPosition(Math.round(x), Math.round(y));
}

function setHudVisible(on: boolean) {
  if (!hudWin) return;
  if (on) { positionHud(); hudWin.showInactive(); } else hudWin.hide();
}

// --- recommendations card (priced target-gear shopping list) --------------------
async function showRecs() {
  if (!priceWin) return;
  if (priceWin.webContents.isLoading()) {
    priceWin.webContents.once('did-finish-load', () => showRecs());
    return;
  }
  let recs: { items?: unknown[] } = {};
  try {
    recs = await (await fetch(`${API}/api/recommendations`)).json();
  } catch (e) { log(`recs fetch failed: ${e}`); return; }
  const rows = Math.min((recs.items || []).length, 10);
  priceWin.setSize(380, Math.min(96 + rows * 17, 300));
  priceWin.webContents.send('recs', recs);
  const cur = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cur).workArea;
  const [w, h] = priceWin.getSize();
  priceWin.setPosition(
    Math.min(cur.x + 24, wa.x + wa.width - w - 8),
    Math.min(cur.y + 24, wa.y + wa.height - h - 8),
  );
  priceWin.showInactive();
  if (priceTimer) clearTimeout(priceTimer);
  priceTimer = setTimeout(() => priceWin?.hide(), 12000);
}

// --- map-run summary card --------------------------------------------------------
let lastRunId: string | null = null;
let runsPrimed = false; // first poll just records the latest id, no card

function showRunCard(run: { items?: unknown[]; currencies?: Record<string, number> }) {
  if (!priceWin) return;
  if (priceWin.webContents.isLoading()) {
    priceWin.webContents.once('did-finish-load', () => showRunCard(run));
    return;
  }
  const rows = 4 + Math.min(Object.keys(run.currencies || {}).length, 5);
  priceWin.setSize(380, Math.min(110 + rows * 17, 300));
  priceWin.webContents.send('run', run);
  const cur = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cur).workArea;
  const [w, h] = priceWin.getSize();
  priceWin.setPosition(
    Math.min(cur.x + 24, wa.x + wa.width - w - 8),
    Math.min(cur.y + 24, wa.y + wa.height - h - 8),
  );
  priceWin.showInactive();
  if (priceTimer) clearTimeout(priceTimer);
  priceTimer = setTimeout(() => priceWin?.hide(), 20000);
}

async function checkRuns(showLatest = false) {
  try {
    const d = await (await fetch(`${API}/api/runs`)).json();
    const latest = d.runs && d.runs[0];
    if (!latest) return;
    if (showLatest) { showRunCard(latest); lastRunId = latest.id; return; }
    if (!runsPrimed) { runsPrimed = true; lastRunId = latest.id; return; }
    if (latest.id !== lastRunId) {
      lastRunId = latest.id;
      log(`map run closed: ${latest.area} — showing summary`);
      showRunCard(latest);
    }
  } catch { /* server busy/down; next tick */ }
}

// --- clipboard capture (user-pressed Ctrl+C only) ------------------------------
function captureClipboard() {
  setTimeout(async () => {
    const text = clipboard.readText();
    if (!looksLikeItem(text)) return;
    // Consume the item text so Ctrl+C on empty ground doesn't re-trigger the
    // card with the previous item (the game rewrites the clipboard on every
    // real item copy, so repeat checks of the same item still work).
    clipboard.writeText('');
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
        lastTradeUrl = price.tradeUrl || null;
        pinned = false;
        showPriceCard(parsed, price);
        if (price.found) log(`price: ${price.price} ex (${price.name || parsed.name}) via ${price.source}`);
        else log(`unpriced: ${price.note || 'unknown'}`);
      } catch (e) { log(`price lookup failed: ${e}`); }
    }
  }, 150);
}

// --- hotkeys ------------------------------------------------------------------
function startHotkeys() {
  const chordMatch = (e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; keycode: number },
    hk: { ctrl: boolean; alt: boolean; shift: boolean; keycode: number }) =>
    e.ctrlKey === hk.ctrl && e.altKey === hk.alt && e.shiftKey === hk.shift && e.keycode === hk.keycode;
  uIOhook.on('keydown', e => {
    if (!attached) return; // never react outside the game
    if (chordMatch(e, parseHotkey(cfg.hotkey))) setPanel(!panelOpen);
    if (chordMatch(e, parseHotkey(cfg.recsHotkey, 'Ctrl+Alt+U'))) void showRecs();
    // Fixed chords: T = open the last trade search in the browser, P = pin the card.
    if (e.ctrlKey && e.altKey && e.keycode === UiohookKey.M) void checkRuns(true);
    if (e.ctrlKey && e.altKey && e.keycode === UiohookKey.T && lastTradeUrl) {
      log(`opening trade search: ${lastTradeUrl}`);
      void shell.openExternal(lastTradeUrl);
    }
    if (e.ctrlKey && e.altKey && e.keycode === UiohookKey.P && priceWin?.isVisible()) {
      pinned = !pinned;
      if (pinned && priceTimer) clearTimeout(priceTimer);
      if (!pinned) { priceTimer = setTimeout(() => priceWin?.hide(), 3000); }
      priceWin.webContents.send('pin', pinned);
      log(`card ${pinned ? 'pinned' : 'unpinned'}`);
    }
    if (e.ctrlKey && e.keycode === UiohookKey.C) captureClipboard();
  });
  uIOhook.start();
  log(`hotkeys active (while attached): ${cfg.hotkey} = toggle panel, Ctrl+C = capture item, Ctrl+Alt+U = upgrade list`);
}

// --- settings window -------------------------------------------------------------
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 780, title: 'PoE2 Overlay — Settings',
    autoHideMenuBar: true, resizable: false,
    icon: path.join(ROOT, 'assets', 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  wirePreloadDiag(settingsWin, 'settings');
  settingsWin.loadFile(path.join(ROOT, 'src', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// --- IPC from the chrome bar / settings window -------------------------------------
ipcMain.on('overlay:set', (_e, patch: Partial<OverlaySettings>) => {
  cfg = { ...cfg, ...patch };
  applyCfg();
  persistCfg();
});
ipcMain.on('overlay:hide', () => setPanel(false));
ipcMain.on('overlay:openSettings', () => openSettings());
ipcMain.on('overlay:getRoot', (e) => {
  e.returnValue = { root: ROOT, exe: process.execPath, packaged: app.isPackaged };
});
ipcMain.on('overlay:settingsSaved', async () => {
  // The settings window PUT everything to the server; re-read and re-apply live.
  await loadCfg();
  applyCfg();
  setHudVisible(attached && cfg.hud !== false);
  log('settings reloaded from settings window');
});

// --- app -----------------------------------------------------------------------
// Two overlays fighting over one game window (double-clicked launcher) is
// confusing — the second instance exits HARD (app.quit() is async and can let
// whenReady create windows before the quit lands).
if (!app.requestSingleInstanceLock()) app.exit(0);

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
  wirePreloadDiag(win, 'chrome-bar');
  await win.loadFile(path.join(ROOT, 'src', 'chrome.html'));

  makePriceWin();
  makeHudWin();
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
  const trayFile = path.join(ROOT, 'assets', 'tray-32.png');
  const icon = fs.existsSync(trayFile)
    ? nativeImage.createFromPath(trayFile)
    : nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR4nGNgYPj/n4GBgYGJgYGBgYGB4T8DA8N/BgYGBgaG/wwMDAwMAF9uBP2/kkkSAAAAAElFTkSuQmCC');
  tray = new Tray(icon);
  tray.setToolTip('PoE2 Overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Toggle panel', click: () => setPanel(!panelOpen) },
    { label: 'Upgrade shopping list', click: () => void showRecs() },
    { label: 'Settings…', click: () => openSettings() },
    {
      label: 'Toggle session HUD',
      click: () => {
        cfg.hud = cfg.hud === false;
        if (attached) setHudVisible(cfg.hud);
        persistCfg();
      },
    },
    { label: 'Quit', click: () => app.quit() },
  ]));

  startHotkeys();
  setInterval(poll, 500);
  setInterval(() => void checkRuns(), 10000);
  setTimeout(() => void checkRuns(), 5000); // prime without showing
  setTimeout(() => void startupNotice(), 4000);
  if (process.env.OPEN_SETTINGS) openSettings(); // debug: exercise the settings preload

  // Auto-update from GitHub Releases (packaged builds only).
  if (app.isPackaged) {
    import('electron-updater')
      .then(({ autoUpdater }) => autoUpdater.checkForUpdatesAndNotify())
      .catch((e) => log(`auto-update check failed: ${e}`));
  }
  log(`watching for foreground window matching /${TARGET.source}/i`);
});

app.on('will-quit', () => { uIOhook.stop(); serverProc?.kill(); });
app.on('window-all-closed', () => app.quit());
