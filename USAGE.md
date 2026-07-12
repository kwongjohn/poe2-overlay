# PoE2 Overlay — Usage

An in-game companion for Path of Exile 2: build tracking, instant price checks,
build-aware waystone advice, and a live session HUD — all overlaid on the game.
Read-only and GGG-compliant: it displays information and reads your clipboard/log;
it never touches the game client or automates anything.

## Setup

1. Run **`Start PoE2 Overlay.cmd`** once (installs dependencies, builds, starts —
   console output visible). For daily use, double-click **`PoE2 Overlay.vbs`**
   (silent, no console).
2. Play in **windowed-fullscreen** (Options → Graphics). Exclusive fullscreen
   cannot be overlaid. If the game runs as Administrator, run the overlay
   elevated too.
3. Open **Settings** (tray icon → Settings…, or ⚙ on the panel bar):
   - **POESESSID** (Account section) enables rare-item price checks — copy it
     from pathofexile.com cookies (F12 → Application → Cookies).
   - Set a **compare target** build in the panel (Library → 🎯) to enable the
     pick advisor and the upgrade shopping list.
4. Optional: **start with PoE2** — copy the Steam launch line from Settings →
   Startup into Steam → PoE2 → Properties → Launch Options. Pair with
   "Quit when game exits" for a fully automatic lifecycle.

## Hotkeys (active only while the game window is focused)

| Keys | Action |
|---|---|
| `Ctrl+Alt+O` (rebindable) | Toggle the dashboard panel (full build tracker UI) |
| `Ctrl+C` (game's own copy) | Capture hovered item → price card + advice |
| `Ctrl+Alt+U` (rebindable) | Upgrade shopping list (target gear, priced, cheapest first) |
| `Ctrl+Alt+T` | Open the last price check as a trade-site search in your browser |
| `Ctrl+Alt+P` | Pin / unpin the current card (stops the auto-hide) |

## What you'll see

- **Price card** (on Ctrl+C): uniques/currency get poe2scout 24h averages;
  rares get a live trade-search estimate ("from / median / N online").
  _[screenshot placeholder]_
- **Pick advice** (on Ctrl+C of a waystone/tablet): GOOD / CAUTION / RISKY /
  SKIP verdict scored against **your build's archetype** (auto-derived from the
  target build), with the reward stats listed. _[screenshot placeholder]_
- **Session HUD**: thin strip (position configurable) — character, level, zone,
  deaths, time-in-zone, session time. Tray → "Toggle session HUD".
  _[screenshot placeholder]_
- **Dashboard panel**: the full build tracker (plan, compare, DPS, advice,
  library, import) over the game. Also available in any browser at
  `http://127.0.0.1:4517` while the overlay runs. _[screenshot placeholder]_
- **Health dot** (panel bar, left): green = all good; amber = degraded (hover
  for what); red = companion server down.
- **Setup checklist toast** appears at launch if anything's missing
  (POESESSID, target build, Client.txt).

## Data & privacy

Everything runs locally. Captured items are logged to your disk (parser
fixtures + a zone-stamped loot log) for your own analytics. `POESESSID` is
stored in the local git-ignored `settings.json`, sent **only** to
pathofexile.com, never logged or displayed. Data sources: poe2scout,
the official trade API, your own `Client.txt`. Game data © Grinding Gear Games.
Unofficial fan tool — not affiliated with or endorsed by GGG.
