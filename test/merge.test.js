'use strict';
/*
 * Cross-device roster-merge identity tests (issue #9, Workstream B).
 *
 * uid()/migrateIds already give every entity a strong UUID. The remaining gap
 * was that share/import roster merge matched purely by name, so a player who
 * was renamed on one device duplicated when the roster was re-shared. These
 * tests pin the fix: merge keys by UUID first, falling back to name only for
 * legacy/independent rosters. They drive the real shipping importer through the
 * `window.__LM__` hook — no duplicated logic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

const app = loadApp();
const LM = app.LM;

test.after(() => {
  try { app.dom.window.close(); } catch (e) { /* ignore */ }
});

function resetRoster(players) {
  const st = LM.state;
  st.players.length = 0;
  st.games.length = 0;
  st.currentGameId = null;
  (players || []).forEach((p) => st.players.push(JSON.parse(JSON.stringify(p))));
}

const UUID_A = 'p_11111111-1111-4111-8111-111111111111';
const UUID_B = 'p_22222222-2222-4222-8222-222222222222';

test('findPlayerMatch prefers a strong-UUID match over name', () => {
  resetRoster([
    { id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] },
    { id: UUID_B, name: 'Sam', foot: 'L', positions: ['LW'] },
  ]);
  // Same UUID as A but a renamed label — must still resolve to the A record.
  const match = LM.findPlayerMatch({ id: UUID_A, name: 'Alexandra', foot: 'R', positions: ['CB'] });
  assert.ok(match, 'expected a match');
  assert.equal(match.id, UUID_A);
  assert.equal(match.name, 'Alex');
});

test('findPlayerMatch falls back to name when the id is weak/legacy', () => {
  resetRoster([{ id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] }]);
  // Legacy weak id (no dash/underscore) must not be trusted for id-matching; name wins.
  const match = LM.findPlayerMatch({ id: 'abc1234', name: 'Alex' });
  assert.ok(match);
  assert.equal(match.id, UUID_A);
});

test('findPlayerMatch returns null when nothing matches', () => {
  resetRoster([{ id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] }]);
  assert.equal(LM.findPlayerMatch({ id: UUID_B, name: 'Jordan' }), null);
});

test('re-importing a renamed roster updates in place (no duplicate) via UUID', () => {
  // Device B has the player, but the coach renamed her locally.
  resetRoster([{ id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] }]);
  // Device A re-shares the same UUID with the original name + new position.
  const payload = { players: [{ id: UUID_A, name: 'Alexandra', foot: 'R', positions: ['CB', 'RB'] }] };
  const ok = LM.importSharedRoster(payload, { silent: true });
  assert.equal(ok, true);
  assert.equal(LM.state.players.length, 1, 'should update in place, not duplicate');
  const p = LM.state.players[0];
  assert.equal(p.id, UUID_A);
  assert.deepEqual(p.positions, ['CB', 'RB'], 'attributes updated from shared player');
  // Local rename is preserved because we key by id, not name.
  assert.equal(p.name, 'Alexandra');
});

test('importSharedRoster adds a genuinely new player (keeps its UUID)', () => {
  resetRoster([{ id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] }]);
  const ok = LM.importSharedRoster({ players: [{ id: UUID_B, name: 'Sam', foot: 'L', positions: ['LW'] }] }, { silent: true });
  assert.equal(ok, true);
  assert.equal(LM.state.players.length, 2);
  assert.ok(LM.byId(UUID_B), 'new player keeps its shared UUID');
});

test('reconcilePlayers maps shared ids to local ids by UUID then name', () => {
  resetRoster([
    { id: UUID_A, name: 'Alex', foot: 'R', positions: ['CB'] },
    { id: 'p_local-bynameonly', name: 'Sam', foot: 'L', positions: ['LW'] },
  ]);
  const map = LM.reconcilePlayers([
    { id: UUID_A, name: 'Renamed', foot: 'R', positions: ['CB'] }, // UUID match
    { id: 'p_shared-sam-uuid', name: 'Sam', foot: 'L', positions: ['LW'] }, // name fallback
    { id: UUID_B, name: 'NewKid', foot: 'R', positions: ['ST'] }, // brand new
  ]);
  assert.equal(map[UUID_A], UUID_A, 'UUID match');
  assert.equal(map['p_shared-sam-uuid'], 'p_local-bynameonly', 'name fallback maps to existing local id');
  assert.equal(map[UUID_B], UUID_B, 'new player added, keeps id');
  assert.equal(LM.state.players.length, 3, 'exactly one player added');
});
