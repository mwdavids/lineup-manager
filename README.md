# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. Everything lives in one `index.html` — inline
CSS + vanilla JavaScript, **no build step, no server, no network requests**. All data is
stored locally in your browser via `localStorage`.

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
- Because storage is local: data is **per-device** and is **not** synced or backed up.
  Use **Plan → Export text** to copy a plan out if you want a shareable/backup copy.
- Clearing Safari website data (or "Add to Home Screen" vs. regular Safari being treated
  as separate storage) will reset the app. Keep one launch method for continuity.
- The pre-seeded 19-player roster loads automatically the first time.

## Feature overview

### Roster tab
- Pre-seeded with the 19 players (foot L/R + primary/secondary/tertiary positions).
- Add, edit, or remove players and change their foot and positions at any time.

### Game Setup tab
- Create and name a game day.
- Set **periods (halves)**, **minutes per period**, and the **substitution interval** — the
  live total (e.g. **70 min**) updates as you type, and the sub windows per period are shown.
- **Default: 2 × 35 min = 70 min, sub every 10 min.** One-tap **presets** for 70 min (2×35),
  60 min (2×30), and 4×12.
- **Substitution interval / rolling subs:** rec soccer allows rolling subs, so instead of only
  subbing at halftime the planner opens a sub window every N minutes *within* each half (a
  35-min half at 10 min → windows of 10/10/10/5). This is what keeps minutes near-equal and
  the keeper getting outfield time even with only two long halves.
- Toggle each player available/unavailable **for that game**.
- **Generate Plan** builds the lineup.
- Saved games list: open, duplicate, or delete prior game days.

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
- **Export text** (copyable) and **Print view** (print-friendly).

### Live tab
- Big per-period **countdown timer**: start / pause / reset / next period.
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
full-availability **70-minute (2×35) game with a 10-min sub interval** yields near-equal
minutes (most players within a narrow band), a **50/50 GK split with both keepers getting
outfield time**, and substitutions that are mostly bench↔field rather than on-field shuffles.

> **Roster-driven compromises are surfaced, not hidden.** A position only one or two players
> can fill (e.g. an RB-only player) will naturally see tighter or looser minutes because
> leaving the slot empty or playing someone out of position would break eligibility. The plan
> makes such trade-offs visible via the minutes summary and flags.

## Out of scope

No hosting/cloud/multi-device sync, no season-long carryover, no other formations or
smaller-sided games, and no score/foul/stat tracking beyond playing minutes.
