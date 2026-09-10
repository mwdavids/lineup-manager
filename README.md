# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. Everything lives in one `index.html` — inline
CSS + vanilla JavaScript, **no build step, no server, no network requests**. All data is
stored locally in your browser via `localStorage`.

> **Canonical app URL:** **https://happy-field-051df6c0f.5.azurestaticapps.net** (Azure Static
> Web Apps — includes optional [cloud sync](#cloud-sync-azure--optional)).
> The old GitHub Pages address **https://mwdavids.github.io/lineup-manager/ is deprecated** and
> now just redirects here — please update your bookmarks / Home Screen icon. The app still runs
> fully offline and can be self-hosted from a single `index.html` as described below.

The midfield three is a single **Defensive Mid (DM)** at the base with **two Attacking Mids
(AM)** ahead of it — so the slots are GK · RB · CB · CB · LB · **DM · AM · AM** · RW · ST · LW.
Players whose listed positions include **CM are automatically eligible for the AM slots**, so
your existing roster maps cleanly without relabelling anyone.

## What it does

- Manages your roster (foot + up to three positions per player).
- Builds a fair, explainable lineup plan for a 4-3-3 with **rolling substitution windows**.
- Runs a live sideline timer with loud substitution alerts at every sub window.
- Works with no internet, no account, and no other device.

## How to open it on an iPad

1. Copy `index.html` onto the iPad (AirDrop, email, iCloud Drive, USB, or a one-time
   download). Open it in **Safari** (double-tap the file, or open the download).
2. That's it — the app runs entirely in the browser. After the first open it needs **no
   network** at all.

### Add to Home Screen (recommended)

For a full-screen, app-like experience:

1. Open `index.html` in Safari.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the new **Lineup** icon. It opens full-screen with no Safari chrome —
   perfect for the sideline.

### Offline & data notes

- All roster and game data is saved in this browser's **`localStorage`**. It persists
  between sessions on the same device/browser.
- Because storage is local: data is **per-device**. To move a lineup or roster to another
  device (e.g. plan on your computer, coach from your iPad), use **Sync between devices**
  below — no account or server required.
- Clearing Safari website data (or "Add to Home Screen" vs. regular Safari being treated
  as separate storage) will reset the app. Keep one launch method for continuity.
- The pre-seeded 19-player roster loads automatically the first time.

## Sync between devices

Everything is still **fully offline** — these features move data via links and files you
control; nothing is ever uploaded to a server.

### Share link (easiest: plan on computer → open on iPad)

1. On the device where you built the plan, open the **Plan** tab (or **Game Setup**) and tap
   **🔗 Share game link**. The link is copied to your clipboard and shown so you can select it.
2. Send it to your other device however you like — **AirDrop, email, Messages, or Notes**.
3. Open the link on the iPad. The app asks **"Load shared game?"**; confirm, and the game —
   its periods/minutes/sub-interval, availability, the full plan, and the pitch map — is added
   to that device's **Saved games** and opened. Nothing you already had is overwritten.

**Short vs. long links.** When the app can reach the internet it stores the game server-side
and gives you a tiny **`#s=…` short link** (great for Messages, which can truncate long URLs) —
opening that link needs internet. If you're **offline**, it automatically falls back to a long
**`#g=…` link** that carries the whole game in the URL after the `#` (which browsers never send
to a server) and opens with no connection at all. Both round-trip the plan, availability, and
pins; old `#g=` links keep working forever.

- **Share roster** (Game Setup → **🔗 Share roster**) makes a `#r=…` link that syncs just the
  players (foot + positions). Opening it updates matching names and adds any new players,
  keeping that device's saved games.
- Shared games attach to the local roster **by player name**, so importing doesn't create
  duplicate players when both devices started from the same roster.

### Export / Import (full backup & fallback)

On **Game Setup → Sync between devices**:

- **⬇️ Export data (.json)** downloads a file with your **entire app state** (roster + every
  saved game + settings). **🧾 Copy backup code** puts the same thing on your clipboard as a
  compact code.
- **⬆️ Import data** accepts either an uploaded `.json` file **or** a pasted backup code /
  share link. Your roster can be replaced (you're asked first) and saved games are merged in,
  de-duped so you don't get repeats.

Payloads are **versioned**, so older links keep working; anything unrecognized fails with a
clear message instead of corrupting your data.

## Cloud sync (Azure) — optional

The Share link and Export/Import above are the zero-setup way to move a plan between your own
devices. If you want changes made by one coach to **show up automatically** for other coaches
and on other devices (computer ↔ iPad ↔ head coach), you can deploy the optional cloud sync
backend and connect the app to a shared **team passcode**.

**This is entirely opt-in.** With no team connected the app behaves exactly as before —
everything lives in `localStorage`, works on the sideline with no signal, and never talks to a
server. Cloud sync just adds an online copy that the app pushes to and pulls from when it can.

### How it works

- A tiny **Azure Functions API** (`/api`, Node.js) stores each team's full app state (roster +
  all game days + settings) as one JSON document in **Azure Blob Storage**, guarded by a
  **shared team passcode**. The passcode is **hashed (SHA-256 + salt) server-side** and never
  stored in plaintext or sent back to the browser; the storage keys stay in the Functions app
  settings and are never shipped to the client.
- The frontend is served by **Azure Static Web Apps (Free)** with the Functions wired in as its
  managed API. Concurrency uses a version number + ETag: if two coaches edit at once, the
  second save gets a **conflict prompt** ("keep mine / take theirs") instead of silently losing
  data.
- The same API also backs **short `#s=` game-share links**: `POST /api/share` stores an
  encoded game payload in a separate `shares` blob container keyed by a random code (no
  passcode — access is by the unguessable code only), and `GET /api/share?code=…` returns it.
  This is what lets a shared game travel as a tiny URL instead of a giant one; offline the app
  falls back to the self-contained long link automatically.
- The app **auto-pushes** your changes (debounced) and **auto-pulls** on open and every ~20s
  while online. Offline changes are **queued and flushed on reconnect**.

### Deploy it (on your personal Azure subscription)

The app has kids' names in it, so deploy to a **personal** subscription. You need the
[Azure Developer CLI (`azd`)](https://aka.ms/azd-install) and the
[Static Web Apps CLI](https://aka.ms/swa-cli) — on Windows:
`winget install Microsoft.Azd` and `npm install -g @azure/static-web-apps-cli`.

**Step 1 — provision the infrastructure with azd** (Static Web App Free + Storage + the API's
app settings):

```sh
# Sign in with your PERSONAL account (opens a browser)
azd auth login

# Create an environment and point it at your personal subscription
azd env new lineup-manager
azd env set AZURE_SUBSCRIPTION_ID <your-personal-subscription-id>
azd env set AZURE_LOCATION eastus2

# Provision the Azure resources
azd provision
```

Confirm the selected subscription shows your **personal** account (e.g. "Visual Studio
Enterprise"), **not** a corporate one, before continuing. Cost is **~$0**: Static Web Apps
Free tier + a few KB of blob storage (covered by Visual Studio credits).

**Step 2 — deploy the site + API with the SWA CLI.** The managed Functions need their npm
dependencies bundled, and the upload should contain only the app files (not `.git`/`infra`), so
build the API and deploy from a clean folder:

```sh
# Install the API's production dependencies so they ship with the function
npm --prefix api install --omit=dev

# Stage just the front-end files
mkdir dist && cp index.html staticwebapp.config.json dist/

# Get the deployment token from the Static Web App (Portal → your SWA →
# "Manage deployment token"), then deploy the app + managed API
swa deploy dist --api-location api --deployment-token <token> --env production
```

When it finishes it prints the **Static Web App URL** (e.g.
`https://<name>.azurestaticapps.net`) — that's the synced version of the app.

> Why not just `azd up`? azd provisions everything correctly, but its built-in Static Web Apps
> deploy step doesn't pass `--api-location`, so it would skip the managed Functions. Using the
> SWA CLI for the deploy step (above) is what reliably ships both the site and the API.

### Connect a team

1. Open the deployed Static Web App URL.
2. Go to **Game Setup → Team sync (cloud)**, enter a **Team name/ID** and a **passcode**, and
   tap **Connect**.
3. The **first** device to connect a given team ID **sets** the passcode; everyone else must
   enter the same passcode to join (wrong passcode is rejected). On connect, the app merges the
   server's data with your local roster/games (asking before replacing your roster), reusing
   the same name-based merge as Share/Import.
4. The status pill shows **Synced / Syncing / Offline / Conflict**. Share the team ID + passcode
   with your other devices and the other coach; connect each one the same way.

If you host the plain app on GitHub Pages but deployed the backend to Azure, use the advanced
**Server URL** field to point that copy at your Static Web App origin. (Note: the project's own
GitHub Pages URL is now **deprecated** and redirects to the Azure app — see the canonical URL
note at the top.)

## Feature overview

> **Not sure what a button does?** Tap the small **ⓘ** next to it for a one-line explanation (works by tap on the iPad and by hover on a computer). Tap elsewhere or press Esc to dismiss.

### Roster tab
- Pre-seeded with the 19 players (foot L/R + primary/secondary/tertiary positions).
- Add, edit, or remove players and change their foot and positions at any time.

### Game Setup tab
- Create and name a game day.
- Set **periods (halves)**, **minutes per period**, and the **substitution interval** — the
  live total (e.g. **70 min**) updates as you type, and the sub windows per period are shown.
- **Default: 2 × 35 min = 70 min, quarter-based subs (~18-min windows).** The sub interval
  seeds to half the period length (35 → 18), so each half is split in two — sub windows at the
  quarter mark (~17–18') and at halftime — giving **4 roughly equal playing segments** across
  the game. One-tap **presets** for 70 min (2×35), 60 min (2×30), and 4×12.
- **Substitution interval / rolling subs:** rec soccer allows rolling subs, so instead of only
  subbing at halftime the planner opens a sub window every N minutes *within* each half (the
  default 35-min half at 18 min → windows of 18/17). Lower it for more frequent rotation. This
  is what keeps minutes near-equal and the keeper getting outfield time even with long halves.
- Toggle each player available/unavailable **for that game**.
- **Generate Plan** builds the lineup.
- Saved games list: open, duplicate, or delete prior game days.
- **Sync between devices**: share the current game or roster as a link, or export/import a
  full `.json` backup or code (see the [Sync](#sync-between-devices) section above).

### Plan tab
- Grid of **position (rows) × sub window (columns)**, grouped under each half, showing who
  plays each slot in each window (e.g. `H1 0–10'`, `H1 10–20'`, …).
- Per-player **minutes summary** (total / field / GK / windows / bench) with bars.
- Inline **flags** for compromises:
  - `2` / `3` — playing a secondary/tertiary position
  - `FT` — wrong foot on a flank (LB/LW/RB/RW or left-CB)
  - `GK` — keeper-only or keeping goal more than half the game
  - `↔` — moved position on field **within the same half** without a bench rest
    (a position change across the halftime break is normal and is not flagged)
- **Manual swap**: tap any slot → sub in a bench player or swap two positions, with live
  re-validation. **Regenerate** and **Lock plan** buttons. **Undo** (top bar) reverts the
  last change.
- **Pitch view**: a portrait soccer-pitch diagram showing the 11 slots in their real 4-3-3
  spatial shape (back four, DM deep, two AMs advanced, front three). Pick any sub window with
  the chips; empty/at-risk slots are shown in dashed red. With **"Show next-window changes"**
  on, it previews the coming substitutions right on the pitch — blue arrows for players
  *moving position within the same half*, a red **OFF** badge for players *coming off*, and
  green dashed arrows +
  an **ON … ▸ slot** strip for bench players *coming on* — so you can literally show a kid
  "you're going here next." **Tap any player** to trace their slot across every window.
- **Export text** (copyable) and **Print view** (print-friendly), plus **🔗 Share game link**
  to send the whole game (plan + pitch map) to another device. **Print view** renders **every
  period on its own sheet** — a full slots × sub-windows grid per half with player names and a
  per-period header (game label, half, and window times), followed by a compact minutes-per-
  player summary. It prints **letter landscape**, black-on-white, with all on-screen chrome
  (tabs, buttons, ⓘ icons, the sync panel) hidden; the on-screen app is unaffected.

### Set your starting lineup (pins) 📌
Want a specific starting XI (or a few fixed choices) and let the app build the rest around it?
- **Pin the starting XI:** arrange window 1 how you like (tap slots to sub players in), then
  tap **📌 Pin XI** to lock all 11 window-1 assignments at once.
- **Pin/unpin any single cell:** tap a slot on the Plan grid and use **📌 Pin / Unpin** in the
  slot sheet. Pinned cells show a small 📌 on both the grid and the pitch map. You can pin
  cells in *any* window, not just the first.
- **Generate rest (keep pinned):** builds every *unpinned* cell around your pins, honouring all
  planner rules. Crucially, **pinned minutes count toward fairness** — start a normally-benched
  player and she gets fewer of the remaining windows; start your keeper outfield and the ~50/50
  GK balance is recomputed across the other windows so both keepers still tend goal evenly.
- **Regenerate** still wipes *everything* (it warns first if you have pins) and re-plans from
  scratch. **Lock plan** is separate — it freezes the whole plan; pins are just a partial lock
  that *Generate rest* respects.
- Pins are saved with the game and travel inside **Share links** and **Export** backups.

### Live tab
- Big per-period **countdown timer**: start / pause / reset / next period.
- **Pitch — where everyone is**: the same pitch diagram for the **current** window, with a
  live preview of who moves/comes off/comes on at the **next** sub window.
- Prominent **SUB CARD** listing the upcoming substitutions (who comes OFF ↔ who goes ON,
  with position) for the **next sub window** — not just at halftime. ~60s before each window
  it triggers **sound + vibration + an on-screen alert**, and beeps/vibrates again when the
  window opens.
- **Mark player OUT** (injury / left early) → automatically re-plans the remaining sub
  windows, keeping windows already played.
- Manual swaps allowed anytime; running **field / GK minutes** shown live.

## The auto-planner (deterministic & explainable)

Priority order:

1. **Eligibility (hard):** a player only fills a listed position; primary is preferred over
   secondary over tertiary.
2. **Equal field time:** minimizes the spread of total minutes across *available* players;
   each game stands alone (no carryover). Rolling sub windows are what make this work with
   long halves.
3. **GK relief (whole-half blocks):** with two eligible keepers available it prefers giving
   each keeper **one contiguous half in goal and the other half outfield** — e.g. keeper A
   plays goal all of the first half and takes an eligible field slot in the second, while
   keeper B does the reverse. With equal halves this naturally yields a **~50/50 GK split**
   as clean half-blocks rather than per-window alternation, and guarantees each keeper at
   least one outfield window so nobody is goal-only. This preference is **soft** and ranks
   *below* the guarantee that every available player gets at least one half of playing time —
   it never benches someone to protect a keeper's block. Each keeper's goal time is factored
   into the fairness balance from the first window so keepers aren't over- or under-played.
   **Fallbacks:** if only **one** GK-capable player is available, that keeper covers goal on a
   best-effort split (no ineligible player is ever forced into goal); odd period counts
   generalize to a distinct keeper per period where possible. Pinned GK cells are always
   honored and the half-blocks are built around them.
4. **Footedness (soft):** prefers left-footers on LB/LW/left-CB and right-footers on the
   right.
5. **Position stability (soft):** prefers a player keep the same position while on the
   field, with position changes normally requiring a bench rest — but the planner *may*
   move an on-field player when it clearly improves fairness/coverage, and flags it. Only
   changes **within the same half** are penalized or flagged; moving a staying-on player at
   the halftime break is free (they reset their spot during the stoppage).

**Pinned cells** (see *Set your starting lineup* above) are treated as **hard constraints**:
the optimizer leaves them exactly as-is and solves only the unpinned cells, with the pinned
players' minutes already counted in the fairness and GK balance. If your pins make a perfect
solution impossible, it fills what it can and surfaces the trade-off via the usual flags
rather than failing.

Under the hood each **sub window** is solved as a minimum-cost assignment (Hungarian
algorithm) over eligible players, so the result is deterministic and reproducible. A typical
full-availability **70-minute (2×35) game with the default quarter-based subs (~18-min
windows)** yields near-equal minutes (most players within a narrow band), a **50/50 GK split
with both keepers getting outfield time**, and substitutions that are mostly bench↔field
rather than on-field shuffles.

> **Roster-driven compromises are surfaced, not hidden.** A position only one or two players
> can fill (e.g. an RB-only player) will naturally see tighter or looser minutes because
> leaving the slot empty or playing someone out of position would break eligibility. The plan
> makes such trade-offs visible via the minutes summary and flags.

## Out of scope

No season-long carryover, no other formations or smaller-sided games, and no score/foul/stat
tracking beyond playing minutes. (Multi-device cloud sync is available as the optional,
opt-in [Cloud sync](#cloud-sync-azure--optional) feature above; the app is fully usable
offline without it.)
