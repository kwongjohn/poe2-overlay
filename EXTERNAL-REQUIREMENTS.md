# PoE2 Overlay — External Requirements: How to Accomplish Each

_Written 2026-07-09. Companion to `PLAN.md` §5. Each section: what it is, the exact
steps to get it working, and drafts where an email or configuration is involved.
Order = the order you'll actually need them (roadmap phases in parentheses)._

---

## 1. GGG OAuth `client_id` (continuous — chase now, lands whenever GGG replies)

**What:** GGG hand-issues a `client_id` per OAuth application. It unlocks the official
character API (gear + allocated passives + skills) — the clean long-term "current
character" source. The tracker's OAuth flow is already built; only this ID is missing.

**Status:** email confirmed sent (~2026-07-04; John confirmed 2026-07-12). No reply
yet — send the follow-up draft ~2026-07-25.

**Steps:**
1. If not yet sent — or since the plan changed to a **publicly distributed** app —
   email **oauth@grindinggear.com** with the draft below. The change matters: the
   original draft said "personal, local"; a public client whose `client_id` ships
   inside a distributed open-source app is normal (PKCE public clients are designed
   for this), but GGG should be told that's the intent.
2. Expect a slow reply (GGG say these are low-priority, worse around league events).
   If ~3 weeks pass, send the follow-up draft.
3. On receipt, configure per `poe2-build-tracker/OAUTH-SETUP.md` §2:
   `settings.json` → `{ "oauthClientId": "...", "oauthContact": "jkwong@ateneo.edu" }`.
4. Then unblock the deferred work: map the real character JSON → `.build` schema, wire
   as primary "current" source (clipboard capture stays as fallback).

**Email draft (new/updated registration):**

> **To:** oauth@grindinggear.com
> **Subject:** OAuth public client registration — PoE2 Overlay (open-source desktop companion)
>
> Hi GGG team,
>
> I'd like to register a **public client** (Authorization Code + PKCE, no client
> secret) for an open-source Path of Exile 2 desktop companion app.
>
> - **Application name:** PoE2 Overlay
> - **What it does:** a read-only overlay that compares the player's own character
>   against a planned build (passives, gear, skills) and shows progress/advice. No
>   automation, no game-client interaction; display + official APIs only.
> - **Client type:** public (PKCE) — the app is distributed open source on GitHub, so
>   the client_id will be embedded in the public code, per the public-client model.
> - **Grant type:** authorization_code (with refresh)
> - **Scope requested:** `account:characters`
> - **Redirect URI:** `http://127.0.0.1:4517/api/auth/callback` (loopback; happy to
>   use whatever port/URI you prefer)
> - **Contact email:** jkwong@ateneo.edu
> - **Expected volume:** low — each user reads only their own characters, on demand
>   plus an occasional snapshot; standard rate-limit headers will be honored.
>
> If an earlier request from this address for "PoE2 Build Tracker (personal)" is still
> queued, this supersedes it — same underlying tool, now being released publicly.
>
> Thanks for your time!
> John Chris Kwong

**Follow-up draft (if no reply after ~3 weeks):**

> **Subject:** Re: OAuth public client registration — PoE2 Overlay (open-source desktop companion)
>
> Hi, just a gentle follow-up on the public-client registration below from
> <date sent>. No rush if it's queued — I only want to make sure it didn't get lost.
> The app works without the API in the meantime, so whenever you get to it is fine.
> Thanks!

---

## 2. PoE2 official trade API (Phase 3 — price check)

**What:** `https://www.pathofexile.com/api/trade2/search/...` + `/fetch/...` — the same
API the official trade site uses. Powers live listings in the price-check card. There is
no registration; there is also no official third-party blessing, so the requirement is
**etiquette**, not access.

**Steps:**
1. **No signup.** Some endpoints work anonymously; authenticated features (and friendlier
   treatment) use the player's own `POESESSID` cookie.
