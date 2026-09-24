'use strict';
/*
 * Phase 4 — entity-aware sync client.
 *
 * Drives the real syncPush / syncPull / syncResolveConflict against an in-memory
 * server that mirrors the split /team + /games + /game endpoints (each with its own
 * optimistic-concurrency version). Proves that:
 *   1. games round-trip as separate entities (team doc carries only gameOrder),
 *   2. two devices editing DIFFERENT games converge, moving only the changed game,
 *   3. two devices editing the SAME game converge deterministically (no data loss
 *      elsewhere) via the per-entity 409 → pull+merge+retry path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

// ---- In-memory server mirroring api/team, api/games, api/game semantics ----
function makeServer() {
  const teams = {}; // teamId -> { version, data }
  const games = {}; // teamId -> { gameId -> { version, game } }
  function ensure(teamId) {
    if (!teams[teamId]) teams[teamId] = { version: 1, data: null };
    if (!games[teamId]) games[teamId] = {};
  }
  function handle(method, urlStr, body) {
    const u = new URL(urlStr, 'https://example.test');
    const p = u.pathname.replace(/^\/api/, '');
    const q = u.searchParams;
    if (p === '/team') {
      const teamId = method === 'GET' ? q.get('teamId') : body.teamId;
      ensure(teamId);
      const t = teams[teamId];
      if (method === 'GET') {
        return { status: 200, data: { data: t.data, version: t.version, name: teamId, role: 'owner', ownerId: 'u1', members: [{ uid: 'u1', role: 'owner' }] } };
      }
      if (method === 'PUT') {
        const base = Number(body.baseVersion);
        if (t.version !== base) return { status: 409, data: { error: 'conflict', data: t.data, version: t.version } };
        let data = body.data;
        if (data && Array.isArray(data.games)) {
          // mirror the server safety net: split embedded games, strip them
          data = Object.assign({}, data);
          const order = [];
          (body.data.games || []).forEach((g) => { if (g && g.id) { order.push(g.id); if (!games[teamId][g.id]) games[teamId][g.id] = { version: 1, game: g }; } });
          data.gameOrder = order;
          delete data.games;
        }
        t.data = data; t.version += 1;
        return { status: 200, data: { version: t.version } };
      }
    }
    if (p === '/games') {
      const teamId = q.get('teamId'); ensure(teamId);
      const list = Object.keys(games[teamId]).map((gid) => ({ gameId: gid, version: games[teamId][gid].version }));
      return { status: 200, data: { games: list } };
    }
    if (p === '/game') {
      const teamId = method === 'GET' ? q.get('teamId') : body.teamId;
      const gameId = method === 'GET' ? q.get('gameId') : body.gameId;
      ensure(teamId);
      const rec = games[teamId][gameId];
      if (method === 'GET') {
        if (!rec) return { status: 404, data: { error: 'no_such_game' } };
        return { status: 200, data: { gameId, version: rec.version, game: rec.game } };
      }
      if (method === 'DELETE') { delete games[teamId][gameId]; return { status: 200, data: { deleted: true } }; }
      if (method === 'PUT') {
        const base = Number(body.baseVersion);
        const cur = rec ? rec.version : 0;
        if (base !== cur) return { status: 409, data: { error: 'conflict', gameId, version: cur, game: rec ? rec.game : null } };
        const next = cur + 1;
        games[teamId][gameId] = { version: next, game: body.game };
        return { status: 200, data: { gameId, version: next } };
      }
    }
    return { status: 404, data: { error: 'not_found' } };
  }
  return { teams, games, handle };
}

// Install the mock as window.fetch for an app instance.
function wireFetch(win, server) {
  win.fetch = async (url, opts) => {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    const { status, data } = server.handle(method, String(url), body);
    return { status, ok: status >= 200 && status < 300, json: async () => data };
  };
}

// Bring an app instance to a "connected account team, empty" baseline.
function connectEmpty(LM, teamId) {
  const S = LM.Sync;
  S.mode = 'account'; S.teamId = teamId; S.teamName = teamId;
  S.connected = true; S.readOnly = false; S.dirty = false; S.busy = false;
  S.baseVersion = 1; S.baseDoc = { players: [], games: [], currentGameId: null }; S.gameVers = {};
}

const tick = () => new Promise((r) => setTimeout(r, 0));
// jsdom fires the app's deferred boot (DOMContentLoaded → initSync) a tick AFTER
// loadApp() returns. For account mode, initSync sets Sync.connected=false ("not
// connected until the team is reopened"), so if we seed a connected state before
// boot runs, boot clobbers it during the first `await` and the push silently
// no-ops. Let boot settle first, then seed the connection.
async function settleBoot(win) {
  for (let i = 0; i < 20 && win.document.readyState !== 'complete'; i++) await tick();
  await tick();
}
async function connectedApp(server, teamId) {
  const app = loadApp();
  wireFetch(app.window, server);
  await settleBoot(app.window);
  connectEmpty(app.LM, teamId);
  return app;
}

function gamesById(doc) {
  const m = {};
  (doc.games || []).forEach((g) => { m[g.id] = g; });
  return m;
}

// Valid-enough entities for the app's renderers (avoids throwing in renderAll).
function mkPlayer(id, name) { return { id, name, foot: 'R', positions: [] }; }
function mkGame(id, extra) {
  return Object.assign({ id, name: id, date: 0, periods: 2, minutes: 35, subs: {}, availability: {}, plan: null, pins: {}, locked: false, live: { period: 0 } }, extra || {});
}

test('push splits games into their own entities; a second device pulls them', async () => {
  const server = makeServer();
  const A = await connectedApp(server, 't1');
  A.LM.syncApply({
    players: [mkPlayer('p1', 'Ana'), mkPlayer('p2', 'Bea')],
    games: [mkGame('g_1', { foo: 1 }), mkGame('g_2', { foo: 2 })],
    currentGameId: 'g_2',
  });
  A.LM.Sync.dirty = true;
  await A.LM.syncPush();

  // Team doc holds only an ordered index; games live in their own store.
  assert.equal(server.teams['t1'].data.games, undefined, 'games stripped from team doc');
  assert.deepEqual(server.teams['t1'].data.gameOrder, ['g_1', 'g_2'], 'gameOrder preserved');
  assert.ok(server.games['t1'].g_1 && server.games['t1'].g_2, 'both games stored as entities');
  assert.equal(server.games['t1'].g_1.game.foo, 1);
  assert.equal(A.LM.Sync.dirty, false, 'push clears dirty');
  // JSON round-trip: Sync.gameVers is a jsdom-realm object, so a strict deepEqual
  // against a Node-realm literal fails on prototype identity even when equal.
  assert.deepEqual(JSON.parse(JSON.stringify(A.LM.Sync.gameVers)), { g_1: 1, g_2: 1 }, 'per-game versions tracked');

  // A fresh device assembles the full doc from the split entities.
  const B = await connectedApp(server, 't1');
  await B.LM.syncPull();
  const bDoc = B.LM.syncData();
  const bg = gamesById(bDoc);
  assert.equal(bDoc.games.length, 2, 'both games pulled');
  assert.equal(bg.g_1.foo, 1);
  assert.equal(bg.g_2.foo, 2);
  assert.equal(bDoc.players.length, 2, 'players pulled');
});

test('two devices editing different games converge, moving only the changed game', async () => {
  const server = makeServer();
  const A = await connectedApp(server, 't2');
  A.LM.syncApply({
    players: [mkPlayer('p1', 'Ana')],
    games: [mkGame('g_1', { foo: 1 }), mkGame('g_2', { foo: 2 })],
    currentGameId: 'g_1',
  });
  A.LM.Sync.dirty = true; await A.LM.syncPush();

  // B starts from the same server state.
  const B = await connectedApp(server, 't2');
  await B.LM.syncPull();

  // A edits g_1; B edits g_2 — disjoint.
  const aDoc = A.LM.syncData(); gamesById(aDoc).g_1.foo = 10;
  A.LM.syncApply(aDoc); A.LM.Sync.dirty = true; await A.LM.syncPush();
  assert.equal(server.games['t2'].g_1.version, 2, 'only g_1 bumped by A');
  assert.equal(server.games['t2'].g_2.version, 1, 'g_2 untouched by A');

  const bDoc = B.LM.syncData(); gamesById(bDoc).g_2.foo = 20;
  B.LM.syncApply(bDoc); B.LM.Sync.dirty = true; await B.LM.syncPush();
  assert.equal(server.games['t2'].g_2.version, 2, 'g_2 bumped by B without conflict');
  assert.equal(server.games['t2'].g_1.version, 2, 'B did not re-push unchanged g_1');

  // Both pull the other's change and converge.
  await A.LM.syncPull();
  await B.LM.syncPull();
  const af = gamesById(A.LM.syncData());
  const bf = gamesById(B.LM.syncData());
  assert.equal(af.g_1.foo, 10); assert.equal(af.g_2.foo, 20);
  assert.equal(bf.g_1.foo, 10); assert.equal(bf.g_2.foo, 20);
});

test('same-game clash resolves via per-entity 409 → pull+merge+retry', async () => {
  const server = makeServer();
  const A = await connectedApp(server, 't3');
  A.LM.syncApply({
    players: [mkPlayer('p1', 'Ana')],
    games: [mkGame('g_1', { score: 0 })],
    currentGameId: 'g_1',
  });
  A.LM.Sync.dirty = true; await A.LM.syncPush();

  const B = await connectedApp(server, 't3');
  await B.LM.syncPull();

  // Both edit the SAME game's SAME field from the same base.
  const aDoc = A.LM.syncData(); gamesById(aDoc).g_1.score = 5;
  A.LM.syncApply(aDoc); A.LM.Sync.dirty = true; await A.LM.syncPush(); // wins the race → g_1 v2

  const bDoc = B.LM.syncData(); gamesById(bDoc).g_1.score = 9;
  B.LM.syncApply(bDoc); B.LM.Sync.dirty = true; await B.LM.syncPush(); // 409 → merge (server wins) → retry

  assert.equal(B.LM.Sync.dirty, false, 'B settles after the merge+retry');
  // Deterministic convergence: server value wins the same-field clash on both sides.
  await A.LM.syncPull();
  const aScore = gamesById(A.LM.syncData()).g_1.score;
  const bScore = gamesById(B.LM.syncData()).g_1.score;
  assert.equal(aScore, bScore, 'A and B agree on g_1.score');
  assert.equal(server.games['t3'].g_1.game.score, aScore, 'server matches both devices');
});
