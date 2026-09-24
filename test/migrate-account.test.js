'use strict';
/*
 * Phase 5 — first-login local → account migration.
 *
 * A signed-in owner who has local roster/games but no cloud team yet is offered a
 * one-time migration that creates their own account team seeded from this device's
 * data (games split into per-game entities by the normal push) and retires any
 * legacy passcode config. Guards: never migrate when they already have cloud teams,
 * when there's nothing local to save, or when it's already been offered once.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/loadApp');

// In-memory server mirroring api/teams, api/me, api/team, api/games, api/game.
function makeServer() {
  const teams = {};   // teamId -> { version, data, name }
  const games = {};   // teamId -> { gameId -> { version, game } }
  const myTeams = []; // [{ id, name, role }]
  let seq = 0;
  function ensure(teamId) {
    if (!teams[teamId]) teams[teamId] = { version: 1, data: null, name: teamId };
    if (!games[teamId]) games[teamId] = {};
  }
  function handle(method, urlStr, body) {
    const u = new URL(urlStr, 'https://example.test');
    const p = u.pathname.replace(/^\/api/, '');
    const q = u.searchParams;
    if (p === '/me' && method === 'GET') {
      return { status: 200, data: { teams: myTeams.slice(), user: { uid: 'u1', name: 'Owner' } } };
    }
    if (p === '/teams' && method === 'POST') {
      const id = 'tm_' + (++seq);
      ensure(id);
      teams[id].name = (body && body.name) || id;
      myTeams.push({ id, name: teams[id].name, role: 'owner' });
      return { status: 200, data: { teamId: id, name: teams[id].name } };
    }
    if (p === '/team') {
      const teamId = method === 'GET' ? q.get('teamId') : body.teamId;
      ensure(teamId);
      const t = teams[teamId];
      if (method === 'GET') return { status: 200, data: { data: t.data, version: t.version, name: t.name, role: 'owner', ownerId: 'u1', members: [{ uid: 'u1', role: 'owner' }] } };
      if (method === 'PUT') {
        const base = Number(body.baseVersion);
        if (t.version !== base) return { status: 409, data: { error: 'conflict', data: t.data, version: t.version } };
        let data = body.data;
        if (data && Array.isArray(data.games)) {
          data = Object.assign({}, data);
          const order = [];
          (body.data.games || []).forEach((g) => { if (g && g.id) { order.push(g.id); if (!games[teamId][g.id]) games[teamId][g.id] = { version: 1, game: g }; } });
          data.gameOrder = order; delete data.games;
        }
        t.data = data; t.version += 1;
        return { status: 200, data: { version: t.version } };
      }
    }
    if (p === '/games') {
      const teamId = q.get('teamId'); ensure(teamId);
      return { status: 200, data: { games: Object.keys(games[teamId]).map((gid) => ({ gameId: gid, version: games[teamId][gid].version })) } };
    }
    if (p === '/game') {
      const teamId = method === 'GET' ? q.get('teamId') : body.teamId;
      const gameId = method === 'GET' ? q.get('gameId') : body.gameId;
      ensure(teamId);
      const rec = games[teamId][gameId];
      if (method === 'GET') { if (!rec) return { status: 404, data: { error: 'no_such_game' } }; return { status: 200, data: { gameId, version: rec.version, game: rec.game } }; }
      if (method === 'DELETE') { delete games[teamId][gameId]; return { status: 200, data: { deleted: true } }; }
      if (method === 'PUT') {
        const base = Number(body.baseVersion);
        const cur = rec ? rec.version : 0;
        if (base !== cur) return { status: 409, data: { error: 'conflict', gameId, version: cur, game: rec ? rec.game : null } };
        const next = cur + 1; games[teamId][gameId] = { version: next, game: body.game };
        return { status: 200, data: { gameId, version: next } };
      }
    }
    return { status: 404, data: { error: 'not_found' } };
  }
  return { teams, games, myTeams, handle };
}

function wireFetch(win, server) {
  win.fetch = async (url, opts) => {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    const { status, data } = server.handle(method, String(url), body);
    return { status, ok: status >= 200 && status < 300, json: async () => data };
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settleBoot(win) {
  for (let i = 0; i < 20 && win.document.readyState !== 'complete'; i++) await tick();
  await tick();
}
// Force uiDialog into its headless "fallback" branch so uiConfirm resolves true and
// uiPrompt resolves the suggested name (i.e. the user accepts the migration).
function acceptDialogs(win) {
  const ov = win.document.getElementById('dlgOverlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}
function mkPlayer(id, name) { return { id, name, foot: 'R', positions: [] }; }
function mkGame(id, extra) {
  return Object.assign({ id, name: id, date: 0, periods: 2, minutes: 35, subs: {}, availability: {}, plan: null, pins: {}, locked: false, live: { period: 0 } }, extra || {});
}
async function bootLoggedIn(server, teams) {
  const app = loadApp();
  wireFetch(app.window, server);
  await settleBoot(app.window);
  const a = app.LM.Sync.account;
  a.checked = true; a.loggedIn = true; a.user = { uid: 'u1', name: 'Owner' }; a.teams = teams || [];
  return app;
}

test('first login with local data + no cloud team migrates into a new account team', async () => {
  const server = makeServer();
  const A = await bootLoggedIn(server, []);
  // Legacy passcode config that must be retired after migration.
  A.window.localStorage.setItem('lineupManager.sync.v1', JSON.stringify({ mode: 'passcode', teamId: 'Thunder', passcode: 'abcd' }));
  // Local-only roster + games on this device.
  A.LM.syncApply({
    players: [mkPlayer('p1', 'Ana'), mkPlayer('p2', 'Bea')],
    games: [mkGame('g_1', { foo: 1 }), mkGame('g_2', { foo: 2 })],
    currentGameId: 'g_1',
  });
  acceptDialogs(A.window);

  const migrated = await A.LM.maybeMigrateLocalToAccount();
  assert.equal(migrated, true, 'migration ran');
  assert.equal(A.LM.Sync.mode, 'account', 'now on an account team');
  assert.equal(A.LM.Sync.connected, true, 'connected after migration');
  assert.equal(server.myTeams.length, 1, 'exactly one team created');

  const teamId = server.myTeams[0].id;
  assert.equal(server.myTeams[0].name, 'Thunder', 'team named from legacy passcode team');
  assert.ok(server.games[teamId].g_1 && server.games[teamId].g_2, 'both games pushed as entities');
  assert.equal(server.games[teamId].g_1.game.foo, 1);
  assert.equal(server.teams[teamId].data.games, undefined, 'games stripped from team doc');
  assert.deepEqual(server.teams[teamId].data.gameOrder, ['g_1', 'g_2'], 'gameOrder preserved');
  assert.equal(A.LM.Sync.dirty, false, 'settled (nothing pending) after push');
  assert.equal(A.LM.migrationDone(), true, 'migration marked done');
  assert.equal(A.LM.readLegacyPasscodeConfig(), null, 'legacy passcode config retired');
});

test('no migration when the account already has cloud teams', async () => {
  const server = makeServer();
  const A = await bootLoggedIn(server, [{ id: 'existing', name: 'Existing', role: 'owner' }]);
  A.LM.syncApply({ players: [mkPlayer('p1', 'Ana')], games: [mkGame('g_1', {})], currentGameId: 'g_1' });
  acceptDialogs(A.window);
  const migrated = await A.LM.maybeMigrateLocalToAccount();
  assert.equal(migrated, false, 'no migration');
  assert.equal(server.myTeams.length, 0, 'no team created');
  assert.equal(A.LM.Sync.connected, false, 'left for the user to pick a team');
});

test('no migration (marked done) when there is no local data', async () => {
  const server = makeServer();
  const A = await bootLoggedIn(server, []);
  A.LM.state.players.length = 0; A.LM.state.games.length = 0; // user cleared everything
  assert.equal(A.LM.localHasData(), false, 'nothing local');
  const migrated = await A.LM.maybeMigrateLocalToAccount();
  assert.equal(migrated, false, 'no migration');
  assert.equal(server.myTeams.length, 0, 'no team created');
  assert.equal(A.LM.migrationDone(), true, 'marked done so we never re-prompt');
});

test('migration is offered at most once (does not repeat after being marked done)', async () => {
  const server = makeServer();
  const A = await bootLoggedIn(server, []);
  A.window.localStorage.setItem('lineupManager.migrate.v1', '1'); // already offered
  A.LM.syncApply({ players: [mkPlayer('p1', 'Ana')], games: [mkGame('g_1', {})], currentGameId: 'g_1' });
  acceptDialogs(A.window);
  const migrated = await A.LM.maybeMigrateLocalToAccount();
  assert.equal(migrated, false, 'not offered again');
  assert.equal(server.myTeams.length, 0, 'no team created');
});
