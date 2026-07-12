// PoE2 Build Tracker — companion server
// Zero-dependency Node server that gives the planner UI access to the local disk:
// a build library (builds/) and one-click export into the game's BuildPlanner folder.
// Phase 2 will add the Client.txt watcher here.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUILDS_DIR = path.join(ROOT, 'builds');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
const MANIFEST_FILE = path.join(ROOT, '.export-manifest.json');
const TARGET_FILE = path.join(ROOT, '.compare-target.json');
const SESSIONS_FILE = path.join(ROOT, 'sessions.jsonl');
const TOKEN_FILE = path.join(ROOT, '.oauth-token.json');
const PORT = Number(process.env.PORT || 4517);
const APP_VERSION = '0.1.0';

// GGG OAuth 2.1 (public client + PKCE) and developer API.
// https://www.pathofexile.com/developer/docs/authorization
const OAUTH_AUTHORIZE = 'https://www.pathofexile.com/oauth/authorize';
const OAUTH_TOKEN = 'https://www.pathofexile.com/oauth/token';
const GGG_API_BASE = 'https://api.pathofexile.com';
const OAUTH_SCOPE = 'account:characters';
// A gap larger than this between events starts a new play session.
const IDLE_GAP_MS = 30 * 60 * 1000;

// ---------- settings ----------

// Client.txt lives under the game install (not Documents). Location varies by
// installer: Steam puts it in each library's steamapps/common, the standalone
// client under Grinding Gear Games. Detect once at startup; user can override
// via settings.clientTxtPath. Log reading is permitted by GGG's third-party
// policy (https://www.pathofexile.com/developer/docs).
function detectClientTxt() {
  const rel = path.join('Path of Exile 2', 'logs', 'Client.txt');
  const candidates = [
    path.join('C:\\Program Files (x86)\\Steam', 'steamapps', 'common', rel),
    path.join('C:\\Program Files\\Steam', 'steamapps', 'common', rel),
    path.join('D:\\SteamLibrary', 'steamapps', 'common', rel),
    path.join('E:\\SteamLibrary', 'steamapps', 'common', rel),
    path.join('C:\\Program Files (x86)\\Grinding Gear Games', rel),
    path.join('C:\\Program Files\\Grinding Gear Games', rel),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return candidates[0]; // best guess; overridable in settings
}

const DETECTED_CLIENT_TXT = detectClientTxt();

function defaultSettings() {
  return {
    // Default per GGG docs: Documents/My Games/Path of Exile 2/BuildPlanner
    // https://www.pathofexile.com/developer/docs/game#buildDirectory
    buildPlannerDir: path.join(
      os.homedir(), 'Documents', 'My Games', 'Path of Exile 2', 'BuildPlanner',
    ),
    clientTxtPath: DETECTED_CLIENT_TXT,
    // GGG OAuth: the registered public-client id and a contact email for the
    // required User-Agent. Empty until you register an app with GGG.
    oauthClientId: '',
    oauthContact: '',
  };
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...defaultSettings(), ...raw };
  } catch {
    return defaultSettings();
  }
}

