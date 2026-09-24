'use strict';
/*
 * Stable-id backfill tests (User -> Team -> Game rewrite, Phase 2).
 *
 * uid() mints strong UUID-based ids; migrateIds() upgrades any legacy weak ids
 * (the old 7-char Math.random slug) in place. The design's key risk is that ids
 * are referenced indirectly all over game state (availability / plan.slots /
 * pins / edits / currentGameId), so the backfill must rewrite every one of those
 * maps atomically. These tests drive the real shipping functions through the
 * window.__LM__ hook.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

const app = loadApp();
const LM = app.LM;

test.after(() => {
  try { app.dom.window.close(); } catch (e) { /* ignore */ }
});

test('uid() mints strong, unique ids with the requested prefix', () => {
  const a = LM.uid('p');
  const b = LM.uid('p');
  assert.ok(a.startsWith('p_'), 'carries the prefix');
  assert.notEqual(a, b, 'ids are unique');
  assert.ok(LM.isStrongId(a), 'minted id is strong');
});

test('isStrongId: legacy 7-char slugs are weak, UUID-based ids are strong', () => {
  assert.equal(LM.isStrongId('ab12cd3'), false, 'legacy slug has no - or _');
  assert.equal(LM.isStrongId('p_1a2b'), true);
  assert.equal(LM.isStrongId('g_9f8e7d6c-1111-2222-3333-444455556666'), true);
});

test('migrateIds backfills weak ids across every game reference map', () => {
  const st = LM.state;
  st.players.length = 0;
  st.games.length = 0;

  // Legacy weak ids (no '-' or '_') for two players.
  st.players.push({ id: 'aaa1111', name: 'Ana', foot: 'R', positions: ['CB'] });
  st.players.push({ id: 'bbb2222', name: 'Bea', foot: 'L', positions: ['ST'] });

  const game = {
    id: 'ggg3333',
    name: 'vs Rivals',
    availability: { aaa1111: true, bbb2222: false },
    plan: { segments: [{ period: 1, dur: 20, slots: { CB: 'aaa1111', ST: 'bbb2222' } }] },
    pins: { '0|CB': 'aaa1111' },
    edits: { '0|ST': 'bbb2222' },
  };
  st.games.push(game);
  st.currentGameId = 'ggg3333';

  const changed = LM.migrateIds();
  assert.equal(changed, 3, 'two players + one game upgraded');

  const p0 = st.players[0].id;
  const p1 = st.players[1].id;
  const g0 = st.games[0].id;
  assert.ok(LM.isStrongId(p0) && LM.isStrongId(p1) && LM.isStrongId(g0), 'all ids now strong');

  // currentGameId follows the game.
  assert.equal(st.currentGameId, g0, 'currentGameId remapped');

  const G = st.games[0];
  // availability keys remapped, values preserved. (Compare primitives, not the
  // cross-realm jsdom object, which deepStrictEqual rejects by prototype identity.)
  assert.equal(Object.keys(G.availability).length, 2);
  assert.equal(G.availability[p0], true);
  assert.equal(G.availability[p1], false);
  // plan slots point at the new player ids.
  assert.equal(G.plan.segments[0].slots.CB, p0);
  assert.equal(G.plan.segments[0].slots.ST, p1);
  // pins/edits values remapped, keys (slot coordinates) unchanged.
  assert.equal(G.pins['0|CB'], p0);
  assert.equal(G.edits['0|ST'], p1);

  // No stale legacy ids linger anywhere.
  const blob = JSON.stringify(st);
  ['aaa1111', 'bbb2222', 'ggg3333'].forEach((weak) => {
    assert.ok(!blob.includes(weak), 'no lingering legacy id ' + weak);
  });
});

test('migrateIds is idempotent and a no-op once all ids are strong', () => {
  const st = LM.state;
  st.players.length = 0;
  st.games.length = 0;
  st.players.push({ id: LM.uid('p'), name: 'Cy', foot: 'R', positions: ['GK'] });
  st.games.push({ id: LM.uid('g'), name: 'friendly', availability: {}, plan: null, pins: {}, edits: {} });
  const snapshot = JSON.stringify(st);
  const changed = LM.migrateIds();
  assert.equal(changed, 0, 'nothing to upgrade');
  assert.equal(JSON.stringify(st), snapshot, 'state untouched');
});
