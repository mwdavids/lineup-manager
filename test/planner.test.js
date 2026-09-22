'use strict';
/*
 * Planner guarantee tests. These load the real, unmodified single-file app
 * (index.html) via jsdom and exercise the shipping planner through its
 * `window.__LM__` test hook — no duplicated logic. They pin the documented
 * guarantees so a future edit to the 200KB file can't silently break fairness.
 *
 * Documented guarantees under test (README "The auto-planner"):
 *  - Eligibility is a hard constraint.
 *  - Every available player gets at least half the game.
 *  - Two keepers each keep goal exactly one half and play their full other half
 *    outfield (~50/50 GK split, ≈ full-game minutes).
 *  - Pinned cells are honored exactly.
 *  - Unavailable players never appear; the plan still fills every slot.
 *  - The Hungarian assignment is deterministic (same input → same plan).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

const SEED = [
  ['Eleanor C.', 'R', ['GK', 'RW', 'DM']], ['Nora D.', 'R', ['RB', 'CM']],
  ['Mackenzie D.', 'R', ['CM', 'CB']], ['Teigan E.', 'R', ['CB', 'RB']],
  ['Finley G.', 'R', ['ST', 'CB']], ['Caroline G.', 'R', ['RW']],
  ['Haley H.', 'R', ['CB']], ['Isla K.', 'L', ['CB', 'LB']], ['Finn', 'R', ['RB']],
  ['Violet M.', 'R', ['DM']], ['Emily M.', 'R', ['CM', 'CB']], ['Penelope T.', 'L', ['LW']],
  ['Ayana B.', 'L', ['LW', 'CM', 'LB']], ['Genevieve E.', 'R', ['RB', 'LB']],
  ['Sophia F.', 'R', ['CM', 'DM']], ['Violet F.', 'R', ['RB', 'LB']],
  ['Isobel M.', 'R', ['ST', 'GK']], ['Ryann M.', 'L', ['LB']], ['Eliza M.', 'R', ['ST', 'RW']],
];

// Load the app once; jsdom keeps timers alive, so close it when the suite ends.
const app = loadApp();
const LM = app.LM;
const SLOT_KEYS = LM.SLOTS.map((s) => s.key);

test.after(() => {
  try { app.dom.window.close(); } catch (e) { /* ignore */ }
});

// Reset to a deterministic seeded roster + one game, returning the game.
function seedGame(opts) {
  opts = opts || {};
  const st = LM.state;
  st.players.length = 0;
  st.games.length = 0;
  SEED.forEach((s, i) => st.players.push({ id: 'p' + i + '_uuid-seed-' + i, name: s[0], foot: s[1], positions: s[2].slice() }));
  const availSet = opts.unavailable || [];
  const availability = {};
  st.players.forEach((p) => { availability[p.id] = availSet.indexOf(p.name) < 0; });
  const game = {
    id: 'g_test', name: 'Test', date: 0, periods: 2,
    minutes: opts.minutes || 35, subs: opts.subs != null ? opts.subs : 3,
    availability, plan: null, pins: {}, locked: false, live: { period: 0 },
  };
  st.games.push(game);
  st.currentGameId = 'g_test';
  return game;
}

function availablePlayers(game) {
  return LM.state.players.filter((p) => game.availability[p.id] !== false);
}
function halfOf(plan, si) {
  const seg = plan.segments[si];
  if (seg && typeof seg.period === 'number') return seg.period;
  return si < plan.segments.length / 2 ? 0 : 1;
}

test('buildSegments: 70-min / 3-sub game → 4 equal-ish windows, two 35-min halves', () => {
  const game = seedGame({ minutes: 35, subs: 3 });
  const plan = LM.generatePlan(game);
  assert.equal(plan.segments.length, 4, 'windows = subs + 1');
  const total = plan.segments.reduce((a, s) => a + s.dur, 0);
  assert.equal(total, 70, 'total minutes = periods * minutes');
  const h0 = plan.segments.filter((s) => s.period === 0).reduce((a, s) => a + s.dur, 0);
  const h1 = plan.segments.filter((s) => s.period === 1).reduce((a, s) => a + s.dur, 0);
  assert.equal(h0, 35);
  assert.equal(h1, 35);
});

test('every slot in every window is filled when the full roster is available', () => {
  const game = seedGame();
  const plan = LM.generatePlan(game);
  for (let si = 0; si < plan.segments.length; si++) {
    for (const key of SLOT_KEYS) {
      assert.ok(plan.segments[si].slots[key], `segment ${si} slot ${key} must be filled`);
    }
  }
});