async function saveSettings(settings) {
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---------- helpers ----------

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.'()-]*\.build$/;

function safeBuildFile(name) {
  // Reject path traversal and odd characters outright.
  if (typeof name !== 'string' || !SAFE_NAME.test(name) || name.includes('..')) return null;
  return name;
}

function slugToFile(name) {
  const base = String(name || 'untitled')
    .replace(/[^A-Za-z0-9 _.'()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'untitled';
  return `${base}.build`;
}

async function readManifest() {
  try {
    return JSON.parse(await fsp.readFile(MANIFEST_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(data);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal styled page for the OAuth callback tab.
function htmlPage(title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{background:#140f09;color:#d8c9a8;font:15px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
.card{max-width:460px;padding:28px 32px;border:1px solid #8c6e3c;border-radius:6px;background:linear-gradient(180deg,rgba(30,23,13,.99),rgba(14,10,6,.99))}
h1{color:#c8a86a;font-size:20px;margin:0 0 10px}code{color:#c8a86a}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${bodyHtml}</p></div></body></html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------- routes ----------

async function listBuilds() {
  await fsp.mkdir(BUILDS_DIR, { recursive: true });
  const files = (await fsp.readdir(BUILDS_DIR)).filter((f) => f.endsWith('.build'));
  const manifest = await readManifest();
  const targetRef = await readTargetRef();
  const out = [];
  for (const file of files) {
    const full = path.join(BUILDS_DIR, file);
    const stat = await fsp.stat(full);
    let meta = {};
    try {
      const json = JSON.parse(await fsp.readFile(full, 'utf8'));
      meta = { name: json.name, ascendancy: json.ascendancy, author: json.author };
    } catch {
      meta = { invalid: true };
    }
    out.push({
      file,
      modified: stat.mtimeMs,
      exported: manifest.lastExportedFile === file, // pushed into the game
      target: targetRef.file === file,              // the compare plan
      ...meta,
    });
  }
  out.sort((a, b) => b.modified - a.modified);
  return out;
}

// Minimal structural validation against the GGG Build schema
// (https://www.pathofexile.com/developer/docs/game#buildFileFormat).
function validateBuild(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e.message}`] };
  }
  const errors = [];
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, errors: ['root must be a JSON object'] };
  }
  if (typeof json.name !== 'string' || !json.name.trim()) errors.push('"name" (string) is required');
  for (const key of ['passives', 'skills', 'inventory_slots']) {
    if (json[key] !== undefined && !Array.isArray(json[key])) errors.push(`"${key}" must be an array`);
  }
  return { ok: errors.length === 0, errors, json };
}

async function exportToGame(fileName, content) {
  const settings = loadSettings();
  const dir = settings.buildPlannerDir;
  await fsp.mkdir(dir, { recursive: true });

  const manifest = await readManifest();
  // One active build at a time: remove the file we exported previously.
  if (manifest.lastExportedFile && manifest.lastExportedFile !== fileName) {
    await fsp.unlink(path.join(dir, manifest.lastExportedFile)).catch(() => {});
  }
  const target = path.join(dir, fileName);
  await fsp.writeFile(target, content);
  await fsp.writeFile(
    MANIFEST_FILE,
    JSON.stringify({ lastExportedFile: fileName, exportedAt: new Date().toISOString() }, null, 2),
  );
  return target;
}

// ---------- plan vs actual ----------

// Turn a gem metadata id into a display name:
// "Metadata/Items/Gem/SkillGemLivingBombPlayer" -> "Living Bomb".
function prettyGem(id) {
  let s = String(id || '').split('/').pop() || '';
  s = s.replace(/^Unique/, '').replace(/^(Skill|Support)Gem/, '').replace(/Player$/, '');
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || String(id);
}

// Prefer a unique's name, else the item's base type (first line of the note),
// else the slot id. Skip note lines that are guide prose/markup, not a base type.
function itemLabel(slot) {
  if (slot.unique_name) return slot.unique_name;
  const first = String(slot.additional_text || '').split('\n')[0].trim();
  if (first && first.length <= 30 && !first.includes('<b>') && !first.includes('{')) return first;
  return slot.inventory_id || 'Item';
}

function fromLevel(entry) {
  return Array.isArray(entry.level_interval) ? entry.level_interval[0] : 1;
}

async function readTargetRef() {
  try { return JSON.parse(await fsp.readFile(TARGET_FILE, 'utf8')); } catch { return {}; }
}

// Load the "plan you compare against". This is now decoupled from game export:
// an explicit compare target (a library build) takes priority; if none is set it
// falls back to whatever build is currently exported to the game (for convenience).
// Returns { exported, source: 'target'|'exported'|'none', file, d }.
async function loadTargetBuild() {
  const ref = await readTargetRef();
  if (ref.file) {
    const safe = safeBuildFile(ref.file);
    if (safe) {
      try {
        const d = JSON.parse(await fsp.readFile(path.join(BUILDS_DIR, safe), 'utf8'));
        return { exported: true, source: 'target', file: safe, d };
      } catch { /* target file missing/invalid; fall back to exported */ }
    }
  }
  const manifest = await readManifest();
  const file = manifest.lastExportedFile;
  if (!file) return { exported: false, source: 'none' };
  const settings = loadSettings();
  let text;
  for (const dir of [settings.buildPlannerDir, BUILDS_DIR]) {
    try { text = await fsp.readFile(path.join(dir, file), 'utf8'); break; } catch { /* try next */ }
  }
  if (text == null) return { exported: false, source: 'none', file, missing: true };
  try { return { exported: true, source: 'exported', file, d: JSON.parse(text) }; } catch { return { exported: false, source: 'none', file, invalid: true }; }
}

// Build the leveling plan for the current compare target.
async function buildPlan() {
  const ex = await loadTargetBuild();
  if (!ex.exported) return ex;
  const d = ex.d;

  const P = d.passives || [], S = d.skills || [], I = d.inventory_slots || [];
  const isAsc = (id) => /^Ascendancy/i.test(id || '');
  // Passives carry no per-level timing in guide builds — report totals as a target.
  // "Default set" = no weapon_set; ascendancy nodes are separate (skip the start node).
  const passives = {
    main: P.filter((p) => !p.weapon_set && !isAsc(p.id)).length,
    ascendancy: P.filter((p) => !p.weapon_set && isAsc(p.id) && !/Start/i.test(p.id)).length,
  };
  const skills = S.map((s) => ({
    label: prettyGem(s.id),
    from: fromLevel(s),
    supports: (s.support_skills || []).map((x) => prettyGem(x.id)),
  })).sort((a, b) => a.from - b.from);
  const items = I.map((it) => ({
    slot: it.inventory_id,
    label: itemLabel(it),
    from: fromLevel(it),
  })).sort((a, b) => a.from - b.from);

  return { exported: true, file: ex.file, name: d.name, ascendancy: d.ascendancy || null, passives, skills, items };
}

// Diff a "current" build (from the editor, or later the GGG API) against the
// compare target: passives to allocate/refund, gems to add/remove/re-link,
// gear slots that differ. Pure JSON logic on the .build schema.
async function compareToExported(currentText) {
  const ex = await loadTargetBuild();
  if (!ex.exported) return ex;
  let C;
  try { C = JSON.parse(currentText); } catch { return { error: 'current build is not valid JSON' }; }
  const P = ex.d;

  // Passives — keyed by node id alone (a node is either allocated or not; weapon-set
  // variants and the guide file's duplicate entries collapse to the same node). Names
  // are internal table ids, so report counts; the tree view shows which nodes.
  const pKey = (p) => p.id;
  const pPlanned = new Set((P.passives || []).map(pKey));
  const pCurrent = new Set((C.passives || []).map(pKey));
  let matchedP = 0;
  for (const k of pCurrent) if (pPlanned.has(k)) matchedP++;
  const passives = {
    planned: pPlanned.size, current: pCurrent.size, matched: matchedP,
    toAllocate: pPlanned.size - matchedP, toRefund: pCurrent.size - matchedP,
  };

  // Skills — matched by gem id; matched gems get a support-link diff.
  const skIndex = (arr) => {
    const m = new Map();
    for (const s of arr || []) m.set(s.id, { label: prettyGem(s.id), supports: new Set((s.support_skills || []).map((x) => x.id)) });
    return m;
  };
  const splan = skIndex(P.skills), scur = skIndex(C.skills);
  const sToAdd = [], sToRemove = [], relink = [];
  let matchedS = 0;
  for (const [id, v] of splan) if (!scur.has(id)) sToAdd.push(v.label);
  for (const [id, v] of scur) if (!splan.has(id)) sToRemove.push(v.label);
  for (const [id, pv] of splan) {
    if (!scur.has(id)) continue;
    matchedS++;
    const cv = scur.get(id);
    const add = [...pv.supports].filter((x) => !cv.supports.has(x)).map(prettyGem);
    const remove = [...cv.supports].filter((x) => !pv.supports.has(x)).map(prettyGem);
    if (add.length || remove.length) relink.push({ skill: pv.label, add, remove });
  }

  // Gear — keyed by slot + item label.
  const iKey = (it) => `${it.inventory_id}::${itemLabel(it)}`;
  const iPlanned = new Map((P.inventory_slots || []).map((it) => [iKey(it), { slot: it.inventory_id, label: itemLabel(it) }]));
  const iCurrent = new Map((C.inventory_slots || []).map((it) => [iKey(it), { slot: it.inventory_id, label: itemLabel(it) }]));
  const iToEquip = [], iToRemove = [];
  let matchedI = 0;
  for (const [k, v] of iPlanned) { if (iCurrent.has(k)) matchedI++; else iToEquip.push(v); }
  for (const [k, v] of iCurrent) if (!iPlanned.has(k)) iToRemove.push(v);

  const inSync = passives.toAllocate === 0 && passives.toRefund === 0
    && sToAdd.length === 0 && sToRemove.length === 0 && relink.length === 0
    && iToEquip.length === 0 && iToRemove.length === 0;

  return {
    exported: true,
    name: P.name,
    currentName: C.name || null,
    inSync,
    passives,
    skills: { toAdd: sToAdd, toRemove: sToRemove, relink, matched: matchedS },
    items: { toEquip: iToEquip, toRemove: iToRemove, matched: matchedI },
  };
}

// ---------- import (Path of Building code / .build) ----------

// App reference data, loaded lazily for id mapping. Tree nodes are keyed by the
// GGG skill number (what PoB's <Spec nodes="..."> uses); gems by display name.
let _treeMap = null;
let _gemMap = null;
function treeNodeMap() {
  if (_treeMap) return _treeMap;
  _treeMap = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'Skill Trees', '0.5.2', 'data.json'), 'utf8'));
    for (const [k, n] of Object.entries(d.nodes || {})) {
      if (n && n.id) _treeMap.set(Number(n.skill ?? k), n.id);
    }
  } catch { /* data not present */ }
  return _treeMap;
}
function gemNameMap() {
  if (_gemMap) return _gemMap;
  _gemMap = new Map();
  try {
    const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'public', 'data', 'poe2', 'skill_gems.json'), 'utf8'));
    for (const [id, v] of Object.entries(g)) {
      for (const nm of [v.base_item?.display_name, v.skill_name, v.support_name]) {
        if (nm) _gemMap.set(String(nm).toLowerCase(), id);
      }
    }
  } catch { /* data not present */ }
  return _gemMap;
}

// base64 (std or url-safe) of a zlib- or raw-deflated PoB XML.
function decodePobCode(code) {
  const buf = Buffer.from(code.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try { return zlib.inflateSync(buf).toString('utf8'); }
  catch { return zlib.inflateRawSync(buf).toString('utf8'); }
}

const POB_SLOTS = {
  'Weapon 1': 'Weapon1', 'Weapon 2': 'Weapon2', 'Weapon 1 Swap': 'Weapon2', 'Weapon 2 Swap': 'Offhand2',
  Helmet: 'Helm1', 'Body Armour': 'BodyArmour1', Gloves: 'Gloves1', Boots: 'Boots1',
  Amulet: 'Amulet1', 'Ring 1': 'Ring1', 'Ring 2': 'Ring2', Belt: 'Belt1',
};

// Best-effort Path of Building XML -> .build (the PoB fork's internals can shift,
// so unmapped nodes/gems are reported rather than failing the whole import).
function pobToBuild(xml) {
  const warnings = [];
  const attr = (s, name) => (new RegExp(`${name}="([^"]*)"`).exec(s) || [])[1] || null;
  const buildTag = (/<Build\b[^>]*>/.exec(xml) || [''])[0];
  const level = attr(buildTag, 'level');
  const className = attr(buildTag, 'className');
  const ascend = attr(buildTag, 'ascendClassName');

  // passives
  const specTag = (/<Spec\b[^>]*>/.exec(xml) || [''])[0];
  const tmap = treeNodeMap();
  const passives = [];
  let unmappedNodes = 0;
  for (const n of (attr(specTag, 'nodes') || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const id = tmap.get(Number(n));
    if (id) passives.push({ id }); else unmappedNodes++;
  }
  if (unmappedNodes) warnings.push(`${unmappedNodes} passive node(s) couldn't be mapped (tree version mismatch?)`);

  // skills / gems (with level + quality captured into notes)
  const gmap = gemNameMap();
  const note = (g) => [g.level ? `Level ${g.level}` : '', g.quality && g.quality !== '0' ? `Quality ${g.quality}%` : ''].filter(Boolean).join(', ');
  const skills = [];
  let unmappedGems = 0;
  for (const grp of xml.match(/<Skill\b[\s\S]*?<\/Skill>/g) || []) {
    const gems = (grp.match(/<Gem\b[^>]*\/?>/g) || [])
      .map((t) => ({ name: attr(t, 'nameSpec') || attr(t, 'skillId') || '', level: attr(t, 'level'), quality: attr(t, 'quality') }))
      .filter((g) => g.name)
      .map((g) => { const id = gmap.get(g.name.toLowerCase()); if (!id) unmappedGems++; return { ...g, id }; })
      .filter((g) => g.id);
    if (!gems.length) continue;
    const supports = gems.filter((g) => /support/i.test(g.id));
    const actives = gems.filter((g) => !/support/i.test(g.id));
    const main = actives[0] || gems[0];
    skills.push({
      id: main.id,
      additional_text: note(main),
      support_skills: gems.filter((g) => g !== main).map((g) => ({ id: g.id, additional_text: note(g) })),
    });
  }
  if (unmappedGems) warnings.push(`${unmappedGems} gem(s) couldn't be mapped by name`);

  // items (best-effort: raw PoB item text into the slot note)
  const itemTexts = {};
  for (const m of xml.matchAll(/<Item\b[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/Item>/g)) itemTexts[m[1]] = m[2].trim();
  const items = [];
  for (const m of xml.matchAll(/<Slot\b[^>]*name="([^"]+)"[^>]*itemId="(\d+)"[^>]*\/>/g)) {
    const slot = POB_SLOTS[m[1]];
    const text = itemTexts[m[2]];
    if (slot && text) items.push({ inventory_id: slot, additional_text: text.split('\n').slice(0, 12).join('\n') });
  }

  const build = {
    name: `Imported PoB${className ? ` ${className}` : ''}`.trim() || 'Imported PoB build',
    author: 'PoB import',
    description: `Imported from Path of Building${level ? ` (level ${level}${ascend ? `, ${ascend}` : ''})` : ''}.`,
    passives,
    skills,
    inventory_slots: items,
  };
  return { build, warnings, stats: { passives: passives.length, skills: skills.length, items: items.length } };
}

// Import a PoB code or a raw .build JSON into the library.
async function importBuild(input) {
  const text = String(input || '').trim();
  if (!text) return { error: 'empty input' };
  let build; let warnings = []; let stats;
  if (text.startsWith('{')) {
    const v = validateBuild(text);
    if (!v.ok) return { error: `not a valid .build: ${v.errors.join('; ')}` };
    build = v.json;
    stats = { passives: (build.passives || []).length, skills: (build.skills || []).length, items: (build.inventory_slots || []).length };
  } else {
    let xml;
    try { xml = decodePobCode(text); } catch (e) { return { error: `couldn't decode PoB code: ${e.message}` }; }
    if (!/<PathOfBuilding|<Build\b/.test(xml)) return { error: 'decoded, but this is not a Path of Building export' };
    ({ build, warnings, stats } = pobToBuild(xml));
    if (!build.passives.length && !build.skills.length) return { error: 'nothing mappable in this PoB code (tree/gem data mismatch?)', warnings };
  }
  const fileName = slugToFile(build.name);
  await fsp.mkdir(BUILDS_DIR, { recursive: true });
  await fsp.writeFile(path.join(BUILDS_DIR, fileName), JSON.stringify(build, null, 2));
  return { ok: true, file: fileName, name: build.name, warnings, stats };
}

// ---------- GGG OAuth (public client + PKCE) + character API ----------

function redirectUri() {
  return `http://127.0.0.1:${PORT}/api/auth/callback`;
}

function userAgent() {
  const s = loadSettings();
  const id = s.oauthClientId || 'poe2-build-tracker';
  const contact = s.oauthContact || 'unknown';
  return `OAuth ${id}/${APP_VERSION} (contact: ${contact})`;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Short-lived pending authorizations, keyed by state.
const pendingAuth = new Map();
function newAuthState() {
  const now = Date.now();
  for (const [k, v] of pendingAuth) if (now - v.createdAt > 10 * 60 * 1000) pendingAuth.delete(k);
  const state = b64url(crypto.randomBytes(16));
  const { verifier, challenge } = pkcePair();
  pendingAuth.set(state, { verifier, createdAt: now });
  return { state, challenge };
}

async function readToken() {
  try { return JSON.parse(await fsp.readFile(TOKEN_FILE, 'utf8')); } catch { return null; }
}
async function writeToken(data) {
  await fsp.writeFile(TOKEN_FILE, JSON.stringify(data, null, 2));
}
async function deleteToken() {
  await fsp.unlink(TOKEN_FILE).catch(() => {});
}

function buildAuthorizeUrl() {
  const s = loadSettings();
  const { state, challenge } = newAuthState();
  const params = new URLSearchParams({
    client_id: s.oauthClientId,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state,
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${OAUTH_AUTHORIZE}?${params.toString()}`;
}

async function tokenRequest(form) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${json.error || text}`);
  return json;
}

function storeToken(json) {
  const expiresAt = Date.now() + (Number(json.expires_in) || 0) * 1000 - 60_000; // 60s safety margin
  return writeToken({
    access_token: json.access_token,
    refresh_token: json.refresh_token || null,
    token_type: json.token_type || 'bearer',
    scope: json.scope || OAUTH_SCOPE,
    username: json.username || null,
    sub: json.sub || null,
    expires_at: expiresAt,
  });
}

async function exchangeCode(code, verifier) {
  const s = loadSettings();
  const json = await tokenRequest({
    client_id: s.oauthClientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPE,
    code_verifier: verifier,
  });
  await storeToken(json);
  return json;
}

// Return a valid access token, refreshing if expired. Throws if not connected.
async function getAccessToken() {
  const tok = await readToken();
  if (!tok) throw new Error('not connected');
  if (Date.now() < tok.expires_at) return tok.access_token;
  if (!tok.refresh_token) throw new Error('token expired; reconnect');
  const s = loadSettings();
  const json = await tokenRequest({
    client_id: s.oauthClientId,
    grant_type: 'refresh_token',
    refresh_token: tok.refresh_token,
    scope: OAUTH_SCOPE,
  });
  await storeToken(json);
  return json.access_token;
}

// Authenticated GET against the GGG developer API.
async function gggApi(pathname) {
  const token = await getAccessToken();
  const res = await fetch(`${GGG_API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent() },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`GGG API ${res.status}: ${json.error?.message || json.error || text}`);
  return json;
}

async function authStatus() {
  const s = loadSettings();
  const tok = await readToken();
  return {
    configured: !!s.oauthClientId,
    connected: !!tok,
    username: tok?.username || null,
    expiresAt: tok?.expires_at || null,
    scope: tok?.scope || null,
    redirectUri: redirectUri(),
    contactSet: !!s.oauthContact,
  };
}

// ---------- live tracking (Client.txt watcher + SSE) ----------

// Live state derived from the log. Client.txt exposes events only (level, zone,
// death), never actual allocated passives/items — so this is a "by your level
// you should have X" companion, not a true state diff (that needs Phase 4 API).
const live = {
  connected: false,     // is the log file being watched
  logPath: null,
  character: null,      // last character seen leveling
  class: null,          // class/ascendancy from the level-up line
  level: null,
  area: null,           // internal area id, e.g. "MapIceCave"
  areaLevel: null,
  seed: null,
  deaths: 0,
  lastDeathAt: null,
  sessionStart: Date.now(),
  updatedAt: Date.now(),
};

const sseClients = new Set();

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try { sseSend(res, event, data); } catch { /* client gone; cleaned up on close */ }
  }
}

// Parse the log's local timestamp "YYYY/MM/DD HH:MM:SS" to epoch ms.
function parseLogTs(s) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return Date.now();
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// Append one event to sessions.jsonl (append-only history for later stats).
// Records the derived state at event time so aggregation needs no cross-type replay.
async function persistEvent(type, at) {
  const rec = {
    ts: parseLogTs(at), type,
    character: live.character, level: live.level, area: live.area,
  };
  try { await fsp.appendFile(SESSIONS_FILE, `${JSON.stringify(rec)}\n`); } catch { /* non-fatal */ }
}

// Emit a specific typed event (for a feed) plus a fresh snapshot (for the dashboard),
// and persist it to the session history.
function emit(event, data) {
  live.updatedAt = Date.now();
  if (data && data.at) void persistEvent(event, data.at);
  broadcast(event, data);
  broadcast('state', live);
}

const LINE = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \d+ \w+ \[\w+ Client \d+\] (.*)$/;
// System lines are prefixed "] : " (no channel sigil). Player chat uses a channel
// sigil (#, @, %, etc.), so anchoring on the leading ": " blocks chat spoofing.
const RE_LEVEL = /^: (.+?) \((.+?)\) is now level (\d+)$/;
const RE_DEATH = /^: (.+?) has been slain\.$/;
const RE_ZONE = /Generating level (\d+) area "([^"]+)" with seed (\d+)/;

function parseLine(raw) {
  const m = LINE.exec(raw);
  if (!m) return;
  const [, ts, msg] = m;
  const at = ts;

  const lvl = RE_LEVEL.exec(msg);
  if (lvl) {
    live.character = lvl[1];
    live.class = lvl[2];
    live.level = Number(lvl[3]);
    emit('level', { character: live.character, class: live.class, level: live.level, at });
    return;
  }

  const zone = RE_ZONE.exec(msg);
  if (zone) {
    live.areaLevel = Number(zone[1]);
    live.area = zone[2];
    live.seed = Number(zone[3]);
    emit('zone', { area: live.area, areaLevel: live.areaLevel, seed: live.seed, at });
    return;
  }

  const death = RE_DEATH.exec(msg);
  if (death) {
    const who = death[1];
    // Attribute to the local player: match the tracked character, or accept it
    // when we haven't identified one yet (single-player assumption). Skip party
    // members' deaths once we know our own name.
    if (!live.character || who === live.character) {
      // Learn the character name here too — an existing character that logs in
      // without leveling never emits a "is now level" line, so a death may be
      // the first place we see the name. A later level-up corrects it if wrong.
      if (!live.character) live.character = who;
      live.deaths += 1;
      live.lastDeathAt = at;
      emit('death', { character: who, deaths: live.deaths, at });
    }
  }
}

// Incremental tail: seek to EOF on start, then read only appended bytes on growth.
// Uses fs.watchFile (stat polling) — robust on Windows while the game holds the
// file open for writing, where fs.watch can miss appends.
let watchedPath = null;
let readOffset = 0;
let carry = '';
let reading = false;

async function drainAppended() {
  if (reading || !watchedPath) return;
  reading = true;
  try {
    const stat = await fsp.stat(watchedPath);
    if (stat.size < readOffset) { readOffset = 0; carry = ''; } // rotated/truncated
    if (stat.size <= readOffset) return;
    const fh = await fsp.open(watchedPath, 'r');
    try {
      const length = stat.size - readOffset;
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, readOffset);
      readOffset = stat.size;
      carry += buf.toString('utf8');
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? ''; // keep trailing partial line
      for (const line of lines) parseLine(line);
    } finally {
      await fh.close();
    }
  } catch { /* file briefly unavailable; next tick retries */ } finally {
    reading = false;
  }
}

function stopWatch() {
  if (watchedPath) { fs.unwatchFile(watchedPath); watchedPath = null; }
  live.connected = false;
}

// Seed current character/level/area from the recent tail so the readout reflects
// where you already are on startup — without waiting for the next event. Only the
// current position is seeded; deaths/session are scoped to the live watch.
async function seedFromTail(logPath, size) {
  try {
    const WINDOW = 2 * 1024 * 1024;
    const start = Math.max(0, size - WINDOW);
    const fh = await fsp.open(logPath, 'r');
    let text;
    try {
      const len = size - start;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      text = buf.toString('utf8');
    } finally { await fh.close(); }
    const lines = text.split(/\r?\n/);
    let gotLevel = false, gotZone = false;
    for (let i = lines.length - 1; i >= 0 && !(gotLevel && gotZone); i--) {
      const m = LINE.exec(lines[i]);
      if (!m) continue;
      const msg = m[2];
      if (!gotLevel) {
        const lvl = RE_LEVEL.exec(msg);
        if (lvl) { live.character = lvl[1]; live.class = lvl[2]; live.level = Number(lvl[3]); gotLevel = true; }
      }
      if (!gotZone) {
        const z = RE_ZONE.exec(msg);
        if (z) { live.areaLevel = Number(z[1]); live.area = z[2]; live.seed = Number(z[3]); gotZone = true; }
      }
    }
  } catch { /* seeding is best-effort */ }
}

async function startWatch(logPath) {
  stopWatch();
  // Reset derived session state — a new log (or re-attach) starts a fresh session,
  // so a character/level/deaths from a previous watch must not carry over.
  Object.assign(live, {
    logPath, character: null, class: null, level: null,
    area: null, areaLevel: null, seed: null,
    deaths: 0, lastDeathAt: null, sessionStart: Date.now(),
  });
  try {
    const stat = await fsp.stat(logPath);
    readOffset = stat.size; // skip the historical backlog
    carry = '';
    watchedPath = logPath;
    live.connected = true;
    await seedFromTail(logPath, stat.size); // reflect current position immediately
    fs.watchFile(logPath, { interval: 1000 }, () => { void drainAppended(); });
    console.log(`[poe2-build-tracker] watching Client.txt: ${logPath}`);
  } catch {
    live.connected = false;
    console.log(`[poe2-build-tracker] Client.txt not found (set settings.clientTxtPath): ${logPath}`);
  }
  live.updatedAt = Date.now();
  broadcast('state', live);
}

// Aggregate sessions.jsonl into leveling-speed / deaths / play-session stats.
// Defaults to the most recent character; pass a name to scope to one character.
async function buildHistory(character) {
  let text = '';
  try { text = await fsp.readFile(SESSIONS_FILE, 'utf8'); } catch { return { events: 0, character: character || null }; }
  const all = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { all.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  const who = character || all.filter((e) => e.character).slice(-1)[0]?.character || null;
  const evs = all
    .filter((e) => (who ? e.character === who : true) && Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);
  if (!evs.length) return { events: 0, character: who };

  // Split into play sessions by idle gaps.
  const sessions = [];
  let cur = null;
  for (const e of evs) {
    if (!cur || e.ts - cur.end > IDLE_GAP_MS) {
      cur = { start: e.ts, end: e.ts, deaths: 0, minLevel: null, maxLevel: null };
      sessions.push(cur);
    }
    cur.end = e.ts;
    if (e.type === 'death') cur.deaths += 1;
    if (Number.isFinite(e.level)) {
      cur.minLevel = cur.minLevel == null ? e.level : Math.min(cur.minLevel, e.level);
      cur.maxLevel = cur.maxLevel == null ? e.level : Math.max(cur.maxLevel, e.level);
    }
  }

  // Time to reach each level (first time seen); delta counts only consecutive
  // levels reached within the same session (skips overnight gaps).
  const levelFirst = new Map();
  for (const e of evs) {
    if (e.type === 'level' && Number.isFinite(e.level) && !levelFirst.has(e.level)) levelFirst.set(e.level, e.ts);
  }
  const levelsSorted = [...levelFirst.entries()].sort((a, b) => a[0] - b[0]);
  const levels = levelsSorted.map(([level, ts], i) => {
    const prev = levelsSorted[i - 1];
    const sincePrevMs = prev && level === prev[0] + 1 && ts - prev[1] <= IDLE_GAP_MS ? ts - prev[1] : null;
    return { level, ts, sincePrevMs };
  });

  // Deaths grouped by area.
  const deathsByAreaMap = new Map();
  for (const e of evs) {
    if (e.type === 'death') {
      const a = e.area || 'Unknown';
      deathsByAreaMap.set(a, (deathsByAreaMap.get(a) || 0) + 1);
    }
  }
  const deathsByArea = [...deathsByAreaMap.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);

  // Time per area: dwell = gap between consecutive zone events (same session).
  const zoneEvs = evs.filter((e) => e.type === 'zone');
  const timeByAreaMap = new Map();
  for (let i = 0; i < zoneEvs.length - 1; i++) {
    const dwell = zoneEvs[i + 1].ts - zoneEvs[i].ts;
    if (dwell > 0 && dwell <= IDLE_GAP_MS) {
      const a = zoneEvs[i].area || 'Unknown';
      timeByAreaMap.set(a, (timeByAreaMap.get(a) || 0) + dwell);
    }
  }
  const timeByArea = [...timeByAreaMap.entries()]
    .map(([area, ms]) => ({ area, ms }))
    .sort((a, b) => b.ms - a.ms);

  const playtimeMs = sessions.reduce((s, x) => s + (x.end - x.start), 0);
  const levelVals = evs.filter((e) => Number.isFinite(e.level)).map((e) => e.level);
  return {
    events: evs.length,
    character: who,
    totals: {
      deaths: deathsByArea.reduce((s, x) => s + x.count, 0),
      playtimeMs,
      sessions: sessions.length,
      firstSeen: evs[0].ts,
      lastSeen: evs[evs.length - 1].ts,
      minLevel: levelVals.length ? Math.min(...levelVals) : null,
      maxLevel: levelVals.length ? Math.max(...levelVals) : null,
    },
    levels,
    deathsByArea,
    timeByArea,
    sessions,
  };
}

// Captured-item ingestion (overlay Ctrl+C pipeline): every capture is corpus'd as a
// parser fixture, logged with zone context for loot analytics, and upserted into the
// "current items" registry the dashboard reads.
const FIXTURES_DIR = path.join(ROOT, 'test', 'fixtures', 'items');
const ITEMS_LOG = path.join(ROOT, 'items.jsonl');           // gitignored (personal)
const CURRENT_ITEMS = path.join(ROOT, '.current-items.json'); // gitignored

function loadCurrentItems() {
  try { return JSON.parse(fs.readFileSync(CURRENT_ITEMS, 'utf8')); } catch { return { items: [] }; }
}

async function ingestItem(raw, parsed) {
  // 1. Corpus: dedup by content hash; committed as parser regression fixtures.
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
  await fsp.mkdir(FIXTURES_DIR, { recursive: true });
  const fixture = path.join(FIXTURES_DIR, `${hash}.txt`);
  if (!fs.existsSync(fixture)) await fsp.writeFile(fixture, raw);

  const meta = {
    ts: Date.now(), area: live.area, areaLevel: live.areaLevel,
    character: live.character,
    itemClass: parsed?.itemClass || null, rarity: parsed?.rarity || null,
    name: parsed?.name || null, baseType: parsed?.baseType || null,
  };
  // 2. Loot log with zone context (dashboard analytics later).
  await fsp.appendFile(ITEMS_LOG, `${JSON.stringify(meta)}\n`).catch(() => {});

  // 3. Current-items registry: newest first, upsert by class+name+base, capped.
  if (parsed) {
    const reg = loadCurrentItems();
    const key = (i) => `${i.itemClass}|${i.name}|${i.baseType}`;
    reg.items = [{ ...parsed, capturedAt: meta.ts, area: live.area },
      ...reg.items.filter((i) => key(i) !== key(parsed))].slice(0, 200);
    await fsp.writeFile(CURRENT_ITEMS, JSON.stringify(reg, null, 2));
  }
  return { hash, ...meta };
}

// Price lookup via poe2scout (24h-averaged, keyless). Endpoints verified 2026-07-10:
// base https://api.poe2scout.com/api/poe2 ; the Items list ignores ?search, so we
// fetch it whole, cache 15 min (memory + disk), and match locally. League is
// auto-detected via IsCurrent; prices are in exalts, DivinePrice converts to div.
// Both bases have hosted the API (they shuffled domains mid-deploy on 2026-07-10);
// remember whichever answered last and fail over to the other.
const SCOUT_BASES = ['https://poe2scout.com/api/poe2', 'https://api.poe2scout.com/api/poe2'];
let scoutBase = SCOUT_BASES[0];
const SCOUT_HEADERS = { 'User-Agent': 'poe2-overlay/0.1.0 (contact: jkwong@ateneo.edu)' };
const PRICE_CACHE = path.join(ROOT, '.price-cache.json');
const SCOUT_TTL = 15 * 60 * 1000;
let scout = { league: null, divinePrice: null, items: [], fetchedAt: 0 };

async function scoutFetch(pathPart) {
  let lastErr;
  for (const b of [scoutBase, ...SCOUT_BASES.filter((x) => x !== scoutBase)]) {
    try {
      const r = await fetch(`${b}${pathPart}`, { headers: SCOUT_HEADERS });
      if (!r.ok) throw new Error(`poe2scout ${r.status} for ${b}${pathPart}`);
      scoutBase = b;
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

let scoutLastAttempt = 0;
async function ensureScout() {
  const now = Date.now();
  if (scout.fetchedAt && now - scout.fetchedAt < SCOUT_TTL && !scout.stale) return scout;
  // Seed from disk once, whatever its age — a stale price list beats none when
  // poe2scout is down or mid-deploy (observed 2026-07-10: endpoints 404 during deploys).
  if (!scout.items.length) {
    try { scout = { ...JSON.parse(fs.readFileSync(PRICE_CACHE, 'utf8')), stale: true }; } catch { /* none */ }
    if (scout.items.length && now - scout.fetchedAt < SCOUT_TTL) { scout.stale = false; return scout; }
  }
  if (scout.items.length && now - scoutLastAttempt < 60 * 1000) return scout; // throttle retries
  scoutLastAttempt = now;
  try {
    const leagues = await scoutFetch('/Leagues');
    // Both the SC and HC league carry IsCurrent — prefer softcore.
    const cur = leagues.find((l) => l.IsCurrent && !/^HC /i.test(l.Value))
      || leagues.find((l) => l.IsCurrent) || leagues[0];
    const items = await scoutFetch(`/Leagues/${encodeURIComponent(cur.Value)}/Items`);
    scout = {
      league: cur.Value, divinePrice: cur.DivinePrice || null,
      items: Array.isArray(items) ? items : (items.items || []),
      fetchedAt: Date.now(), stale: false,
    };
    await fsp.writeFile(PRICE_CACHE, JSON.stringify(scout)).catch(() => {});
    console.log(`[price] poe2scout cache: ${scout.items.length} items, league "${scout.league}"`);
  } catch (e) {
    if (!scout.items.length) throw e; // nothing to serve at all
    scout.stale = true;
    console.log(`[price] poe2scout unreachable (${e.message}); serving cache from ${new Date(scout.fetchedAt).toLocaleTimeString()}`);
  }
  return scout;
}

function findScoutItem(s, name, base) {
  const norm = (t) => (t || '').toLowerCase().trim();
  const n = norm(name), b = norm(base);
  return s.items.find((i) => norm(i.Name) === n && b && norm(i.Type) === b)
    || s.items.find((i) => norm(i.Name) === n || norm(i.Text) === n)
    || (b ? s.items.find((i) => norm(i.Text) === b || norm(i.Type) === b) : null)
    || null;
}

// Official trade2 API — the only source that can price a *specific rare* from its
// mods. Etiquette per EXTERNAL-REQUIREMENTS §2: real User-Agent, requests
// serialized + spaced, Retry-After honored, one search per user keypress (the
// overlay only calls this from a Ctrl+C), POESESSID sent only to pathofexile.com.
const TRADE = 'https://www.pathofexile.com/api/trade2';
const TRADE_STATS_FILE = path.join(ROOT, '.trade-stats.json');
let tradeStats = null;
let tradeChain = Promise.resolve();
let tradeLastAt = 0;
let tradeCooldownUntil = 0;

function tradeHeaders(settings) {
  const h = {
    'User-Agent': SCOUT_HEADERS['User-Agent'],
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (settings.poesessid) h.Cookie = `POESESSID=${settings.poesessid}`;
  return h;
}

async function tradeFetch(u, opts = {}) {
  const settings = loadSettings();
  // Serialize and space all trade calls (simple governor: >=1.5s apart, plus any
  // server-mandated cooldown), so bursts can never exceed the advertised budget.
  const myTurn = tradeChain.then(async () => {
    const wait = Math.max(tradeLastAt + 1500 - Date.now(), tradeCooldownUntil - Date.now(), 0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    tradeLastAt = Date.now();
  });
  tradeChain = myTurn.catch(() => {});
  await myTurn;
  const r = await fetch(u, { ...opts, headers: tradeHeaders(settings) });
  if (r.status === 429) {
    const ra = Number(r.headers.get('retry-after') || 15);
    tradeCooldownUntil = Date.now() + ra * 1000;
    throw new Error(`rate-limited by trade API (retry in ${ra}s)`);
  }
  if (!r.ok) throw new Error(`trade API ${r.status}`);
  return r.json();
}

const normTemplate = (t) => t.replace(/[+-]?[\d.]+/g, '#').toLowerCase().trim();

// GGG's own stat catalogue (first-party alternative to vendoring EE2 data):
// mod text with numbers masked → trade stat id. Cached 24h on disk.
async function ensureTradeStats() {
  if (tradeStats) return tradeStats;
  try {
    const d = JSON.parse(fs.readFileSync(TRADE_STATS_FILE, 'utf8'));
    if (Date.now() - d.fetchedAt < 24 * 3600 * 1000) { tradeStats = d; return d; }
  } catch { /* no cache */ }
  const data = await tradeFetch(`${TRADE}/data/stats`);
  const map = [];
  for (const grp of data.result || []) {
    for (const e of grp.entries || []) {
      if (e.id && e.text) map.push({ id: e.id, type: e.type, template: normTemplate(e.text) });
    }
  }
  tradeStats = { fetchedAt: Date.now(), map };
  await fsp.writeFile(TRADE_STATS_FILE, JSON.stringify(tradeStats)).catch(() => {});
  console.log(`[price] trade stat catalogue cached: ${map.length} entries`);
  return tradeStats;
}

function tradeStatFilters(stats, modLines) {
  const filters = [];
  const unmatched = [];
  for (const line of modLines) {
    const tpl = normTemplate(line);
    const hit = stats.map.find((s) => s.type === 'explicit' && s.template === tpl);
    if (!hit) { unmatched.push(line); continue; }
    const num = /[\d.]+/.exec(line);
    // 10% headroom below the item's roll so near-equivalents count as comparables.
    filters.push(num
      ? { id: hit.id, value: { min: Math.floor(Number(num[0]) * 0.9) } }
      : { id: hit.id });
  }
  return { filters, unmatched };
}

// exalts per unit for a trade-listing currency. The scout Items list carries
// GGG's own currency ApiIds (aug, transmute, chaos, divine, …) with ex prices.
function currencyToEx(s, apiId) {
  const t = (apiId || '').toLowerCase();
  if (t === 'exalted') return 1;
  const hit = s.items.find((i) => (i.ApiId || '').toLowerCase() === t);
  return hit && hit.CurrentPrice > 0 ? hit.CurrentPrice : null;
}

async function tradePrice(parsed, scoutState) {
  const stats = await ensureTradeStats();
  const { filters, unmatched } = tradeStatFilters(stats, parsed.explicits || []);
  if (!filters.length) return { found: false, note: 'no mods matched the trade stat catalogue' };
  const query = {
    query: {
      status: { option: 'online' },
      ...(parsed.baseType ? { type: parsed.baseType } : {}),
      stats: [{ type: 'and', filters }],
    },
    sort: { price: 'asc' },
  };
  const league = encodeURIComponent(scoutState.league || 'Standard');
  let search;
  try {
    search = await tradeFetch(`${TRADE}/search/poe2/${league}`, {
      method: 'POST', body: JSON.stringify(query),
    });
  } catch (e) {
    // Parser base names can drift from GGG's catalogue ("Unknown item base type",
    // a 400) — mods alone still give a usable comparable search.
    if (!query.query.type || !/400/.test(String(e.message))) throw e;
    delete query.query.type;
    search = await tradeFetch(`${TRADE}/search/poe2/${league}`, {
      method: 'POST', body: JSON.stringify(query),
    });
  }
  if (!search.result || !search.result.length) {
    return { found: false, note: 'no online listings match these mods', total: search.total || 0, unmatched };
  }
  const fetched = await tradeFetch(`${TRADE}/fetch/${search.result.slice(0, 10).join(',')}?query=${search.id}`);
  const exPrices = (fetched.result || [])
    .map((x) => x && x.listing && x.listing.price)
    .filter((p) => p && p.amount > 0)
    .map((p) => { const rate = currencyToEx(scoutState, p.currency); return rate ? p.amount * rate : null; })
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (!exPrices.length) return { found: false, note: 'listings found but in unknown currencies', total: search.total };
  return {
    found: true, source: 'trade (online, cheapest first)', league: scoutState.league,
    currency: 'ex', total: search.total,
    price: exPrices[0], // "from" price
    median: exPrices[Math.floor(exPrices.length / 2)],
    divine: scoutState.divinePrice ? exPrices[0] / scoutState.divinePrice : null,
    sampled: exPrices.length, unmatched,
  };
}

// Pick advisor: score a captured waystone/tablet against the *target build*,
// not just the market. Archetype tags are derived from the build's gem ids and
// ascendancy (overridable via settings.advisor.tags); mods are matched by a
// rule table where a rule can escalate for affected archetypes or be skipped
// as irrelevant to them.
const cleanMod = (l) => l
  .replace(/\(\s*[\d.]+\s*-\s*[\d.]+\s*\)/g, '')  // roll ranges "38(40-36)%"
  .replace(/\s*—.*$/, '')                          // advanced-copy suffixes
  .replace(/\s+/g, ' ').trim().toLowerCase();

async function buildAdvisorTags() {
  const settings = loadSettings();
  const manual = settings.advisor && settings.advisor.tags;
  if (Array.isArray(manual) && manual.length) return manual;
  try {
    const t = await loadTargetBuild();
    if (!t.exported) return ['generic'];
    const s = JSON.stringify(t.d);
    const tags = [];
    if (/EssenceDrain|Contagion|DarkEffigy|RavenousSwarm|Withering|ChaosMastery|Envenom|ManaDrain/i.test(s)) tags.push('chaos', 'dot');
    if (/TemporalChains|Despair|Blasphemy|Enfeeble/i.test(s)) tags.push('curse');
    if (/Minion|Skeletal|RagingSpirits/i.test(s)) tags.push('minion');
    tags.push(/witch|lich|sorc/i.test(t.d.ascendancy || '') ? 'es' : 'life');
    return tags.length ? tags : ['generic'];
  } catch { return ['generic']; }
}

// sev: brick = build-disabling (verdict SKIP) · danger · note.
// tags: archetypes the rule escalates for; `else: 'skip'` = irrelevant otherwise.
const ADVICE_RULES = [
  { re: /monsters are hexproof|monsters cannot be cursed/, tags: ['curse'], sev: 'brick', why: 'your curses do nothing here', else: 'skip' },
  { re: /less effect of curses on monsters/, tags: ['curse'], sev: 'danger', why: 'your curses lose most of their effect', else: 'skip' },
  { re: /less recovery rate of life and energy shield/, sev: 'danger', why: 'recovery crippled — sustain carefully' },
  { re: /chaos resistance/, tags: ['chaos'], sev: 'danger', why: 'monsters resist your chaos damage', else: 'skip' },
  { re: /maximum player resistances/, sev: 'danger', why: 'max res lowered — elemental spikes' },
  { re: /increased critical hit chance|critical damage/, sev: 'danger', why: 'crit spikes — one-shot risk' },
  { re: /additional projectiles/, sev: 'danger', why: 'extra projectiles — more incoming hits' },
  { re: /of damage as extra (fire|cold|lightning|chaos)/, sev: 'note', why: 'extra elemental damage — check resistances' },
  { re: /chance to poison on hit/, sev: 'note', why: 'poison sources' },
  { re: /inflict bleeding/, sev: 'note', why: 'bleed sources' },
  { re: /cursed with temporal chains/, sev: 'note', why: 'periodic slow on you' },
  { re: /cursed with enfeeble/, sev: 'note', why: 'your damage periodically reduced' },
  { re: /(burning|shocked|chilled|desecrated) ground/, sev: 'note', why: 'ground hazards' },
  { re: /increased (attack|cast) speed|increased movement speed/, sev: 'note', why: 'faster monsters' },
];

function adviseMapItem(parsed, tags) {
  const findings = [];
  for (const raw of parsed.explicits || []) {
    const line = cleanMod(raw);
    for (const r of ADVICE_RULES) {
      if (!r.re.test(line)) continue;
      let sev = r.sev;
      if (r.tags && !r.tags.some((t) => tags.includes(t))) {
        if (r.else === 'skip') break;
        sev = 'note';
      }
      findings.push({ sev, why: r.why, mod: raw });
      break;
    }
  }
  const rewards = [];
  for (const [k, v] of Object.entries(parsed.properties || {})) {
    if (/rarity|quantity|pack size|waystone drop|monster effectiveness|experience/i.test(k)) {
      rewards.push(`${k} ${v}`);
    }
  }
  const bricks = findings.filter((f) => f.sev === 'brick').length;
  const dangers = findings.filter((f) => f.sev === 'danger').length;
  const verdict = bricks ? 'SKIP' : dangers >= 2 ? 'RISKY' : dangers === 1 ? 'CAUTION' : 'GOOD';
  return { verdict, findings, rewards, tags };
}

// Static hosting of the built app (app/dist) so the Electron overlay loads the UI
// from this server (same origin as /api) with no Vite dev process.
const APP_DIST = path.join(ROOT, 'app', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.txt': 'text/plain',
};
function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(APP_DIST, rel);
  if (!file.startsWith(APP_DIST)) return false;
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(APP_DIST, 'index.html'); // SPA fallback
  }
  if (!fs.existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (req.method === 'GET' && p === '/api/health') {
      const settings = loadSettings();
      return send(res, 200, {
        ok: true,
        version: 1,
        buildPlannerDir: settings.buildPlannerDir,
        buildPlannerDirExists: fs.existsSync(settings.buildPlannerDir),
      });
    }

    if (p === '/api/settings') {
      if (req.method === 'GET') {
        // Redact the session credential; callers only need to know it's set.
        const s = loadSettings();
        return send(res, 200, { ...s, poesessid: s.poesessid ? '(set)' : '' });
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const settings = { ...loadSettings() };
        if (typeof body.buildPlannerDir === 'string' && body.buildPlannerDir.trim()) {
          settings.buildPlannerDir = body.buildPlannerDir.trim();
        }
        if (typeof body.clientTxtPath === 'string' && body.clientTxtPath.trim()) {
          settings.clientTxtPath = body.clientTxtPath.trim();
          await startWatch(settings.clientTxtPath); // re-point the watcher live
        }
        if (typeof body.oauthClientId === 'string') settings.oauthClientId = body.oauthClientId.trim();
        if (typeof body.oauthContact === 'string') settings.oauthContact = body.oauthContact.trim();
        // Session cookie for trade searches; '(set)' is the GET redaction echoing back — ignore it.
        if (typeof body.poesessid === 'string' && body.poesessid !== '(set)') {
          settings.poesessid = body.poesessid.trim();
        }
        // Overlay shell settings (opacity/size/position/hotkey) — shallow-merged blob.
        if (body.overlay && typeof body.overlay === 'object' && !Array.isArray(body.overlay)) {
          settings.overlay = { ...(settings.overlay || {}), ...body.overlay };
        }
        // Pick-advisor overrides ({tags: []} forces archetypes; empty/absent = derive from build).
        if (body.advisor && typeof body.advisor === 'object' && !Array.isArray(body.advisor)) {
          settings.advisor = { ...(settings.advisor || {}), ...body.advisor };
        }
        await saveSettings(settings);
        return send(res, 200, { ...settings, poesessid: settings.poesessid ? '(set)' : '' });
      }
    }

    // Overlay capture pipeline: raw clipboard item text (+ parsed form from the
    // Electron main's item-parser). Raw is required; parsed is best-effort.
    if (req.method === 'POST' && p === '/api/current/item') {
      const body = JSON.parse(await readBody(req));
      if (typeof body.raw !== 'string' || !body.raw.trim()) {
        return send(res, 400, { error: 'raw item text required' });
      }
      return send(res, 200, { ok: true, ...(await ingestItem(body.raw, body.parsed || null)) });
    }
    if (req.method === 'GET' && p === '/api/current/items') {
      return send(res, 200, loadCurrentItems());
    }

    // Price check. GET (name/base/rarity params) = poe2scout list lookup only.
    // POST (body = parsed item) = scout lookup, then a trade2 stat-filtered
    // search for Rare/Magic gear the list can't price.
    if (p === '/api/price' && (req.method === 'GET' || req.method === 'POST')) {
      let name = '', base = '', rarity = '', parsed = null;
      if (req.method === 'GET') {
        name = url.searchParams.get('name') || '';
        base = url.searchParams.get('base') || '';
        rarity = url.searchParams.get('rarity') || '';
      } else {
        parsed = JSON.parse(await readBody(req)).parsed || null;
        if (!parsed) return send(res, 400, { error: 'parsed item required' });
        name = parsed.name; base = parsed.baseType; rarity = parsed.rarity;
      }
      try {
        const s = await ensureScout();
        // Waystones/tablets get build-aware pick advice instead of a trade
        // search (their market value is not the interesting signal).
        const isMapItem = parsed && /waystone|tablet/i.test(parsed.itemClass || '');
        const advice = isMapItem ? adviseMapItem(parsed, await buildAdvisorTags()) : undefined;
        const hit = findScoutItem(s, name, base);
        // CurrentPrice of 0 means "no data", not "free" — treat as unpriced.
        if (hit && hit.CurrentPrice > 0) {
          return send(res, 200, {
            found: true, league: s.league,
            source: `poe2scout 24h avg${s.stale ? ' (cached)' : ''}`,
            name: hit.Text || hit.Name, price: hit.CurrentPrice, currency: 'ex',
            divine: s.divinePrice ? hit.CurrentPrice / s.divinePrice : null,
            ...(advice ? { advice } : {}),
          });
        }
        const tradeable = parsed && !isMapItem && ['Rare', 'Magic'].includes(rarity)
          && (parsed.explicits || []).length > 0;
        if (tradeable) {
          try {
            return send(res, 200, { ...(await tradePrice(parsed, s)), league: s.league });
          } catch (e) {
            return send(res, 200, { found: false, league: s.league, note: String((e && e.message) || e) });
          }
        }
        return send(res, 200, {
          found: false, league: s.league,
          note: isMapItem ? 'no list price' : rarity === 'Rare' ? 'rare items price via trade search (POST)' : 'no listed price',
          ...(advice ? { advice } : {}),
        });
      } catch (e) {
        return send(res, 502, { error: String((e && e.message) || e) });
      }
    }

    // Plan vs actual: leveling plan for the currently-exported build.
    if (req.method === 'GET' && p === '/api/plan') {
      return send(res, 200, await buildPlan());
    }

    // Session history: aggregated leveling-speed / deaths / play-session stats.
    if (req.method === 'GET' && p === '/api/history') {
      return send(res, 200, await buildHistory(url.searchParams.get('character') || null));
    }

    // Raw target (planned) build — for the in-category side-by-side comparison,
    // which matches by gem/node id and renders names/icons from the app's own data.
    if (req.method === 'GET' && p === '/api/target-build') {
      const ex = await loadTargetBuild();
      if (!ex.exported) return send(res, 200, ex);
      return send(res, 200, { exported: true, source: ex.source, file: ex.file, name: ex.d.name, ascendancy: ex.d.ascendancy || null, build: ex.d });
    }

    // Compare target = the plan you diff against. Decoupled from game export:
    // GET reports it; PUT sets it to a library build; DELETE clears it (then the
    // fallback is the currently-exported build, if any).
    if (p === '/api/target') {
      if (req.method === 'GET') {
        const ref = await readTargetRef();
        const t = await loadTargetBuild();
        return send(res, 200, { set: ref.file || null, source: t.source, file: t.file || null, name: t.exported ? t.d.name : null });
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const safe = safeBuildFile(body.file || '');
        if (!safe) return send(res, 400, { error: 'invalid build file name' });
        if (!fs.existsSync(path.join(BUILDS_DIR, safe))) return send(res, 404, { error: 'build not in library' });
        await fsp.writeFile(TARGET_FILE, JSON.stringify({ file: safe }, null, 2));
        return send(res, 200, { ok: true, file: safe });
      }
      if (req.method === 'DELETE') {
        await fsp.unlink(TARGET_FILE).catch(() => {});
        return send(res, 200, { ok: true });
      }
    }

    // Import a Path of Building code or a raw .build into the library.
    if (req.method === 'POST' && p === '/api/import') {
      const body = JSON.parse(await readBody(req));
      const result = await importBuild(body.code);
      return send(res, result.error ? 422 : 200, result);
    }

    // Compare a current build (POST body = .build JSON) against the exported plan.
    if (req.method === 'POST' && p === '/api/compare') {
      const result = await compareToExported(await readBody(req));
      return send(res, result.error ? 422 : 200, result);
    }

    // ----- GGG OAuth + character API -----
    if (req.method === 'GET' && p === '/api/auth/status') {
      return send(res, 200, await authStatus());
    }
    if (req.method === 'GET' && p === '/api/auth/login') {
      const s = loadSettings();
      if (!s.oauthClientId) {
        return send(res, 200, htmlPage('Not configured',
          'Set <code>oauthClientId</code> and <code>oauthContact</code> in settings first (register an app with GGG). See the project setup notes.'), 'text/html');
      }
      res.writeHead(302, { Location: buildAuthorizeUrl() });
      return res.end();
    }
    if (req.method === 'GET' && p === '/api/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      if (err) return send(res, 200, htmlPage('Authorization failed', `GGG returned: <code>${escapeHtml(err)}</code>. You can close this tab.`), 'text/html');
      const pending = state && pendingAuth.get(state);
      if (!code || !pending) return send(res, 200, htmlPage('Authorization failed', 'Invalid or expired state. Start the connection again from the tracker.'), 'text/html');
      pendingAuth.delete(state);
      try {
        const tok = await exchangeCode(code, pending.verifier);
        return send(res, 200, htmlPage('Connected ✓', `Signed in as <b>${escapeHtml(tok.username || 'your account')}</b>. You can close this tab and return to the tracker.`), 'text/html');
      } catch (e) {
        return send(res, 200, htmlPage('Connection error', `Token exchange failed: <code>${escapeHtml(String(e.message || e))}</code>`), 'text/html');
      }
    }
    if (req.method === 'POST' && p === '/api/auth/logout') {
      await deleteToken();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/characters') {
      try { return send(res, 200, await gggApi('/character/poe2')); }
      catch (e) { return send(res, 502, { error: String(e.message || e) }); }
    }
    const charMatch = p.match(/^\/api\/character\/(.+)$/);
    if (req.method === 'GET' && charMatch) {
      const name = decodeURIComponent(charMatch[1]);
      try { return send(res, 200, await gggApi(`/character/poe2/${encodeURIComponent(name)}`)); }
      catch (e) { return send(res, 502, { error: String(e.message || e) }); }
    }

    // Live tracking: SSE stream of log events + a plain snapshot for hydration.
    if (req.method === 'GET' && p === '/api/live/state') {
      return send(res, 200, live);
    }
    if (req.method === 'GET' && p === '/api/live') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 3000\n\n');
      sseSend(res, 'state', live);
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return; // keep the connection open
    }

    if (req.method === 'GET' && p === '/api/builds') {
      return send(res, 200, await listBuilds());
    }

    const buildMatch = p.match(/^\/api\/builds\/(.+)$/);
    if (buildMatch) {
      const file = safeBuildFile(decodeURIComponent(buildMatch[1]));
      if (!file) return send(res, 400, { error: 'invalid build file name' });
      const full = path.join(BUILDS_DIR, file);

      if (req.method === 'GET') {
        try {
          return send(res, 200, JSON.parse(await fsp.readFile(full, 'utf8')));
        } catch {
          return send(res, 404, { error: 'not found' });
        }
      }
      if (req.method === 'PUT') {
        const text = await readBody(req);
        const v = validateBuild(text);
        if (!v.ok) return send(res, 422, { error: 'invalid build', details: v.errors });
        await fsp.mkdir(BUILDS_DIR, { recursive: true });
        await fsp.writeFile(full, text);
        return send(res, 200, { saved: file });
      }
      if (req.method === 'DELETE') {
        await fsp.unlink(full).catch(() => {});
        return send(res, 200, { deleted: file });
      }
    }

    if (req.method === 'POST' && p === '/api/export') {
      const body = JSON.parse(await readBody(req));
      let fileName;
      let content;
      if (body.file) {
        // Export an existing library build.
        fileName = safeBuildFile(body.file);
        if (!fileName) return send(res, 400, { error: 'invalid build file name' });
        try {
          content = await fsp.readFile(path.join(BUILDS_DIR, fileName), 'utf8');
        } catch {
          return send(res, 404, { error: 'library build not found' });
        }
      } else if (typeof body.content === 'string') {
        // Export the currently open build directly.
        const v = validateBuild(body.content);
        if (!v.ok) return send(res, 422, { error: 'invalid build', details: v.errors });
        fileName = slugToFile(body.name || v.json.name);
        content = body.content;
      } else {
        return send(res, 400, { error: 'provide "file" or "content"' });
      }
      const target = await exportToGame(fileName, content);
      return send(res, 200, { exported: fileName, path: target });
    }

    if (req.method === 'GET' && !p.startsWith('/api/') && serveStatic(res, p)) return;

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const settings = loadSettings();
  console.log(`[poe2-build-tracker] companion server on http://127.0.0.1:${PORT}`);
  console.log(`[poe2-build-tracker] build library: ${BUILDS_DIR}`);
  console.log(`[poe2-build-tracker] game BuildPlanner dir: ${settings.buildPlannerDir}`);
  if (!fs.existsSync(settings.buildPlannerDir)) {
    console.log('[poe2-build-tracker] note: BuildPlanner dir does not exist yet; it will be created on first export.');
  }
  void startWatch(settings.clientTxtPath);
});
