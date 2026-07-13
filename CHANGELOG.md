# Changelog — PoE2 Overlay

Convention: one dated section per working session, updated at session end.
Format loosely follows [Keep a Changelog](https://keepachangelog.com). No releases
yet; sections are dated (phase in parentheses).

## 2026-07-12 (late night) — Hotfix: every button dead (sandboxed preload)

### Fixed
- **All UI buttons/controls stopped working** after polish round 2: the preload
  gained `require('path')` + `__dirname`, but Electron sandboxes preload scripts
  (20+ default) — neither exists there, the bridge threw, `window.overlay` was
  undefined, and every page script aborted on first use (bar controls, settings
  form, price/recs/notice cards). Preload now gets the root path from main via
  sync IPC and touches nothing environmental.
- **Preload diagnostics added permanently**: `preload-error` and renderer
  console errors are mirrored into the main log per window (`wirePreloadDiag`),
  so this failure class is loud instead of silent. `OPEN_SETTINGS=1` env var
  exercises the settings window headlessly for testing.
- Steam-line **Copy** button switched from `navigator.clipboard` (deniable on
  `file://` pages) to select+`execCommand` with "Copied ✓" feedback.

## 2026-07-12 (night) — Polish round 2 (all 10 John-approved items)

### Added
- **Trade deep link**: `Ctrl+Alt+T` opens the last price check as a real trade-site
  search in the browser (search id reused from the API response).
- **Card pinning**: `Ctrl+Alt+P` holds the current card open (gold border);
  press again to release.
- **Health dot** in the panel bar: green/amber/red with tooltip naming the
  degraded component (scout stale, trade cooldown, POESESSID missing, Client.txt,
  target build); `/api/health` now reports per-component status.
- **Setup checklist toast** at launch, only when something's missing
  (POESESSID / target build / Client.txt).
- **Real icons** (GDI+-generated waystone-diamond motif): tray, settings window,
  `assets/icon.ico` for the Phase 6 installer.
- **HUD position setting** (top-center/left/right, bottom-center).
- **Startup options**: start with Windows (dormant tray), **quit when the game
  exits** (2-min grace), and a copyable **Steam launch-option line** in Settings
  so the overlay starts with PoE2 itself.
- **Silent launcher** `PoE2 Overlay.vbs` — runs `electron.exe` directly, no
  console window (the `.cmd` stays for first-run setup and now also launches
  console-free).
- **USAGE.md**: setup, hotkey table, feature tour (screenshot placeholders).
- Parser: PoE2's single-line `Requires:` (incl. multi-part "Level 40, 55 Str")
  now parses into requirements (+2 tests, 7 total).

## 2026-07-12 (later) — Polish round 1 (settings window)

### Added
- **Settings window** (tray → Settings…, or ⚙ in the panel bar): rebindable
  hotkeys with press-to-capture fields (any Ctrl/Alt/Shift + A–Z/F1–F12/Space
  chord — replaces the 4-preset dropdown), overlay options (opacity/size/
  position/HUD), game paths (window title, Client.txt, BuildPlanner), account
  (POESESSID masked write-only, OAuth id/contact), advisor tag override.
  Saves apply live (no restart).
- **Single-instance lock** — double-launching the .cmd no longer creates two
  overlays.
- Game window title is now a setting (`overlay.target`); `--target` CLI flag
  still overrides for game-less testing.

## 2026-07-12 — Phase 5 (Recommendations v2: priced upgrade shopping list)

### Added
- **Upgrade shopping list** (`Ctrl+Alt+U` in game, or tray): every gear piece in
  the target build, priced — uniques via poe2scout (incl. names extracted from
  guide-prose slots' `<b>{...}` markup), rares via a relaxed trade search (70%
  roll headroom; falls back to the top-3 mods when the full aspirational set
  matches nothing, labeled as such). Pieces already captured with Ctrl+C show ✓
  owned. Sorted unowned-cheapest-first. Computed in the background 30 s after
  launch and every 15 min (`GET /api/recommendations` serves the cache
  instantly); real run: 7/13 pieces priced, e.g. Darkness Enthroned 1 ex,
  Chiming Staff 2 ex, Leyline Focus 5 ex.

### Fixed
- Trade governor spacing 1.5 s → 2.5 s (the sustained per-60s budget tier
  tripped on long background passes), plus optional wait-and-retry-once on 429
  for background jobs (interactive price checks still fail fast).

## 2026-07-10 (late) — Phase 4b (session HUD strip)

### Added
- **Session HUD**: thin click-through strip pinned top-center of the game window
  while attached — character · level · zone (+area level) · deaths · time-in-zone
  · session time. Live via the companion server's SSE stream (`/api/live`), no new
  endpoints. Tray menu: "Toggle session HUD" (persisted as `overlay.hud`).

### Fixed
- `settings.advisor` was missing from the PUT whitelist — the documented
  archetype-tag override was unreachable. (Found while demoing that the same
  waystone scores RISKY for the chaos/curse/ES build but CAUTION for a
  minion/life build.)

## 2026-07-10 (evening) — Phase 4 (pick advisor + map-mod warnings)

### Added
- **Pick advisor**: Ctrl+C a waystone/tablet → the card scores it against the
  *target build*, not just the market. Archetype tags auto-derived from the
  build's gem ids + ascendancy (chaos/dot/curse/es for John's Lich; overridable
  via `settings.advisor.tags`); rule table classifies each map mod as
  brick/danger/note **per archetype** (e.g. curse-effect mods only escalate for
  curse builds); verdict GOOD/CAUTION/RISKY/SKIP; reward line from the
  waystone's rarity/pack/drop-chance properties. Verified against a real
  captured T14 waystone: RISKY — curses gutted (Hexwarding) + recovery crippled
  (Smothering) — exactly the two mods that matter for this build.
- Card grows to fit advice (verdict + up to 5 findings, dangers first + rewards).
- Map items skip the trade search (their market price isn't the useful signal).

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
