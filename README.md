# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. All the app logic lives in one `index.html` —
inline CSS + vanilla JavaScript, **no build step and no server required**. It's also an
installable **PWA**: a small web manifest, service worker (`sw.js`), and app icons sit
alongside `index.html` for reliable offline launch and Home Screen install. All data is
stored locally on your device (`localStorage`, with an automatic **IndexedDB** backup).

> **Canonical app URL:** **https://blue-moss-0e0958f0f.5.azurestaticapps.net** (Azure Static
> Web Apps — includes optional [cloud sync](#cloud-sync-azure--optional)).
> The old GitHub Pages address **https://mwdavids.github.io/lineup-manager/ is deprecated** and
> now just redirects here — please update your bookmarks / Home Screen icon. The app still runs
> fully offline and can be self-hosted from a single `index.html` as described below.

The midfield three is a single **Defensive Mid (DM)** at the base with **two Attacking Mids
(AM)** ahead of it — so the slots are GK · RB · CB · CB · LB · **DM · AM · AM** · RW · ST · LW.
Players whose listed positions include **CM are automatically eligible for the AM slots**, so
your existing roster maps cleanly without relabelling anyone.

## What it does

- Manages your roster (foot + up to three positions per player, plus optional
  **minutes preference**, **avoid-GK**, and **skill rating** flags).
- Builds a fair, explainable lineup plan for a 4-3-3 with **rolling substitution windows**,
  tunable per game with **GK fairness** and **stability** preferences.
- **Balances lineup strength across sub windows.** Give players an optional skill rating
  (Developing / Solid / Strong) and the planner spreads strong and developing players so no
  single window is very weak — balancing **each line (defense, midfield, attack) on its own**
  so a strong total can't hide a weak back line — without changing anyone's total minutes.
  It also enforces **rest fairness**, keeping players off the bench for two windows in a row
  wherever possible. A per-window strength readout flags any lineup that's weaker than usual.
- **Repairs the plan in place when availability changes last-minute** — a "Repair plan"
  banner appears when someone you'd planned for goes out (or a player comes back in), and
  fixes only what's needed instead of reshuffling the whole lineup.
- **Preserves your manual edits.** Hand-tweaked substitutions are remembered, previewed
  before/after any repair or regenerate, and can be kept when you regenerate the rest.
- Runs a live sideline timer with loud substitution alerts at every sub window, plus a
  reminder to start the clock at kickoff.
- Works with no internet, no account, and no other device.

## Requirements

**Device & browser**

- **iPhone / iPad:** iOS/iPadOS 15 or newer, opened in **Safari** (required for "Add to Home
  Screen"). The iPad is the intended sideline device.
- **Android phone / tablet:** a recent **Chrome** (or Edge), which also offers a native
  **Install** prompt.
- **Laptop / desktop:** any modern **Chrome, Edge, or Safari** — it runs as a normal browser
  tab with no install and no build step.

**Internet connectivity**

- **First load only:** you need a connection **once** to open the app from the hosted URL (or
  to copy `index.html` onto the device). After that first successful load the service worker
  caches the app, so it **launches and runs with no signal** — exactly what you want on a
  sideline with no reception.
- **Core coaching is fully offline:** rosters, plans, pinning a starting XI, the live timer,
  sub alerts, pitch view, print/export, and offline **long** share links (`#g=…`) all work
  with **zero connectivity** — you can coach an entire game in airplane mode.
- **Only these features need internet, and only while you use them:**
  - **Cloud sync** (auto-push/pull between coaches and devices) — offline changes are queued
    and flushed automatically on reconnect.
  - **Microsoft account sign-in** and switching teams.
  - Creating or opening a **short share link** (`#s=…`); offline, the app automatically falls
    back to a self-contained long link.
  - Fetching a **new app version** (the "Update available — Reload" banner).
- **No account is required** for offline use, and nothing is uploaded to a server unless you
  opt into [Cloud sync](#cloud-sync-azure--optional).

## How to open it on an iPad

1. Copy `index.html` onto the iPad (AirDrop, email, iCloud Drive, USB, or a one-time
   download). Open it in **Safari** (double-tap the file, or open the download).
2. That's it — the app runs entirely in the browser. After the first open it needs **no
   network** at all.

### Install on a mobile device (Add to Home Screen)

Installing gives you a full-screen, app-like icon with no browser chrome — best for the
sideline. The app is a **PWA (Progressive Web App)**: once installed it's cached for
**reliable offline launch** (not just offline *use*). When a new version is deployed you'll
see a small **"Update available — Reload"** banner.

**iPhone / iPad (Safari — required):**

1. Open the app's hosted URL (or `index.html`) in **Safari**. *(Other iOS browsers can't add
   to the Home Screen.)*
2. Tap the **Share** button (the square with an up-arrow) → **Add to Home Screen** → **Add**.
3. Launch it from the new **Lineup** icon — it opens full-screen with no Safari chrome.

**Android phone / tablet (Chrome or Edge):**

1. Open the app's hosted URL in **Chrome** (or Edge).
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**), or accept the **Install**
   banner the browser offers automatically, then confirm **Install**.
3. Launch it from the new **Lineup** icon in your app drawer / Home Screen.

**Laptop / desktop (Chrome or Edge):** click the **Install** icon in the address bar (or the
**⋮** menu → **Install Lineup Manager**) for the same standalone window. Safari on Mac runs it
as a normal tab.

> **Pick one launch method and stick with it.** An installed icon and a plain browser tab are
> treated as **separate storage**, so a plan saved in one won't appear in the other. Use
> [Sync between devices](#sync-between-devices) to move data across launch methods or devices.

Once installed, the only time you need a connection is to **first load** the app, to **cloud
sync**, or to pull a **new version** — see [Requirements](#requirements) above. Everything
else runs offline.

### Offline & data notes

- Roster and game data is saved in this browser and, for durability, **mirrored to
  IndexedDB** with a request for **persistent storage**. If Safari ever evicts the primary
  `localStorage` copy (it can, under storage pressure or after long inactivity), the app
  **automatically recovers your data from the IndexedDB backup** on next launch.
- Because storage is local: data is **per-device**. To move a lineup or roster to another
  device (e.g. plan on your computer, coach from your iPad), use **Sync between devices**
  below — no account or server required.
- The live sideline timer is **wall-clock based** and holds a **Screen Wake Lock** while
  running, so it stays accurate and keeps the iPad awake during a game — and it **catches
  up any sub-window alerts** if the screen did sleep or you switched apps.
  - *iOS limitation (honest note):* even as a PWA, iOS won't run timers or play alert
    sounds while the app is **fully backgrounded or the device is locked**. The Wake Lock
    keeps the screen on for sideline use; it is not a native background alarm. Keep the app
    foregrounded during the game for audible alerts.
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
   its duration/substitutions, availability, the full plan, and the pitch map — is added
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
  all game days + settings) as one JSON document in **Azure Blob Storage**. Access is guarded
  one of two ways: by **Microsoft account membership** (accounts, recommended) or by a **shared
  team passcode** (legacy). Passcodes are **hashed (SHA-256 + salt) server-side** and never
  stored in plaintext or sent back to the browser; the storage keys stay in the Functions app
  settings and are never shipped to the client.
- **Accounts** use Static Web Apps' built-in **Microsoft Entra ID** login (free on all plans,
  no registration). The signed-in user arrives at the Functions as the `x-ms-client-principal`
  header; account teams carry an `ownerId` + `members[]`, a per-user index lives in a `users`
  container, and invite codes live in an `invites` container. `GET /api/me` lists your teams,
  `POST /api/teams` creates one, `POST /api/invite` mints a join link (with a **role** — coach
  or view-only parent), and `POST /api/accept` redeems it, assigning that role. The owner
  manages access via `PATCH`/`DELETE /api/members` (change a role, remove a member, or leave)
  and `DELETE /api/team` (delete the whole team); `GET /api/team` returns the member roster to
  the owner. Legacy passcode teams (no `ownerId`) keep working via `/api/join` + the
  `x-team-pass` header — the two models coexist.
- **Roles.** Every account team has an **owner** (its creator). Invited members are either
  **editors** ("coach" — full read/write) or **viewers** ("parent" — read-only). The server
  enforces this: a viewer's `PUT /api/team` is rejected with `403 read_only`, so the role can't
  be bypassed from a hacked client. Only the owner can hand out editor invites, change roles,
  remove members, or delete the team; any member can generate a view-only parent link or leave.
- The frontend is served by **Azure Static Web Apps (Free)** with the Functions wired in as its
  managed API. Concurrency uses a version number + ETag: if two coaches edit at once, the
  second save gets a **conflict prompt** ("keep mine / take theirs") instead of silently losing
  data.
- The same API also backs **short `#s=` game-share links**: `POST /api/share` stores an
  encoded game payload in a separate `shares` blob container keyed by a random code (no
  passcode — access is by the unguessable code only), and `GET /api/share?code=…` returns it.
  Share links **expire automatically** (~30 days), and if you were signed in when you created
  one you can **revoke it early** (`DELETE /api/share?code=…`). This is what lets a shared game
  travel as a tiny URL instead of a giant one; offline the app falls back to the self-contained
  long link automatically.
- **Abuse hardening.** The low-/no-auth endpoints (`/api/invite`, `/api/accept`, `/api/share`,
  `/api/members`) are **rate-limited per IP**, and `/api/accept` also counts failed guesses, so
  invite/share codes can't be brute-forced — the same best-effort limiter that has always
  guarded the legacy passcode path.
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

### Sign in with a Microsoft account (recommended)

Instead of sharing a team passcode, each coach can **sign in with their own Microsoft
account** — any personal account (outlook / hotmail / live) or a work/school account. Teams
and game plans then follow the account across devices, and you invite other coaches by link
rather than by sharing a secret.

This uses **Static Web Apps' built-in Microsoft Entra ID login**, which is available on **all
plans including Free** with **no app registration and no secrets** — there is nothing to
configure in Azure beyond the deploy you already did. (Google/Facebook/email-password would
each require a *custom* provider, which needs the paid Standard plan; that's why this build is
Microsoft-only.)

Use it from **Game Setup → Team sync (cloud)**:

1. Tap **🔐 Sign in with Microsoft** and complete the Microsoft sign-in.
2. **Create a team** (give it a name) or pick one from **Your teams** and tap **Open team**.
   The first time you open a team, your local roster/games merge into it (you're asked before
   your roster is replaced), then it stays in sync.
3. Tap **✉️ Invite coach** to copy an invite link. Under **👥 Manage team & members** you can
   first choose whether the link joins them as a **coach (can edit)** or a **parent (view
   only)**. Send it (AirDrop, Messages, email); when they open it and sign in, they join the
   same team in that role. Invite links are valid for ~14 days and can be used by your whole
   staff.
4. **Manage access** from the same **👥 Manage team & members** panel (owner only): see everyone
   on the team, switch a member between **Coach** and **Parent**, or **Remove** them (access is
   revoked immediately). Non-owners get a **🚪 Leave team** button; the owner gets **🗑️ Delete
   team**, which removes the shared copy for everyone (each device keeps its own local data).
5. The status pill still shows **Synced / Syncing / Offline / Conflict**, and everything remains
   **offline-first** — you only need to be online to sign in or switch teams; the cached team
   keeps working with no signal on the sideline.

> Account sign-in relies on same-origin auth cookies, so it only works when the app is opened
> **from your Static Web App URL** (not `file://` or a different host). The legacy passcode
> mode below still supports the **Server URL** override.

### Connect a team (legacy passcode)

The shared-passcode flow still works and runs **alongside** accounts (hybrid) — existing
passcode teams keep syncing unchanged. It's now tucked under **"Legacy: connect with a shared
team passcode"** in the Team sync panel.

1. Open the deployed Static Web App URL.
2. Go to **Game Setup → Team sync (cloud)**, expand the legacy section, enter a **Team name/ID**
   and a **passcode**, and tap **Connect**.
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
- Set **match duration** (total minutes) and the **number of substitutions** — the live total
  updates as you type, and the sub windows per half are shown. Two halves are always assumed
  (universal for soccer), so the half length is simply the duration split in two.
- **Default: 70 min, 3 substitutions.** The substitutions are distributed across the match as
  **rolling sub windows** (`windows = subs + 1`, with halftime counting as one rotation), so a
  70-min / 3-sub game becomes **4 roughly equal playing segments** — the earlier half takes any
  extra window when the split is uneven. One-tap **presets** for 70 min / 3 subs, 60 min /
  3 subs, and 50 min / 5 subs.
- **Rolling subs:** rec soccer allows rolling subs, so instead of only subbing at halftime the
  planner opens the requested number of sub windows *across* the match. Ask for more
  substitutions for more frequent rotation. This is what keeps minutes near-equal and the
  keeper getting outfield time even with long halves.
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
3. **GK relief (whole-half blocks, full off-half outfield):** with two eligible keepers
   available it gives each keeper **one contiguous half in goal and their *entire* other
   half outfield** — keeper A plays goal all of the first half and takes an eligible field
   slot in **every** window of the second half, while keeper B does the reverse. With equal
   halves this yields a clean **~50/50 GK split** and, by design, **≈ full-game minutes for
   both keepers** (one half in goal + one half on the field). This is intended so neither
   keeper is goal-only and both stay involved. The preference is **soft** and ranks *below*
   the hard guarantee that every other available player gets at least one half of playing
   time: if the roster is tight enough that a keeper's full off-half would push a field
   player below a half, the half guarantee wins and the keeper gets as close to a full
   off-half as possible. Each keeper's goal time is factored into the fairness balance from
   the first window. **Fallbacks:** if only **one** GK-capable player is available, that
   keeper covers goal on a best-effort basis (no ineligible player is ever forced into goal);
   odd period counts generalize to a distinct keeper per period where possible. Pinned GK
   cells are always honored and the half-blocks are built around them. *Note:* to protect
   players who list only one contested position (e.g. an RB-only player when several players
   list RB), the planner **reserves scarce slots for those least-flexible players** and nudges
   more-flexible players toward their other positions, so captive players aren't crowded out
   of the one slot they can play. In an extremely tight roster a captive player can still fall
   short purely from position eligibility, but with the default roster every available player
   reaches at least a half.
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
windows)** yields near-equal minutes for the field players (most within a narrow band), a
**50/50 GK split with each keeper playing one half in goal and their full other half
outfield (≈ full-game minutes for the two keepers)**, and substitutions that are mostly
bench↔field rather than on-field shuffles.

> **Roster-driven compromises are surfaced, not hidden.** A position only one or two players
> can fill (e.g. an RB-only player) will naturally see tighter or looser minutes because
> leaving the slot empty or playing someone out of position would break eligibility. The plan
> makes such trade-offs visible via the minutes summary and flags.

## Out of scope

No season-long carryover, no other formations or smaller-sided games, and no score/foul/stat
tracking beyond playing minutes. (Multi-device cloud sync is available as the optional,
opt-in [Cloud sync](#cloud-sync-azure--optional) feature above; the app is fully usable
offline without it.)
