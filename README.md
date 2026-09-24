# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. The entire app is one `index.html` — inline CSS
and vanilla JavaScript, **no build step and no server required**. It's also an installable
**PWA**: a web manifest (`manifest.json`), service worker (`sw.js`), and app icons sit
alongside `index.html` for reliable offline launch and Home Screen install. All data is stored
locally on your device in `localStorage`, with an automatic **IndexedDB** backup.

> **Canonical app URL:** **https://blue-moss-0e0958f0f.5.azurestaticapps.net** (Azure Static
> Web Apps — includes optional [Cloud sync](#cloud-sync-azure--optional)). The old GitHub Pages
> address **https://mwdavids.github.io/lineup-manager/ is deprecated** and now redirects here —
> please update your bookmarks / Home Screen icon. The app still runs fully offline and can be
> self-hosted from a single `index.html`.

The midfield three is a single **Defensive Mid (DM)** at the base with **two Attacking Mids
(AM)** ahead of it, so the eleven slots are:

```
GK · RB · CB · CB · LB · DM · AM · AM · RW · ST · LW
```

Players whose listed positions include **CM are automatically eligible for the AM slots**, so
an existing roster maps cleanly without relabelling anyone.

---

## What it does

- **Roster management** — foot (L/R) plus up to three positions per player, with optional
  **minutes preference**, **avoid-GK**, and **skill rating** flags.
- **Fair, explainable plans** for a 4-3-3 with **rolling substitution windows**, tunable per
  game with **GK fairness** and **stability** preferences.
- **Strength balancing across windows** — an optional skill rating (Developing / Solid /
  Strong) lets the planner spread strong and developing players so no single window is very
  weak, balancing **each line (defense, midfield, attack) independently** — without changing
  anyone's total minutes. It also enforces **rest fairness**, avoiding two benched windows in
  a row wherever possible, and flags any window weaker than usual.
- **In-place repair on last-minute changes** — a "Repair plan" banner appears when a planned
  player goes out (or comes back), and fixes only what's needed instead of reshuffling the
  whole lineup.
- **Manual edits are preserved** — hand-tweaked substitutions are remembered, previewed
  before/after any repair or regenerate, and can be kept when you regenerate the rest.
- **Live sideline timer** — a wall-clock countdown with loud substitution alerts at every sub
  window and a kickoff reminder.
- Works with **no internet, no account, and no other device**.

---

## Requirements

**Device & browser**

- **iPhone / iPad:** iOS/iPadOS 15+ in **Safari** (required for "Add to Home Screen"). The iPad
  is the intended sideline device.
- **Android phone / tablet:** a recent **Chrome** or **Edge** (offers a native **Install**
  prompt).
- **Laptop / desktop:** any modern **Chrome, Edge, or Safari** — runs as a normal tab, no
  install and no build step.

**Internet connectivity**

- **First load only:** you need a connection **once** to open the app from the hosted URL (or
  to copy `index.html` onto the device). After that, the service worker caches the app so it
  **launches and runs with no signal**.
- **Core coaching is fully offline:** rosters, plans, pinning a starting XI, the live timer,
  sub alerts, pitch view, print/export, and offline **long** share links (`#g=…`) all work with
  **zero connectivity** — you can coach an entire game in airplane mode.
- **Only these features need internet, and only while in use:**
  - **Cloud sync** (auto push/pull between coaches and devices) — offline changes are queued
    and flushed automatically on reconnect.
  - **Microsoft account sign-in** and switching teams.
  - Creating or opening a **short share link** (`#s=…`); offline, the app falls back to a
    self-contained long link.
  - Fetching a **new app version** (the "Update available — Reload" banner).
- **No account is required** for offline use, and nothing is uploaded unless you opt into
  [Cloud sync](#cloud-sync-azure--optional).

---

## Quick start

### Open it on an iPad

1. Copy `index.html` onto the iPad (AirDrop, email, iCloud Drive, USB, or a one-time download)
   and open it in **Safari**, or just open the [canonical URL](#).
2. That's it — the app runs entirely in the browser and, after the first open, needs **no
   network** at all. A pre-seeded **19-player roster** loads automatically the first time.

### Install as an app (Add to Home Screen)

Installing gives a full-screen, app-like icon with no browser chrome — best for the sideline.
Once installed, the app is cached for **reliable offline launch** (not just offline *use*), and
you'll see an **"Update available — Reload"** banner when a new version ships.

- **iPhone / iPad (Safari — required):** open the URL in Safari → **Share** → **Add to Home
  Screen** → **Add**. *(Other iOS browsers can't add to the Home Screen.)*
- **Android (Chrome / Edge):** **⋮** menu → **Install app** (or accept the Install banner) →
  **Install**.
- **Laptop / desktop (Chrome / Edge):** click the **Install** icon in the address bar. Safari
  on Mac runs it as a normal tab.

> **Pick one launch method and stick with it.** An installed icon and a plain browser tab are
> **separate storage** — a plan saved in one won't appear in the other. Use
> [Sync between devices](#sync-between-devices) to move data across launch methods or devices.

---

## Offline & data notes

- Roster and game data is saved in this browser and **mirrored to IndexedDB** with a request
  for **persistent storage**. If Safari ever evicts the primary `localStorage` copy, the app
  **automatically recovers from the IndexedDB backup** on next launch.
- Storage is **per-device**. To move a lineup or roster to another device, use
  [Sync between devices](#sync-between-devices) — no account or server required.
- The live timer is **wall-clock based** and holds a **Screen Wake Lock** while running, so it
  stays accurate and keeps the iPad awake — and it **catches up** any missed sub-window alerts
  if the screen slept or you switched apps.
  - *iOS limitation (honest note):* even as a PWA, iOS won't run timers or play alert sounds
    while the app is **fully backgrounded or the device is locked**. The Wake Lock keeps the
    screen on; it is not a native background alarm. Keep the app foregrounded for audible
    alerts.
- Clearing Safari website data resets the app. Keep one launch method for continuity.

---

## Sync between devices

These features move data via **links and files you control** — everything stays fully offline
and nothing is uploaded to a server.

### Share link (plan on computer → open on iPad)

1. On the device with the plan, open the **Plan** tab (or **Game Setup**) and tap **🔗 Share
   game link**. The link is copied to your clipboard.
2. Send it any way you like — **AirDrop, email, Messages, or Notes**.
3. Open the link on the iPad. The app asks **"Load shared game?"**; confirm, and the game (its
   duration/subs, availability, full plan, and pitch map) is added to that device's **Saved
   games** and opened. Nothing you already had is overwritten.

**Short vs. long links.** Online, the app stores the game server-side and gives you a tiny
**`#s=…` short link** (great for Messages, which can truncate long URLs); opening it needs
internet. Offline, it automatically falls back to a long **`#g=…` link** that carries the whole
game in the URL fragment (which browsers never send to a server) and opens with no connection.
Both round-trip the plan, availability, and pins; old `#g=` links keep working forever.

- **Share roster** (Game Setup → **🔗 Share roster**) makes a `#r=…` link that syncs just the
  players (foot + positions), updating matching names and adding new ones.
- Shared games attach to the local roster **by player name**, so importing doesn't create
  duplicates when both devices started from the same roster.

### Export / Import (full backup & fallback)

On **Game Setup → Sync between devices**:

- **⬇️ Export data (.json)** downloads your **entire app state** (roster + every saved game +
  settings). **🧾 Copy backup code** puts the same on your clipboard as a compact code.
- **⬆️ Import data** accepts an uploaded `.json` file **or** a pasted backup code / share link.
  Your roster can be replaced (you're asked first) and saved games are merged in, de-duped.

Payloads are **versioned**, so older links keep working; anything unrecognized fails with a
clear message instead of corrupting your data.

---

## Feature overview

> **Not sure what a button does?** Tap the small **ⓘ** next to it for a one-line explanation
> (tap on the iPad, hover on a computer). Tap elsewhere or press Esc to dismiss.

### Roster tab
- Pre-seeded with **19 players** (foot L/R + primary / secondary / tertiary positions).
- Add, edit, or remove players and change foot, positions, and flags at any time.
- Optional per-player **skill rating** — Developing / Solid / Strong (unset ≈ Solid).

### Game Setup tab
- Create and name a game day.
- Set **match duration** (total minutes) and **number of substitutions** — the live total and
  sub windows per half update as you type. Two halves are always assumed; half length is simply
  the duration split in two.
- **Default: 70 min (2×35), 3 substitutions.** Subs are distributed as **rolling windows**
  (`windows = subs + 1`, halftime counting as one rotation), so a 70-min / 3-sub game becomes
  **4 roughly equal segments** (the earlier half takes any extra window on an uneven split).
  One-tap **presets**: 70 min / 3 subs, 60 min / 3 subs, 50 min / 5 subs.
- **Rolling subs** keep minutes near-equal and give the keeper outfield time even with long
  halves — ask for more subs for more frequent rotation.
- Toggle each player available/unavailable **for that game**.
- **Generate Plan** builds the lineup.
- Saved games list: open, duplicate, or delete prior game days.
- **Sync between devices**: share the current game or roster, or export/import a full backup.

### Plan tab
- Grid of **position (rows) × sub window (columns)**, grouped under each half (e.g. `H1 0–10'`,
  `H1 10–20'`, …).
- Per-player **minutes summary** (total / field / GK / windows / bench) with bars.
- Inline **flags** for compromises:
  - `2` / `3` — playing a secondary / tertiary position
  - `FT` — wrong foot on a flank (LB/LW/RB/RW or left-CB)
  - `GK` — keeper-only, or in goal more than half the game
  - `↔` — moved position on field **within the same half** without a bench rest (a change
    across halftime is normal and not flagged)
- **Manual swap**: tap any slot → sub in a bench player or swap two positions, with live
  re-validation. **Regenerate** and **Lock plan** buttons; **Undo** (top bar) reverts the last
  change.
- **Pitch view**: a portrait pitch diagram showing the 11 slots in their real 4-3-3 shape.
  Pick any window with the chips; empty/at-risk slots show dashed red. With **"Show next-window
  changes"** on, it previews the coming subs on the pitch — blue arrows for players *moving
  within the same half*, a red **OFF** badge for players *coming off*, and green dashed arrows +
  an **ON … ▸ slot** strip for bench players *coming on*. **Tap any player** to trace their
  slot across every window.
- **Export text** (copyable) and **Print view** (letter landscape, black-on-white, all chrome
  hidden). Print renders **every period on its own sheet** — a full slots × windows grid with
  names and a per-period header — followed by a compact minutes-per-player summary.

### Set your starting lineup (pins) 📌
Want a specific starting XI (or a few fixed choices) and let the app build the rest?
- **Pin the starting XI:** arrange window 1 as you like, then tap **📌 Pin XI** to lock all 11
  window-1 assignments at once.
- **Pin/unpin any single cell:** tap a slot → **📌 Pin / Unpin** in the slot sheet. Pinned cells
  show a 📌 on the grid and pitch map, in *any* window.
- **Generate rest (keep pinned):** builds every *unpinned* cell around your pins, honouring all
  rules. **Pinned minutes count toward fairness** — start a normally-benched player and she gets
  fewer remaining windows; start your keeper outfield and the ~50/50 GK balance recomputes.
- **Regenerate** wipes everything (warns first if you have pins); **Lock plan** freezes the
  whole plan. Pins travel inside **Share links** and **Export** backups.

### Live tab
- Big per-period **countdown timer**: start / pause / reset / next period.
- **Pitch — where everyone is**: the pitch diagram for the **current** window, with a live
  preview of who moves / comes off / comes on at the **next** window.
- Prominent **SUB CARD** listing upcoming substitutions (OFF ↔ ON, with position) for the next
  window. ~60s before each window it triggers **sound + vibration + on-screen alert**, and
  beeps/vibrates again when the window opens.
- **Mark player OUT** (injury / left early) → automatically re-plans the remaining windows,
  keeping windows already played.
- Manual swaps allowed anytime; running **field / GK minutes** shown live.

---

## The auto-planner (deterministic & explainable)

Each **sub window** is solved as a minimum-cost assignment (**Hungarian algorithm**) over
eligible players, so the result is deterministic and reproducible. Priority order:

1. **Eligibility (hard):** a player only fills a listed position; primary is preferred over
   secondary over tertiary.
2. **Equal field time:** minimizes the spread of total minutes across *available* players; each
   game stands alone (no carryover). Rolling windows are what make this work with long halves.
3. **GK relief (whole-half blocks):** with two eligible keepers available, each plays **one
   contiguous half in goal and their *entire* other half outfield** — yielding a clean **~50/50
   GK split** and **≈ full-game minutes for both keepers**. The preference is **soft** and ranks
   *below* the hard guarantee that every other available player gets at least one half of play:
   if the roster is tight, the half guarantee wins and the keeper gets as close to a full
   off-half as possible. **Fallbacks:** one keeper covers goal best-effort if only one is
   available (no ineligible player is ever forced into goal); odd period counts generalize to a
   distinct keeper per period where possible. To protect players who list only one contested
   position, the planner **reserves scarce slots for the least-flexible players**.
4. **Footedness (soft):** prefers left-footers on LB/LW/left-CB and right-footers on the right.
5. **Position stability (soft):** prefers a player keep the same position while on the field,
   with changes normally requiring a bench rest — but it *may* move an on-field player when it
   clearly improves fairness/coverage, and flags it. Only changes **within the same half** are
   penalized; moving a staying-on player at halftime is free.

**Pinned cells** are treated as **hard constraints**: the optimizer leaves them as-is and solves
only unpinned cells, with pinned minutes already counted in fairness and GK balance. If pins
make a perfect solution impossible, it fills what it can and surfaces the trade-off via flags
rather than failing.

> **Roster-driven compromises are surfaced, not hidden.** A position only one or two players can
> fill (e.g. an RB-only player) will naturally see tighter or looser minutes; the plan makes such
> trade-offs visible via the minutes summary and flags.

---

## Cloud sync (Azure) — optional

[Share links](#share-link-plan-on-computer--open-on-ipad) and [Export/Import](#export--import-full-backup--fallback)
are the zero-setup way to move a plan between your own devices. If you want changes by one coach
to **show up automatically** for other coaches and devices, you can deploy the optional cloud
sync backend.

**This is entirely opt-in.** With no team connected, the app behaves exactly as before —
everything lives in `localStorage`, works with no signal, and never talks to a server.

### How it works

- A tiny **Azure Functions API** (`/api`, Node.js) stores each team's full app state as one JSON
  document in **Azure Blob Storage**. Access is guarded either by **Microsoft account
  membership** (recommended) or a **shared team passcode** (legacy). Passcodes are **hashed
  (SHA-256 + salt) server-side**, never stored in plaintext or returned to the browser.
- **Accounts** use Static Web Apps' built-in **Microsoft Entra ID** login (free on all plans, no
  app registration). Account teams carry an `ownerId` + `members[]`, a per-user index lives in a
  `users` container, and invite codes in an `invites` container. Endpoints:
  - `GET /api/me` — list your teams
  - `POST /api/teams` — create a team
  - `POST /api/invite` — mint a join link with a **role** (coach or view-only parent)
  - `POST /api/accept` — redeem an invite, assigning that role
  - `GET/PUT /api/team` — read team state / save state; `GET` also returns the member roster to
    the owner
  - `PATCH` / `DELETE /api/members` — change a role, remove a member, or leave
  - `DELETE /api/team` — delete the whole team
  - `POST /api/join` — legacy passcode connect (sets/verifies a team's passcode); legacy data
    sync then authorizes each `/api/team` call via the `x-team-pass` header
  - `GET/POST/DELETE /api/share` — short-link game shares (below)
- **Roles.** Every account team has an **owner** (creator). Invited members are **editors**
  ("coach" — full read/write) or **viewers** ("parent" — read-only). The server enforces it: a
  viewer's `PUT /api/team` is rejected with `403 read_only`. Only the owner can hand out editor
  invites, change roles, remove members, or delete the team; any member can generate a view-only
  link or leave.
- **Concurrency** uses a version number + ETag. If two coaches edit at once, the app does an
  automatic **three-way merge** (keeping the last-synced copy as a common ancestor) instead of
  prompting or overwriting — edits to *different* players, games, or settings all survive, a
  modification beats a deletion, and a genuine same-field clash resolves to the server's value so
  every device converges.
- **Short `#s=` share links** are backed by the same API: `POST /api/share` stores an encoded
  game in a separate `shares` container keyed by a random code (access by the unguessable code
  only), `GET /api/share?code=…` returns it. Shares **expire (~30 days)** and can be **revoked
  early** (`DELETE /api/share?code=…`) if you were signed in when you created one.
- **Abuse hardening.** The low-/no-auth endpoints (`/api/invite`, `/api/accept`, `/api/share`,
  `/api/members`) are **rate-limited per IP** (`api/shared/throttle.js`), and `/api/accept`
  counts failed guesses, so codes can't be brute-forced.
- The app **auto-pushes** changes (debounced) and **auto-pulls** on open, on tab focus, and on an
  **adaptive poll** — ~6s during active editing on a shared team, backing off to ~30s when idle.
  Offline changes are **queued durably and flushed (and merged) on reconnect**.

### Deploy it (on your personal Azure subscription)

The app has kids' names in it, so deploy to a **personal** subscription. You need the
[Azure Developer CLI (`azd`)](https://aka.ms/azd-install) and the
[Static Web Apps CLI](https://aka.ms/swa-cli). On Windows:
`winget install Microsoft.Azd` and `npm install -g @azure/static-web-apps-cli`.

**Step 1 — provision infrastructure with azd** (Static Web App Free + Storage + the API's app
settings, defined under `infra/`):

```sh
azd auth login                                   # sign in with your PERSONAL account
azd env new lineup-manager
azd env set AZURE_SUBSCRIPTION_ID <your-personal-subscription-id>
azd env set AZURE_LOCATION eastus2
azd provision
```

Confirm the subscription shows your **personal** account before continuing. Cost is **~$0**:
Static Web Apps Free tier + a few KB of blob storage.

**Step 2 — deploy the site + API with the SWA CLI.** The managed Functions need their npm deps
bundled, and the upload should contain only app files, so deploy from a clean folder:

```sh
npm --prefix api install --omit=dev            # bundle the API's prod deps
mkdir dist && cp index.html staticwebapp.config.json dist/
swa deploy dist --api-location api --deployment-token <token> --env production
```

Get the `<token>` from the Portal (your SWA → **Manage deployment token**). When it finishes it
prints the **Static Web App URL** — that's the synced version of the app.

> Why not just `azd up`? azd provisions correctly, but its built-in SWA deploy step doesn't pass
> `--api-location`, so it would skip the managed Functions. Using the SWA CLI for the deploy step
> ships both the site and the API.

### Sign in with a Microsoft account (recommended)

Each coach signs in with their own Microsoft account (personal outlook/hotmail/live or
work/school). This uses Static Web Apps' built-in **Microsoft Entra ID** login — free on **all
plans**, **no app registration and no secrets**. From **Game Setup → Team sync (cloud)**:

1. Tap **🔐 Sign in with Microsoft** and complete sign-in.
2. **Create a team** (name it) or pick one from **Your teams** → **Open team**. The first time,
   your local roster/games merge in (you're asked before your roster is replaced).
3. Tap **✉️ Invite coach** to copy an invite link. Under **👥 Manage team & members** choose
   whether it joins as a **coach (can edit)** or **parent (view only)**. Links are valid ~14
   days.
4. **Manage access** (owner only) from the same panel: switch a member between **Coach** and
   **Parent**, or **Remove** them (revoked immediately). Non-owners get **🚪 Leave team**; the
   owner gets **🗑️ Delete team**.
5. The status pill shows **Synced / Syncing / Offline**; everything stays offline-first.

> Account sign-in relies on same-origin auth cookies, so it works only when the app is opened
> **from your Static Web App URL** (not `file://` or a different host).

### Connect a team (legacy passcode)

The shared-passcode flow still works **alongside** accounts — existing passcode teams keep
syncing unchanged, under **"Legacy: connect with a shared team passcode"**.

1. Open the deployed URL → **Game Setup → Team sync (cloud)** → expand the legacy section.
2. Enter a **Team name/ID** and **passcode**, then **Connect**. The **first** device to connect
   a given team ID **sets** the passcode; everyone else must match it.
3. On connect, the server's data merges with your local roster/games (asking before replacing
   your roster). The status pill shows **Synced / Syncing / Offline**.

If you host the plain app elsewhere but deployed the backend to Azure, use the advanced **Server
URL** field to point that copy at your Static Web App origin.

---

## Development

The repo root holds only dev/test tooling; the shipped app is the single `index.html`.

```
index.html                  the entire app (inline CSS + vanilla JS, no build)
sw.js, manifest.json        PWA service worker + web manifest
icon-*.png                  app icons
staticwebapp.config.json    Azure SWA routing / auth roles
azure.yaml                  azd service definition (web = ., host = staticwebapp, api = ./api)
api/                        Azure Functions team-sync API (Node, @azure/storage-blob)
  me/ teams/ invite/ accept/ members/ team/ join/ share/   HTTP-triggered functions
  shared/store.js           blob storage + identity/role helpers
  shared/throttle.js        per-IP rate limiter
infra/                      Bicep (main.bicep, resources.bicep, main.parameters.json)
test/                       Node built-in test runner suites
docs/                       design notes
```

### Tests

Pure JavaScript logic (the planner, local store, and sync/merge) is covered by
[`node --test`](https://nodejs.org/api/test.html) suites in `test/`. `jsdom` is the only dev
dependency; the app modules are loaded via `test/helpers/loadApp.js`.

```sh
npm install        # installs jsdom (dev dependency)
npm test           # runs planner, store, merge, outbox, and sync-merge suites
```

Individual suites: `npm run test:planner`, `test:store`, `test:merge`, `test:outbox`,
`test:sync-merge`. Requires **Node 18+**.

---

## Out of scope

No season-long carryover, no other formations or smaller-sided games, and no score/foul/stat
tracking beyond playing minutes. (Multi-device sync is available as the optional, opt-in
[Cloud sync](#cloud-sync-azure--optional) feature above; the app is fully usable offline
without it.)
