# PoE2 Overlay — All-in-One In-Game Companion

**Purpose:** a Windows overlay app for Path of Exile 2 that replaces the current juggle of
multiple apps and web pages with one in-game surface: build tracking and plan-vs-actual
comparison, live market/price checking, and real-time personalized recommendations.

**Relationship to `poe2-build-tracker/`:** this is the overlay product that
`poe2-build-tracker/HANDOFF.md` §5 planned as the "next focus". The build tracker's
companion server and React UI are **reused, not rewritten** — this project adds the
Electron overlay shell, the market/pricing module, and the clipboard/OCR capture layer.

**State (2026-07-12): Phases 0–5 plus two polish rounds done and John-verified
in-game; next is Phase 6** (electron-builder NSIS installer + portable exe,
auto-update via GitHub Releases — `assets/icon.ico` ready), then USAGE screenshots
(John), leveling hints (next league), OCR (deferred, like the rune module —
RuneshapePriceChecker covers runes this league). Working today: overlay shell
(hotkey panel hosting the full tracker UI, settings window, tray, session HUD),
Ctrl+C item capture → price card (poe2scout + trade2 API), build-aware
waystone/tablet pick advisor, and the priced upgrade shopping list (`Ctrl+Alt+U`).
Still pending: GGG OAuth reply (no response as of 2026-07-12; follow up ~Jul 25).
Session-by-session history lives in `CHANGELOG.md`.

Daily launch: `PoE2 Overlay.vbs` (silent) · first run: `Start PoE2 Overlay.cmd` ·
tests: `npm test` · user guide: `USAGE.md` · history: `CHANGELOG.md` (update every
session) · roadmap/boundary: `PLAN.md` (§4b) · external deps:
`EXTERNAL-REQUIREMENTS.md` · secrets: `CREDENTIALS.local.md` (gitignored).
Public repo: github.com/kwongjohn/poe2-overlay — commit every session.
Known constraints: don't run the old tracker's server simultaneously (port 4517);
game must be windowed-fullscreen; overlay elevation must match the game's.
Project classification (2026-07-12, `audit/DECISIONS.md`): leisure, portfolio-usable;
no `audit/PROGRESS.md` logging required.

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

Unofficial fan tool. Not affiliated with or endorsed by Grinding Gear Games.
