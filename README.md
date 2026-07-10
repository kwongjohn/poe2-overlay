# PoE2 Overlay — All-in-One In-Game Companion

**Purpose:** a Windows overlay app for Path of Exile 2 that replaces the current juggle of
multiple apps and web pages with one in-game surface: build tracking and plan-vs-actual
comparison, live market/price checking, and real-time personalized recommendations.

**Relationship to `poe2-build-tracker/`:** this is the overlay product that
`poe2-build-tracker/HANDOFF.md` §5 planned as the "next focus". The build tracker's
companion server and React UI are **reused, not rewritten** — this project adds the
Electron overlay shell, the market/pricing module, and the clipboard/OCR capture layer.

**State (2026-07-10): Phases 0–3a done and John-verified in-game.** Working now:
overlay shell attached to the game (hotkey panel hosting the full tracker UI, settings
bar, tray), Ctrl+C capture → parser → corpus/loot-log/registry, and the price card
(poe2scout 24h avg, league auto-detect, cached + dual-base failover). Rare/magic pricing
works via the trade2 API (stat-filtered search, governor, POESESSID in settings).
Public repo: github.com/kwongjohn/poe2-overlay — commit + update CHANGELOG.md every
session. **Next: the pick advisor** (score captured waystones/tablets against the
build: danger mods per archetype + market value; decided 2026-07-10, rune/OCR module
deferred — RuneshapePriceChecker covers runes this league). Still pending: GGG OAuth
reply (follow up ~Jul 25). Launch: `Start PoE2 Overlay.cmd` · tests: `npm test` · full history:
`CHANGELOG.md` (update it every session) · roadmap/boundary: `PLAN.md` (§4b) ·
external deps: `EXTERNAL-REQUIREMENTS.md` · secrets: `CREDENTIALS.local.md`
(gitignored). Known constraints: don't run the old tracker's server simultaneously
(port 4517); game must be windowed-fullscreen; overlay elevation must match the game's.

## Requirements & compliance

- Windows 10/11; Path of Exile 2 in **windowed-fullscreen** (overlays cannot render
  over exclusive fullscreen). If the game runs as Administrator, run the overlay
  elevated too.
- **Read-only by design:** the app only displays information and reads sanctioned
  channels — the clipboard (your own Ctrl+C), the game's `Client.txt` log, public
  price APIs, and (optionally) GGG's official OAuth API. It never reads game memory,
  never injects input, and never automates anything: one keypress = one action, always
  yours.
- **Your `POESESSID`** (optional, for trade searches) is stored only in the local,
  git-ignored `settings.json`, sent only to `pathofexile.com`, and never logged.
- Data sources: [poe2scout](https://poe2scout.com) (prices), official trade site APIs.
  Game data and art © Grinding Gear Games.

*(Folder name `poe2-overlay` is a placeholder — rename freely.)*

Unofficial fan tool. Not affiliated with or endorsed by Grinding Gear Games.