test('eligibility is a hard constraint: every assignment is a listed position', () => {
  const game = seedGame();
  const plan = LM.generatePlan(game);
  const slotByKey = {};
  LM.SLOTS.forEach((s) => { slotByKey[s.key] = s; });
  plan.segments.forEach((seg, si) => {
    SLOT_KEYS.forEach((key) => {
      const pid = seg.slots[key];
      if (!pid) return;
      const pl = LM.byId(pid);
      assert.ok(pl, `assigned player ${pid} exists`);
      const rank = LM.slotEligRank(pl, slotByKey[key]);
      assert.ok(rank >= 0, `${pl.name} at ${key} (seg ${si}) must list that position (rank=${rank})`);
    });
  });
});

test('total player-minutes conserve: sum equals 11 slots × total minutes', () => {
  const game = seedGame();
  game.plan = LM.generatePlan(game);
  const stat = LM.computeStats(game);
  const sum = Object.keys(stat).reduce((a, id) => a + stat[id].min, 0);
  assert.equal(sum, 11 * 70);
});

test('GK relief: two keepers each keep one full half and play their other half outfield', () => {
  const game = seedGame();
  game.plan = LM.generatePlan(game);
  const stat = LM.computeStats(game);
  const keepers = Object.values(stat).filter((s) => s.gk > 0);
  assert.equal(keepers.length, 2, 'both eligible keepers share goal');
  const halfGame = (game.periods * game.minutes) / 2;
  keepers.forEach((k) => {
    assert.equal(k.gk, halfGame, 'each keeper tends goal exactly one half');
    assert.equal(k.field, halfGame, 'each keeper plays their full off-half outfield');
    assert.equal(k.min, game.periods * game.minutes, 'keepers get ≈ full-game minutes');
  });
  // Each keeper's GK time is confined to a single half, and they cover opposite halves.
  const gkHalves = {};
  game.plan.segments.forEach((seg, si) => {
    const pid = seg.slots.GK;
    (gkHalves[pid] = gkHalves[pid] || new Set()).add(halfOf(game.plan, si));
  });
  const halfSets = Object.values(gkHalves);
  halfSets.forEach((set) => assert.equal(set.size, 1, 'a keeper stays in goal for one contiguous half'));
  const coveredHalves = new Set([].concat(...halfSets.map((s) => [...s])));
  assert.equal(coveredHalves.size, 2, 'the two keepers cover opposite halves');
});

test('half-time floor: every available player gets at least half the game', () => {
  const game = seedGame();
  game.plan = LM.generatePlan(game);
  const stat = LM.computeStats(game);
  const halfGame = (game.periods * game.minutes) / 2;
  availablePlayers(game).forEach((p) => {
    assert.ok(stat[p.id].min >= halfGame, `${p.name} plays ${stat[p.id].min} (< ${halfGame})`);
  });
});

test('everyone available plays: no available player is benched the whole game', () => {
  const game = seedGame();
  game.plan = LM.generatePlan(game);
  const stat = LM.computeStats(game);
  availablePlayers(game).forEach((p) => {
    assert.ok(stat[p.id].stints > 0, `${p.name} should get on the field`);
  });
});

test('pins are honored as hard constraints', () => {
  const game = seedGame();
  const st = LM.state;
  // Pin a specific outfield player into a specific window-0 slot they can play.
  const violetM = st.players.find((p) => p.name === 'Violet M.'); // DM-only
  LM.setPin(game, 0, 'DM', violetM.id);
  assert.equal(LM.countPins(game), 1);
  game.plan = LM.generatePlan(game);
  assert.equal(game.plan.segments[0].slots.DM, violetM.id, 'pinned cell must be left exactly as pinned');
});

test('unavailable players never appear and the plan still fills every slot', () => {
  const out = ['Caroline G.', 'Penelope T.'];
  const game = seedGame({ unavailable: out });
  game.plan = LM.generatePlan(game);
  const outIds = LM.state.players.filter((p) => out.indexOf(p.name) >= 0).map((p) => p.id);
  game.plan.segments.forEach((seg, si) => {
    SLOT_KEYS.forEach((key) => {
      assert.ok(seg.slots[key], `segment ${si} slot ${key} still filled`);
      assert.ok(outIds.indexOf(seg.slots[key]) < 0, 'an unavailable player must never be assigned');
    });
  });
  const stat = LM.computeStats(game);
  outIds.forEach((id) => assert.equal(stat[id], undefined, 'unavailable players are excluded from stats'));
});

test('the plan is deterministic: same input yields the same assignment', () => {
  const a = seedGame();
  const planA = LM.generatePlan(a);
  const b = seedGame();
  const planB = LM.generatePlan(b);
  assert.deepEqual(
    planA.segments.map((s) => s.slots),
    planB.segments.map((s) => s.slots),
    'the Hungarian assignment must be reproducible'
  );
});
