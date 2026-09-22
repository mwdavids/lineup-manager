'use strict';
/*
 * Three-way merge tests (issue #11).
 *
 * The team document is synced as one blob. mergeTeamDocs() merges concurrent edits
 * against a common ancestor so two coaches editing different things don't collide,
 * and genuine same-field clashes resolve deterministically to the server ("theirs")
 * copy so every device converges.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

const app = loadApp();
const LM = app.LM;
const { merge3, mergeById, mergeTeamDocs } = LM;

// The app clones via its own (jsdom) realm, so objects it returns carry that
// realm's prototypes. Normalize through a test-realm JSON round-trip before
// deepEqual so cross-realm prototype identity doesn't cause false failures.
const norm = (v) => JSON.parse(JSON.stringify(v));

test.after(() => {
  try { app.dom.window.close(); } catch (e) { /* ignore */ }
});

function doc(players, games, currentGameId) {
  return { players: players || [], games: games || [], currentGameId: currentGameId || null };
}

test('merge3: only one side changed a scalar → that side wins', () => {
  assert.equal(merge3('a', 'b', 'a'), 'b'); // mine changed
  assert.equal(merge3('a', 'a', 'c'), 'c'); // theirs changed
  assert.equal(merge3('a', 'a', 'a'), 'a'); // nobody changed
});

test('merge3: both changed a scalar to different values → theirs (server) wins', () => {
  assert.equal(merge3('a', 'mine', 'theirs'), 'theirs');
});

test('merge3: object keys merge independently (no false conflict)', () => {
  const base = { x: 1, y: 1 };
  const mine = { x: 2, y: 1 };   // I changed x
  const theirs = { x: 1, y: 9 }; // they changed y
  assert.deepEqual(norm(merge3(base, mine, theirs)), { x: 2, y: 9 });
});

test('merge3: a key deleted on one side and untouched on the other is removed', () => {
  const base = { a: 1, b: 2 };
  const mine = { a: 1 };          // I deleted b
  const theirs = { a: 1, b: 2 };  // they left it
  assert.deepEqual(norm(merge3(base, mine, theirs)), { a: 1 });
});

test('merge3: a modification beats a deletion (no data loss)', () => {
  const base = { a: 1, b: 2 };
  const mine = { a: 1 };            // I deleted b
  const theirs = { a: 1, b: 5 };   // they changed b
  assert.deepEqual(norm(merge3(base, mine, theirs)), { a: 1, b: 5 });
});

test('mergeById: edits to different players both survive', () => {
  const base = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea' }];
  const mine = [{ id: 'p1', name: 'Ana R.' }, { id: 'p2', name: 'Bea' }];   // renamed p1
  const theirs = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea K.' }]; // renamed p2
  const out = mergeById(base, mine, theirs);
  const byId = Object.fromEntries(out.map((p) => [p.id, p.name]));
  assert.equal(byId.p1, 'Ana R.');
  assert.equal(byId.p2, 'Bea K.');
});

test('mergeById: additions from both sides are kept', () => {
  const base = [{ id: 'p1', name: 'Ana' }];
  const mine = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Mine' }];
  const theirs = [{ id: 'p1', name: 'Ana' }, { id: 'p3', name: 'Theirs' }];
  const out = mergeById(base, mine, theirs);
  const ids = norm(out.map((p) => p.id)).sort();
  assert.deepEqual(ids, ['p1', 'p2', 'p3']);
});

test('mergeById: delete on one side, untouched on the other → removed', () => {
  const base = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea' }];
  const mine = [{ id: 'p1', name: 'Ana' }];             // I removed p2
  const theirs = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea' }];
  const out = mergeById(base, mine, theirs);
  assert.deepEqual(norm(out.map((p) => p.id)), ['p1']);
});

test('mergeById: delete vs modify → the modified entity is kept', () => {
  const base = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea' }];
  const mine = [{ id: 'p1', name: 'Ana' }];                       // I removed p2
  const theirs = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea K.' }]; // they edited p2
  const out = mergeById(base, mine, theirs);
  const p2 = out.find((p) => p.id === 'p2');
  assert.ok(p2, 'edited player is not lost to the other side deleting it');
  assert.equal(p2.name, 'Bea K.');
});

test('mergeTeamDocs: disjoint edits (roster vs a game) merge with no conflict', () => {
  const base = doc(
    [{ id: 'p1', name: 'Ana' }],
    [{ id: 'g1', name: 'Game 1', availability: { p1: true } }],
    'g1'
  );
  // Device A adds a player.
  const mine = doc(
    [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Cara' }],
    [{ id: 'g1', name: 'Game 1', availability: { p1: true } }],
    'g1'
  );
  // Device B marks p1 unavailable for the game.
  const theirs = doc(
    [{ id: 'p1', name: 'Ana' }],
    [{ id: 'g1', name: 'Game 1', availability: { p1: false } }],
    'g1'
  );
  const out = mergeTeamDocs(base, mine, theirs);
  assert.deepEqual(norm(out.players.map((p) => p.id)).sort(), ['p1', 'p2'], 'new player kept');
  assert.equal(out.games[0].availability.p1, false, "other coach's availability edit kept");
});

test('mergeTeamDocs converges: two devices merging the same versions agree', () => {
  const base = doc([{ id: 'p1', name: 'Ana', skill: 3 }], [], null);
  const a = doc([{ id: 'p1', name: 'Ana', skill: 5 }], [], null); // A set skill 5
  const b = doc([{ id: 'p1', name: 'Ana', skill: 7 }], [], null); // B set skill 7 (clash)
  // A pushes first → server holds A. B merges its edits against A.
  const onB = mergeTeamDocs(base, b, a);
  // A later pulls B's merged push and merges against it.
  const onA = mergeTeamDocs(a, a, onB);
  assert.deepEqual(norm(onA.players), norm(onB.players), 'both devices reach the same roster');
  assert.equal(onB.players[0].skill, 5, 'server value wins the clash deterministically');
});

test('mergeTeamDocs: currentGameId is repaired to a surviving game', () => {
  const base = doc([], [{ id: 'g1', name: 'One' }], 'g1');
  const mine = doc([], [], 'g1');           // I deleted the only game
  const theirs = doc([], [{ id: 'g1', name: 'One' }], 'g1');
  const out = mergeTeamDocs(base, mine, theirs);
  // g1 was deleted by me and untouched by them → gone; currentGameId must not dangle.
  assert.equal(out.games.length, 0);
  assert.equal(out.currentGameId, null);
});
