# Lineup Manager — U13 Girls 11v11 (4-3-3)

A single-file, **fully offline** web app for coaching a U13 girls 11v11 soccer team in a
fixed **4-3-3** from an iPad on the sideline. Everything lives in one `index.html` — inline
CSS + vanilla JavaScript, **no build step, no server, no network requests**. All data is
stored locally in your browser via `localStorage`.

## What it does

- Manages your roster (foot + up to three positions per player).
- Builds a fair, explainable per-period lineup plan for a 4-3-3.
- Runs a live sideline timer with loud substitution alerts.
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
- Set **periods** and **minutes per period** (default **4 × 12**).
- Toggle each player available/unavailable **for that game**.
- **Generate Plan** builds the lineup.
- Saved games list: open, duplicate, or delete prior game days.

### Plan tab
- Grid of **position (rows) × period (columns)** showing who plays each slot.
- Per-player **minutes summary** (total / field / GK / periods / bench) with bars.
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
- Prominent **SUB CARD** listing upcoming substitutions (who comes OFF ↔ who goes ON, with
  position). ~60s before period end it triggers **sound + vibration + an on-screen alert**.
- **Mark player OUT** (injury / left early) → automatically re-plans the remaining periods,
  keeping periods already played.
- Manual swaps allowed anytime; running **field / GK minutes** shown live.

## The auto-planner (deterministic & explainable)

Priority order:

1. **Eligibility (hard):** a player only fills a listed position; primary is preferred over
   secondary over tertiary.
2. **Equal field time:** minimizes the spread of total minutes across *available* players;
   each game stands alone (no carryover).
3. **GK relief:** with a second keeper available it aims for a ~50/50 GK split and gives
   keepers outfield time so nobody is goal-only.
4. **Footedness (soft):** prefers left-footers on LB/LW/left-CB and right-footers on the
   right.
5. **Position stability (soft):** prefers a player keep the same position while on the
   field, with position changes normally requiring a bench rest — but the planner *may*
   move an on-field player when it clearly improves fairness/coverage, and flags it.

Under the hood each period is solved as a minimum-cost assignment (Hungarian algorithm)
over eligible players, so the result is deterministic and reproducible.

> **Roster-driven compromises are surfaced, not hidden.** For example, if only one player
> lists **DM**, she will anchor every period (and her minutes will run high) because leaving
> the slot empty or playing someone out of position would break eligibility. The plan makes
> such trade-offs visible via the minutes summary and flags.

## Out of scope

No hosting/cloud/multi-device sync, no season-long carryover, no other formations or
smaller-sided games, and no score/foul/stat tracking beyond playing minutes.
