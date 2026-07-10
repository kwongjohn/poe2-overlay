# PoE2 Overlay — Project Plan

_Written 2026-07-09 by Claude Fable 5. Sources: [poeoverlay.com](https://www.poeoverlay.com/),
[RuneshapePriceChecker](https://github.com/Barragek0/RuneshapePriceChecker),
[Exiled Exchange 2](https://github.com/kvan7/Exiled-Exchange-2),
`poe2-build-tracker/HANDOFF.md`. Anything marked **[verify]** is an inference or estimate —
confirm with John before it drives a decision._

---

## 1. Vision & scope

One always-available in-game surface replacing today's multi-app juggle:

| Today | In the overlay |
|---|---|
| Build tracker web UI (localhost:5173) | Build panel: plan, compare, advice, DPS, live tracker |
| Trade site / poe2scout / poe.ninja tabs | Price check on hotkey + market dashboard |
| Guide sites, cheat sheets | Reference panels (leveling, vendor recipes, mechanics) |
| Manual "current character" upkeep | Clipboard capture of real gear; optional OCR of stats |

**Non-goals:** content platform (guides/tier lists — import from them instead), anything
touching game memory or automating input, mobile/mac.

## 2. What the references teach us

- **PoE Overlay II** (closed source): the feature bar — price check with smart stat
  preselection, stash value tracker, live market search, price history, campaign guide.
  Ships as Overwolf app or standalone. We want the standalone shape (Overwolf adds ads,
  telemetry, and a heavyweight runtime).
- **Exiled Exchange 2** (open source, fork of Awakened PoE Trade): the architecture to
  study line-by-line. Electron overlay attached to the PoE2 window, **Ctrl+C clipboard
  capture → item text parser → official trade API + price sources**, global hotkeys,
  click-through. Proves the whole capture path works in PoE2 today and is
  community-accepted as GGG-compliant.
- **RuneshapePriceChecker** (open source, C#/.NET): the OCR playbook — screen region
  capture (PrintWindow), **Windows OCR primary / Tesseract fallback**, multi-stage price
  matching (exact → tier → fuzzy) to absorb OCR errors, poe2scout (24h-averaged) +
  poe.ninja (latest listing) as dual price sources, hot-reloadable config, mock-data test
  suite. We adopt the patterns, not the C# stack.

## 3. Stack (recommendation)

**Electron + TypeScript, reusing the build tracker.** Rationale: the hardest 60% of the
product (build library, plan/compare, DPS engine, advice engine, Client.txt live
tracking, PoB import, OAuth scaffold) already exists as a React/TS app + Node companion
server; Exiled Exchange 2 proves Electron handles the overlay mechanics in PoE2; and it
matches John's existing stack. A C#/WPF rewrite (Runeshape's stack) would be leaner at
runtime but forfeits all existing code. **[verify — John may prefer learning C#]**

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Electron** (latest LTS) + TypeScript | Frameless, transparent, always-on-top window attached to the PoE2 window; click-through via `setIgnoreMouseEvents` |
| Window attach / focus tracking | `node-window-manager` or FFI (koffi) to user32 | Follow EE2's `OverlayWindow` implementation; overlay shows only when PoE2 is focused |
| Global hotkeys | `uiohook-napi` | EE2 uses low-level hooks, not Electron `globalShortcut`, so hotkeys work while the game has focus |
| UI | **React 19 + TS + Zustand** (existing app, embedded) | New overlay chrome (dock, panels, opacity) around existing screens |
| Backend | Existing zero-dep Node companion server (`:4517`) + a new `market` module | Spawned by the Electron main process; endpoints stay HTTP/SSE so the web version keeps working |
| Item parsing | New shared TS package (`item-parser`) | Port patterns from EE2's parser; consumed by both price check and "current gear" ingestion |
| OCR (Phase 5) | Windows OCR via a small helper (PowerShell `Windows.Media.Ocr` or tiny C# exe), Tesseract/tesseract.js fallback | Runeshape's order: Windows OCR is faster/lighter |
| Packaging | electron-builder → NSIS installer + portable exe; auto-update via GitHub Releases later | |

**Repo decision (John, 2026-07-09):** monorepo inside this new top-level folder,
vendoring the tracker's `app/` + `server/`. Public GitHub repo (see
`EXTERNAL-REQUIREMENTS.md` §9).

## 4. Features

### Core (differentiators)
1. **Overlay shell** — attach to PoE2 window, hotkey show/hide (default Shift+Space
   **[verify]**), per-panel opacity, click-through when idle, only visible while the game
   is focused. Requires the game in **windowed-fullscreen** (true exclusive fullscreen
   can't be overlaid — document this; every overlay tool has the same constraint).
2. **Price check** — hover item + hotkey → capture via Ctrl+C clipboard → parse → query
   official trade2 API (listings) + poe2scout (24h averages) + poe.ninja (latest) →
   compact result card with stat filters preselected (EE2-style). Bulk/exchange tab for
   currency.
3. **Build panel** — the existing tracker screens (plan-vs-actual, passive/skills/items
   compare, DPS index, advice, live level/zone/death pill) as overlay panels.
4. **Real-gear ingestion** — every captured item can be registered as the character's
   actual equipment → Compare and DPS run on **real** mods/ilvl/quality (the tracker's
   biggest current gap, per HANDOFF.md).
5. **Recommendations v2** — the existing advice engine plus market data: "you're 18
   passives behind", "Sirenscale upgrade ≈ 2 div on trade right now", "deadliest zone",
   "cheapest DPS-per-currency upgrade" (needs 3+4 combined — this is the all-in-one payoff
   no single existing tool has).

### Supporting
6. **Market dashboard** — currency exchange rates, watchlist, price-history sparklines
   (poe2scout history endpoints).
7. **Reference panels** — leveling plan checklist (already computed by `/api/plan`),
   static cheat sheets (vendor recipes, mechanics), user notes.
8. **Session HUD** — compact strip: level, zone, deaths, session time, XP/hr if
   derivable from level events **[verify feasibility]**.

### Later / optional
9. **Character-sheet OCR** — life/ES/resists + tooltip DPS to sanity-check the DPS index
   and power "res not capped" advice.
10. **Stash value tracker** — needs OAuth `account:stashes` or manual capture; park until
    the GGG `client_id` lands.
11. **League-mechanic modules** (Runeshape-style rune pricing etc.) — per-league plugins.

## 4b. Overlay vs Dashboard boundary (decided with John, 2026-07-09)

**Principle:** the **overlay** is for glanceable, real-time, context-triggered
information — something just happened (hover, zone change, level-up, a choice on
screen) and the answer must arrive in under a second with at most one keypress. The
**dashboard** (the vendored tracker UI) is for planning, editing, and analysis —
build editing, deep compares, DPS tuning, history charts, imports, library. The
overlay also **gathers data** (captured items, prices seen, session events) that the
dashboard consumes later.

| Overlay (in-game widgets) | Dashboard (full UI window) |
|---|---|
| Price check card (Ctrl+C) | Build editor / passive tree / gems / items |
| Waystone/tablet **pick advisor** (per build) | Compare current-vs-target deep dive |
| Map-mod danger warnings (per build) | DPS comparator + tuning |
| Compact session HUD (level/zone/deaths/XP-rate) | Session history & analytics charts |
| Leveling step hints (auto-advance off Client.txt) | Leveling plan editing |
| Cheat sheets / regex helper (hotkey summon) | Library, import, target management, settings |
| Data capture → `sessions.jsonl` + item log | Consumes the captured data |

Implication: the Phase-1 panel (full UI over the game) stays as the **dashboard
shortcut**, but overlay development from Phase 2 on builds **compact widgets**, not
more full-screen UI. The dashboard remains reachable outside the game (browser at
`127.0.0.1:4517` or the panel).

## 5. External requirements

| Dependency | What for | Access / constraints |
|---|---|---|
| **PoE2 trade API** (`pathofexile.com/api/trade2/...`) | Live listings for price check | No official third-party blessing; used by EE2 and every price checker. Honor `X-Rate-Limit-*` headers with backoff; requires the user's own `POESESSID` for some endpoints — store locally, never transmit elsewhere |
| **poe2scout API** ([api.poe2scout.com/swagger](https://api.poe2scout.com/swagger)) | Averaged prices, price history, currency snapshots | Free; set a `User-Agent` with contact email for sustained use |
| **poe.ninja** (PoE2 endpoints) | Latest-listing prices, fallback source | Free, undocumented; cache aggressively |
| **GGG OAuth API** | Auto "current" character (gear + passives) — the clean long-term source | Already built in the tracker; **blocked on GGG issuing a `client_id`** (email sent per OAUTH-SETUP.md — chase this) |
| **Client.txt** | Level/zone/death events | Done in the tracker; explicitly permitted by GGG |
| **Clipboard (Ctrl+C item text)** | Item capture for pricing + real gear | Built into the game; the sanctioned channel all price checkers use |
| **Windows OCR / Tesseract** | Phase 5 stat reading | Local, no accounts; Windows OCR needs Win10 1809+ |
| **Game data** | Item bases, stats, mod text for the parser | Vendored tree/gem data exists; item-base + stat data can be ported from EE2's data pipeline (check its license — Awakened PoE Trade lineage is MIT **[verify]**) |

## 6. GGG compliance guardrails (non-negotiable)

GGG's rule: nothing may *interact with* the game client; external read-only tools are
fine. Concretely:
- **Allowed (we do):** overlay display, reading the clipboard, reading Client.txt,
  screen capture + OCR, official APIs, one keypress = at most one game action.
- **Forbidden (we never):** memory reading/injection, input automation (no auto-Ctrl+C,
  no auto-clicks), packet inspection, anything that plays the game for you.
- Cautionary tale: the 2020 PoE Overlay ban wave — keep the tool obviously passive and
  keep a compliance note in the README.

## 7. Roadmap

Phases are sized as single focused Claude Code sessions with John testing in-game
between them. Durations are estimates to validate, not promises.

- **Phase 0 — Spike & decisions (1 session).** Confirm open questions (§9). Scaffold
  Electron + TS. Prove the risky mechanics in isolation: attach a transparent
  always-on-top window to the real PoE2 window, global hotkey via uiohook while the game
  is focused, click-through toggle, clipboard read of a real in-game Ctrl+C. **Exit
  criterion: a hello-world panel toggling over the live game.** If this fails on John's
  machine/GPU setup, everything else changes — do it first.
- **Phase 1 — Overlay shell hosting the tracker (1–2 sessions).** Embed the existing
  React app + spawn the companion server from Electron main. Dock/panel chrome,
  show-only-when-game-focused, plus the **basic settings panel** (decided 2026-07-09):
  transparency/opacity slider, panel size, relocate (drag + corner presets, default
  **bottom-right** of the game window), hotkey rebind — persisted to `settings.json`.
  Immediate value: plan/compare/DPS/advice over the game. (= HANDOFF.md Phase A.)
- **Phase 2 — Clipboard capture & item parser (1–2 sessions).** `item-parser` package
  with a real-item text corpus; hotkey → parse → (a) `POST /api/current/item` to update
  real gear (HANDOFF.md Phase B), (b) hand off to Phase 3's price check. Unit-test
  heavy.
- **Phase 3 — Price check (2 sessions).** trade2 API client with rate-limit governor +
  poe2scout/poe.ninja clients with caching; EE2-style result card with stat filter
  preselection; bulk exchange tab. Mock-fixture tests, then live verification.
- **Phase 4 — Recommendations v2 + market dashboard (1–2 sessions).** Fuse compare-diff
  + prices ("cheapest upgrade"), currency dashboard, watchlist, history charts.
- **Phase 5 — OCR (optional, 1–2 sessions).** Windows OCR helper, character-sheet
  region capture, resist/life/ES ingestion; Runeshape-style fuzzy matching.
- **Phase 6 — Ship quality (1 session).** electron-builder installer producing a real
  double-clickable `.exe` (until then, `Start PoE2 Overlay.cmd` is the launcher),
  first-run setup (detect game window, league picker, POESESSID entry), auto-update,
  README/USAGE docs.
- **Continuous:** chase the GGG `client_id`; when it lands, wire the character API as the
  primary "current" source with clipboard capture as fallback.

## 8. Testing & verification strategy

- **Parsers are the correctness core:** maintain a corpus of real item texts (copied
  in-game across rarities/classes/leagues) and OCR samples; regression-test every parser
  change against it. Runeshape's mock-data suite is the model.
- **API clients:** fixture-based unit tests + a contract-check script that hits each
  live API once and diffs response shape (catches upstream changes early).
- **Rate limiting:** tests that the governor never exceeds advertised `X-Rate-Limit`
  budgets; exponential backoff on 429.
- **Overlay mechanics:** scripted Electron tests where possible, but the decisive checks
  are a **manual in-game protocol** John runs each phase: windowed-fullscreen + windowed,
  multi-monitor, DPI scaling (his display **[verify setup]**), alt-tab behavior, game
  patch day.
- **Session convention:** per workspace rules, every session ends with a shipped
  artifact and a line in `audit/PROGRESS.md` if this becomes a tracked project
  **[verify — is this leisure or portfolio?]**.

## 9. Decisions (answered by John, 2026-07-09) & remaining opens

1. **Repo shape: DECIDED** — monorepo vendoring the tracker's `app/`+`server/`.
2. **Name:** still open; `poe2-overlay` remains the placeholder.
3. **Audience: DECIDED** — public GitHub release. Setup steps and required notices in
   `EXTERNAL-REQUIREMENTS.md` §9.
4. **Fullscreen mode: CONFIRMED** — John plays windowed-fullscreen; overlay is viable.
5. **OAuth status:** still open — confirm the registration email actually went out;
   updated draft (public-distribution wording) in `EXTERNAL-REQUIREMENTS.md` §1.
6. **Hotkeys / v1 panel priority:** still open; defaults in the plan until John says
   otherwise.

External-requirement acquisition steps + email drafts: **`EXTERNAL-REQUIREMENTS.md`**.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Game patch changes item text / log format / trade API | Parser corpus + contract checks catch it fast; parsers versioned per league |
| Trade API throttling or POESESSID friction | poe2scout/poe.ninja as degraded-mode price sources; aggressive caching |
| Exclusive-fullscreen users | Document requirement; detect and warn on first run |
| Electron overlay perf while gaming | Panels render only when visible; SSE not polling; measure with the game running (PC-Performance-Monitor can help) |
| GGG policy drift | Guardrails in §6; passive-only design; watch dev forum |
| Scope creep toward "platform" | HANDOFF.md's positioning stands: companion, not content site |
