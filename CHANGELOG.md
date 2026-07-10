# Changelog — PoE2 Overlay

Convention: one dated section per working session, updated at session end.
Format loosely follows [Keep a Changelog](https://keepachangelog.com). No releases
yet; sections are dated (phase in parentheses).

## 2026-07-10 (later) — Phase 3b (rare pricing via trade2 API) + repo

### Added
- **Public GitHub repo**: [kwongjohn/poe2-overlay](https://github.com/kwongjohn/poe2-overlay),
  initial commit of phases 0–3a; root MIT LICENSE (vendored `app/` keeps its
  upstream MIT); README requirements & compliance section.
- **trade2 API client** (rare/magic pricing): GGG's own stat catalogue
  (`/api/trade2/data/stats`, 8,220 entries, cached 24 h — first-party, so no EE2
  data vendoring needed) → parsed mod lines matched by number-masked template →
  stat-filtered search (min = 90% of the item's roll) → fetch cheapest 10 →
  prices normalized to exalts via scout currency ApiIds → "from / median /
  N online" on the price card. Request governor: serialized, ≥1.5 s spacing,
  `Retry-After` honored; POESESSID from `settings.poesessid` (redacted in API
  responses), sent only to pathofexile.com.
- Parser tests: real-capture fixture (unidentified magic, single-line PoE2
  `Requires:`) + a corpus sweep that auto-covers every future captured item
  (6 tests total).

### Fixed
- Ctrl+C on empty ground re-showed the previous item's card (stale clipboard) —
  the item text is now consumed after ingest; the game rewrites it on every
  real copy, so repeat checks still work.
- Unknown/synthetic base types 400'd the trade search — retries without `type`.
- Cheapest listings priced in small currencies (aug/transmute) read as "unknown
  currency" — conversion now uses the scout list's full GGG ApiId map (808 ids).
- `PUT /api/settings` echoed the raw POESESSID back — redacted.

## 2026-07-10 — Phase 2 & 3a (item capture pipeline, price card)

### Added
- **Item parser** (`src/item-parser.ts`): tolerant block parser for the game's
  Ctrl+C clipboard text — class, rarity, name/base, quality, ilvl, sockets, stack
  size, requirements, properties, mods split implicit/explicit/rune/enchant.
  4 unit tests (`npm test`).
- **Capture ingestion** (`POST /api/current/item`): every captured item →
  (a) parser-fixture corpus `test/fixtures/items/` (dedup by SHA-1), (b) loot log
  `items.jsonl` stamped with live zone/character from the Client.txt watcher,
  (c) current-items registry (`GET /api/current/items`, upsert, cap 200).
- **Price-check card**: cursor-anchored click-through window on Ctrl+C — rarity-
  colored name, price in exalts + divine conversion, stack totals for currency,
  source + league footer, 6 s auto-hide, hides on alt-tab.
- **poe2scout client** (`GET /api/price`): current league auto-detected via
  `IsCurrent` (softcore preferred), full Items list (~1,275) cached 15 min in
  memory + `.price-cache.json`, local name/base matching, stale-cache-on-outage
  with "(cached)" marker, dual-base failover (`poe2scout.com/api` ↔
  `api.poe2scout.com/api`).
- **Overlay-vs-dashboard boundary** documented (PLAN §4b): overlay = real-time
  widgets; dashboard = full tracker UI; overlay gathers data for the dashboard.

### Fixed
- Price card opened **behind the game**: `focusable: false` silently disables
  `alwaysOnTop` on Windows (Electron quirk) — flag removed.
- First capture after launch could race the card's HTML load — IPC now queued
  until `did-finish-load`.
- poe2scout `CurrentPrice: 0` (= "no data") displayed as "0 ex" — now unpriced.
- Stale prices vs the poe2scout site (divine 636.86 vs 589.43): root cause was
  poe2scout moving domains mid-deploy (old base went 404, so the stale-cache
  fallback couldn't refresh) — fixed by the dual-base failover.
- Both SC and HC leagues carry `IsCurrent` — client now prefers softcore
  explicitly instead of relying on array order.
- Numberless map mods ("Area is inhabited by Undead") were dropped by the
  parser — mod classification is now per block, not per line.
- `node --test dist/` executed non-test files — narrowed to `dist/**/*.test.js`.

## 2026-07-09 (night) — Phase 1 (overlay shell hosting the tracker)

### Added
- Vendored the build tracker's `app/` (Vite+React) and `server/` (zero-dep Node)
  into this monorepo; copied John's build library (5 builds) + compare target.
- Companion server spawned from Electron main via `ELECTRON_RUN_AS_NODE`; server
  now also serves the built UI statically at `:4517` (same origin as `/api`).
- Overlay panel: chrome bar (opacity slider, size S/M/L, corner presets with
  bottom-right default, drag-to-custom position, hotkey picker, hide) +
  `WebContentsView` hosting the full tracker UI. Settings persist via
  `PUT /api/settings` → `settings.overlay`.
- Tray icon (toggle panel / quit). Hotkey gated to game-attached.
- `Start PoE2 Overlay.cmd` launcher (installs deps + builds UI on first run).
- EE2 license verified **MIT** → its game-data pipeline usable with attribution.

### Fixed
- **Port 4517 conflict**: a stale build-tracker companion server shadowed ours
  (its `/api` answered, static UI 404'd, our spawn exited code 1) — killed, and
  the overlay now logs an explicit warning when a foreign server holds the port.

## 2026-07-09 (day) — Phase 0 (overlay mechanics spike) + planning

### Added
- Project planning: `PLAN.md` (stack, features, 7-phase roadmap, risks),
  `EXTERNAL-REQUIREMENTS.md` (acquisition steps + GGG OAuth email drafts),
  `CREDENTIALS.local.md` (gitignored secrets reference), `.gitignore`-first
  policy, decisions logged to `audit/DECISIONS.md`.
- Spike proving all risky mechanics on the real machine: transparent
  always-on-top Electron window attached to the PoE2 window (koffi → user32),
  low-level global hotkeys while the game has focus (uiohook-napi), Ctrl+C
  clipboard item capture (real item captured in-game), click-through toggle,
  auto-hide on alt-tab. Stack locked: Electron + TypeScript.

### Fixed
- **Shift+Space default hotkey was live gameplay input** (VALORANT walk+jump):
  toggled the overlay nonstop and pinned it over other apps. Hotkeys now only
  fire while attached to the game; rarer default chord (Ctrl+Alt+O); detach
  always hides and resets to click-through.
- John's `POESESSID` pasted into a public-bound doc — scrubbed to
  `CREDENTIALS.local.md` before any commit exists.