2. **Get `POESESSID`** (each user does this for themselves; the app should have a
   settings field + these instructions in USAGE):
   - Log in at [pathofexile.com](https://www.pathofexile.com) in Chrome/Edge.
   - F12 → **Application** tab → **Cookies** → `https://www.pathofexile.com` → copy the
     `POESESSID` value (32-hex string).
   - Paste into the overlay's settings. It expires when the browser session is
     invalidated (password change, logout everywhere) — re-copy when searches start
     returning 401/403.
   - John's current value: **`CREDENTIALS.local.md`** (gitignored) — never in this file,
     which will be committed to the public repo.
3. **Storage rule:** keep it in the local gitignored `settings.json` only. It is a
   session credential — never log it, never send it anywhere but pathofexile.com, and
   the public repo's README must say the app does exactly that.
4. **Client behaviour to implement** (this is what keeps us unbanned/unthrottled):
   - Send a real `User-Agent`: `poe2-overlay/<version> (contact: jkwong@ateneo.edu)`.
   - Parse `X-Rate-Limit-*` / `Retry-After` response headers and govern requests to
     stay inside the advertised budget; exponential backoff on 429.
   - One search per explicit user keypress — never poll or auto-refresh listings.
5. **Smoke test** (Phase 3, before building the client): copy a search from the trade
   site's own network tab and replay it with curl to capture a real request/response
   pair for the fixture suite.

---

## 3. poe2scout API (Phase 3–4 — averaged prices, history, currency snapshots)

**What:** free community price API, [api.poe2scout.com/swagger](https://api.poe2scout.com/swagger)
(interactive docs). 24h-averaged prices (stable, good default — Runeshape's choice),
price history for sparklines, currency snapshot pairs.

**Steps:**
1. **No key, no registration.** Their stated ask: sustained users should identify
   themselves — set the same `User-Agent` as §2 on every request.
2. Open the swagger page and note the endpoints we need: item price lookup, currency
   snapshot pairs, `/Items/{itemId}/History` **[verify exact paths against swagger at
   Phase 3 — sourced from their docs summary, not tested]**.
3. Smoke-test with curl (one currency lookup + one history call), save responses as
   test fixtures.
4. Implement with caching (prices change slowly at 24h averaging — cache ≥15 min) and
   the contract-check script from PLAN §8.
5. Courtesy step since we're going public: post/ask in their Discord (linked from
   [poe2scout.com](https://poe2scout.com)) that an open-source overlay will be using the
   API — cheap goodwill, and they'll flag any limits before they become blocks.

---

## 4. poe.ninja (Phase 3 — latest-listing prices, fallback source)

**What:** free, undocumented API behind [poe.ninja](https://poe.ninja)'s PoE2 economy
pages. Complementary to poe2scout: latest listings vs 24h averages.

**Steps:**
1. No key. Discover endpoints by opening a poe.ninja PoE2 economy page with the browser
   network tab open; record the JSON URLs (they're stable within a league).
2. Same `User-Agent`, aggressive caching (≥30 min), and treat it strictly as the
   **fallback** source so our request volume stays trivial.
3. Save one response per category as fixtures; add to the contract-check script (an
   undocumented API is exactly the one that changes without notice).
4. Credit poe.ninja in the README's data-sources section.

---

## 5. Clipboard item capture (Phase 2 — the primary data channel)

**What:** in-game, hovering an item and pressing **Ctrl+C** (Ctrl+Alt+C for advanced
text) copies its full text. The overlay reads the clipboard on the user's keypress.
Nothing to acquire — only constraints to respect.

**Steps / constraints:**
1. Game and overlay must run on the **same machine** (cloud gaming like GeForce Now
   doesn't forward the clipboard — EE2 documents the same limit).
2. **Privilege parity:** if PoE2 runs as Administrator, the overlay must too, or hotkey
   hooks and window-attach fail silently. First-run check: detect the game process
   elevation and warn on mismatch.
3. The user presses Ctrl+C — the app never injects it (GGG compliance line).
4. Build the item-text corpus as capture works: every parsed item gets appended (dedup)
   to `test/fixtures/items/*.txt` for the parser regression suite.

---

## 6. Client.txt (already done — carry over)

**What:** level/zone/death events; explicitly permitted by GGG. Fully implemented in the
tracker's companion server (fs.watchFile tail + SSE).

**Steps:** nothing new. Vendored with the server in Phase 1; the existing
`settings.clientTxtPath` auto-detect (Steam path) carries over. Verify once inside
Electron that the watcher behaves identically when spawned from the main process.

---

## 7. OCR — Windows OCR primary, Tesseract fallback (Phase 5, optional)

**What:** read character-sheet aggregates (life/ES/resists, tooltip DPS) from screen
captures. Runeshape's proven order: Windows OCR (fast, built-in) → Tesseract (fallback).

**Steps:**
1. **Verify Windows OCR availability** (needs Win10 1809+; this machine is Windows 11
   Pro, so yes). Check the English OCR language pack in PowerShell (admin):
   ```powershell
   Get-WindowsCapability -Online | Where-Object Name -like 'Language.OCR*en-US*'
   ```
   If `State` isn't `Installed`:
   ```powershell
   Add-WindowsCapability -Online -Name 'Language.OCR~~~en-US~0.0.1.0'
   ```
2. **Bridge into Electron:** Windows OCR is a WinRT API (`Windows.Media.Ocr`), not
   callable from Node directly. Two options, decide at Phase 5:
   - a ~50-line **C# helper exe** (image path in, JSON text+boxes out) — Runeshape's
     model, most robust; or
   - PowerShell WinRT interop invoked as a child process — zero build toolchain but
     slower per call. **[spike both, pick by latency]**
3. **Tesseract fallback:** prefer `tesseract.js` (WASM, npm-only, no user install).
   Only if its accuracy/latency disappoints, fall back to native Tesseract via
   `winget install UB-Mannheim.TesseractOCR`.
4. **Capture:** PrintWindow-style capture of the PoE2 window (Runeshape default),
   region presets for the character sheet at John's confirmed windowed-fullscreen
   resolution, manual region override in settings.
5. Collect screenshot+expected-text pairs as fixtures, same regime as the item corpus.

---

## 8. Game data for the item parser (Phase 2 — bases, stats, mod text)

**What:** the parser needs item-base and stat/mod reference data. The tracker already
vendors tree + gem data; EE2 maintains the item/stat dataset for PoE2 and a pipeline
that regenerates it each patch.

**Steps:**
1. ~~License check~~ **Confirmed 2026-07-09: MIT** (© 2020 Alexander Drozdov, carried
   from Awakened PoE Trade). Vendoring with the copyright + permission notice included
   is explicitly allowed.
2. Locate its data directory and generation scripts (in the Awakened lineage this is a
   `data/` folder of ndjson per language plus a Python/TS regeneration pipeline —
   **[verify layout in the actual repo]**).
3. Vendor the English dataset into our repo with the license text + attribution
   (README data-sources section: EE2, and ultimately GGG for the underlying game data —
   keep the standard "© Grinding Gear Games, unofficial fan tool" notice).
4. Document the refresh procedure (their pipeline, our copy step) in the repo so each
   league/patch update is a 10-minute chore, not archaeology.
5. Fallback if the license or layout blocks reuse: derive base/stat data from GGG's
   own trade API static endpoints (`/api/trade2/data/stats`, `/api/trade2/data/items`) —
   heavier lift, fully first-party. **[endpoint names to verify]**

---

## 9. Public GitHub repository (Phase 0 setup, Phase 6 releases)

**What:** decided 2026-07-09 — public repo, like `poe2-build-tracker`.

**Steps:**
1. Create `github.com/kwongjohn/poe2-overlay` (public). **[repo name = placeholder
   project name — John may rename]**
2. **License: MIT**, matching the tracker and the vendored upstreams; include the
   upstream MIT notices for anything vendored (poe2-build-planner, EE2 data if used).
3. README must carry from day one:
   - the GGG non-affiliation notice + "© Grinding Gear Games" for game data/art;
   - the compliance statement (read-only; clipboard/log/OCR/APIs; no memory reading,
     no input automation, one keypress = one action);
   - the POESESSID handling statement (§2.3);
   - windowed-fullscreen requirement.
4. `.gitignore` before first commit: `settings.json`, `.oauth-token.json`,
   `sessions.jsonl`, `builds/`, `*.local.*`, `node_modules/`, `dist/` — no credential
   or personal-state file ever lands in a public repo.
5. **Workspace caveat** (from the root CLAUDE.md): git operations from the Linux
   sandbox corrupt renames and leave `index.lock` junk on this Windows mount — do
   commits/pushes from the Windows side, and check `.git/` for 0-byte junk files if a
   commit blocks.
6. Phase 6: `electron-builder` publishes the NSIS installer + portable exe to GitHub
   Releases; `electron-updater` points at the repo for auto-update. Tag releases
   `v0.x.y`; the download page pattern to copy is EE2's ("only official sources are
   the repo releases") since fake-mirror malware is a real problem in this niche
   (note the many EE2 clone repos in search results).
7. **GitHub access token:** John's existing PAT was updated (2026-07-09) to include
   this repository — token value and expiry tracked in `CREDENTIALS.local.md`
   (gitignored).

---

## Quick status board

| # | Requirement | Action needed | Blocking phase | Owner |
|---|---|---|---|---|
| 1 | GGG OAuth client_id | Sent; no reply as of 2026-07-12 — follow up ~Jul 25 | none (parallel) | GGG (grant) |
| 2 | Trade API + POESESSID | Cookie copy at Phase 3; build governor | 3 | Claude builds, John supplies cookie |
| 3 | poe2scout | Verify swagger endpoints; fixtures | 3 | Claude |
| 4 | poe.ninja | Discover endpoints via network tab | 3 | Claude |
| 5 | Clipboard | Nothing to acquire; privilege-parity check | 2 | Claude |
| 6 | Client.txt | Done; re-verify under Electron | 1 | Claude |
| 7 | OCR | Language-pack check; helper spike | 5 | Claude |
| 8 | EE2 game data | License check, vendor + attribute | 2 (check at 0) | Claude |
| 9 | Public GitHub repo | Create repo, license, notices, gitignore | 0 | John creates, Claude fills |
