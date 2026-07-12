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
session. **Pick advisor done (2026-07-10 evening):** waystones/tablets score against the target
build (auto-derived archetype tags, per-archetype mod rules, GOOD/CAUTION/RISKY/SKIP +
rewards) — verified RISKY on a real T14 with curse-gutting + recovery-crippling mods.
Session HUD (top-center strip, tray-toggleable) and **Recommendations v2** done
2026-07-12: `Ctrl+Alt+U` → priced target-gear shopping list (poe2scout + relaxed trade
search, ✓ owned from captures, background-refreshed every 15 min). Rune/OCR module
deferred (RuneshapePriceChecker covers runes this league). Settings window done 2026-07-12 (tray → Settings… / ⚙: rebindable hotkeys, overlay/
game/account/advisor options, live apply; single-instance lock).
**Next session = polish round 2, all approved by John 2026-07-12:**
(1) trade-site deep link from the price card; (2) health status dot (server/scout/
trade) in bar + tooltip; (3) first-run checks card (game found, elevation match,
POESESSID set); (4) real tray/app icons; (5) price-card pinning (hold open);
(6) HUD position presets (top-center clashes with boss bars); (7) **start with
PoE2** = Steam launch-option line shown in settings w/ copy button + new "quit when
game exits" option (grace ~2 min) + optional dormant start-with-Windows;
(8) parser hardening (single-line `Requires:`, corpus oddities); (9) USAGE.md
(hotkey cheat-sheet + feature tour; screenshots from John later); (10) **silent
launcher** — run `electron.exe` directly (GUI exe, no console) via a `.vbs`/shortcut;
keep the `.cmd` for first-run setup only. Then **Phase 6** (installer + auto-update).
Still pending: GGG OAuth reply (follow up ~Jul 25). Launch: `Start PoE2 Overlay.cmd` · tests: `npm test` · full history:
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
