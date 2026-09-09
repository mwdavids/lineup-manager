# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. Everything lives in one `index.html` — inline
CSS + vanilla JavaScript, **no build step, no server, no network requests**. All data is
stored locally in your browser via `localStorage`.

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

The entire game is encoded in the part of the URL **after the `#`**, which browsers never send
to a server, so your data stays private and it works offline.

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

## Feature overview

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
  - `↔` — moved position on field without a bench rest
- **Manual swap**: tap any slot → sub in a bench player or swap two positions, with live
  re-validation. **Regenerate** and **Lock plan** buttons. **Undo** (top bar) reverts the
  last change.
- **Pitch view**: a portrait soccer-pitch diagram showing the 11 slots in their real 4-3-3
  spatial shape (back four, DM deep, two AMs advanced, front three). Pick any sub window with
  the chips; empty/at-risk slots are shown in dashed red. With **"Show next-window changes"**
  on, it previews the coming substitutions right on the pitch — blue arrows for players
  *moving position*, a red **OFF** badge for players *coming off*, and green dashed arrows +
  an **ON … ▸ slot** strip for bench players *coming on* — so you can literally show a kid
  "you're going here next." **Tap any player** to trace their slot across every window.
- **Export text** (copyable) and **Print view** (print-friendly), plus **🔗 Share game link**
  to send the whole game (plan + pitch map) to another device.

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
3. **GK relief:** with a second keeper available it aims for a ~50/50 GK split and guarantees
   each keeper at least one outfield window so nobody is goal-only. Each keeper's full-game
   goal time is factored into the fairness balance from the first window, so keepers don't end
   up over- or under-played.
4. **Footedness (soft):** prefers left-footers on LB/LW/left-CB and right-footers on the
   right.
5. **Position stability (soft):** prefers a player keep the same position while on the
   field, with position changes normally requiring a bench rest — but the planner *may*
   move an on-field player when it clearly improves fairness/coverage, and flags it.

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

No hosting/cloud/multi-device sync, no season-long carryover, no other formations or
smaller-sided games, and no score/foul/stat tracking beyond playing minutes.
