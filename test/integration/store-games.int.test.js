'use strict';
/*
 * Integration tests for the per-game blob storage layer (Phase 3 physical split).
 * These hit real Blob storage, so they run against Azurite. Start it first:
 *
 *   azurite --silent            (or: npm run azurite)
 *
 * then:  npm run test:int
 *
 * If Azurite isn't reachable the whole suite is skipped (not failed) so it never
 * breaks a machine without the emulator. It is deliberately NOT part of `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Force the emulator connection before the store is required.
process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
const store = require('../../api/shared/store');

const TEAM = 'inttest' + Math.random().toString(36).slice(2, 8);

async function azuriteUp() {
  try {
    await store.listGames(TEAM); // any round-trip proves connectivity
    return true;
  } catch (e) {
    return false;
  }
}

test('per-game storage layer (Azurite)', async (t) => {
  if (!(await azuriteUp())) {
    t.skip('Azurite not reachable — start it with `npm run azurite` to run these.');
    return;
  }

  await t.test('write → read round-trips the game and version', async () => {
    const gid = store.normalizeGameId('g_' + Math.random().toString(36).slice(2, 10));
    await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 1, game: { name: 'v1', roster: [] } }, { ifNoneMatch: '*' });
    const doc = await store.readGame(TEAM, gid);
    assert.equal(doc.version, 1);
    assert.equal(doc.game.name, 'v1');
    assert.ok(doc._etag, 'read exposes the blob etag for optimistic concurrency');
    await store.deleteGame(TEAM, gid);
  });

  await t.test('ifNoneMatch create is rejected when the game already exists', async () => {
    const gid = store.normalizeGameId('g_' + Math.random().toString(36).slice(2, 10));
    await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 1, game: {} }, { ifNoneMatch: '*' });
    let threw = null;
    try {
      await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 1, game: {} }, { ifNoneMatch: '*' });
    } catch (e) { threw = e; }
    assert.ok(threw && store.isPreconditionError(threw), 'duplicate create is a precondition failure');
    await store.deleteGame(TEAM, gid);
  });

  await t.test('ifMatch update is rejected against a stale etag', async () => {
    const gid = store.normalizeGameId('g_' + Math.random().toString(36).slice(2, 10));
    await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 1, game: {} }, { ifNoneMatch: '*' });
    const first = await store.readGame(TEAM, gid);
    await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 2, game: {} }, { ifMatch: first._etag });
    let threw = null;
    try {
      await store.writeGame(TEAM, gid, { teamId: TEAM, gameId: gid, version: 3, game: {} }, { ifMatch: first._etag });
    } catch (e) { threw = e; }
    assert.ok(threw && store.isPreconditionError(threw), 'stale etag update is a precondition failure');
    await store.deleteGame(TEAM, gid);
  });

  await t.test('listGames reports versions from metadata without a body download', async () => {
    const a = store.normalizeGameId('g_' + Math.random().toString(36).slice(2, 10));
    const b = store.normalizeGameId('g_' + Math.random().toString(36).slice(2, 10));
    await store.writeGame(TEAM, a, { teamId: TEAM, gameId: a, version: 3, game: {} }, { ifNoneMatch: '*' });
    await store.writeGame(TEAM, b, { teamId: TEAM, gameId: b, version: 7, game: {} }, { ifNoneMatch: '*' });
    const list = await store.listGames(TEAM);
    const byId = Object.fromEntries(list.map((g) => [g.gameId, g.version]));
    assert.equal(byId[a], 3);
    assert.equal(byId[b], 7);
    await store.deleteAllGames(TEAM);
    assert.equal((await store.listGames(TEAM)).length, 0, 'deleteAllGames clears the team');
  });

  await t.test('migrateTeamGames splits embedded games and strips them from the doc', async () => {
    const data = {
      players: [{ id: 'p1' }],
      currentGameId: 'g_one',
      games: [
        { id: 'g_one', name: 'Game One' },
        { id: 'g_two', name: 'Game Two' },
      ],
    };
    await store.writeTeam(TEAM, {
      version: 1, ownerId: 'user-1', members: [{ uid: 'user-1', role: 'owner' }], displayName: 'Int Test', data,
    });
    const seeded = await store.readTeam(TEAM);
    const migrated = await store.migrateTeamGames(TEAM, seeded);
    assert.ok(!migrated.data.games, 'embedded games removed');
    assert.deepEqual(migrated.data.gameOrder, ['g_one', 'g_two'], 'gameOrder preserves order');
    assert.equal((await store.readGame(TEAM, 'g_one')).game.name, 'Game One');
    assert.equal((await store.readGame(TEAM, 'g_two')).game.name, 'Game Two');
    // Idempotent: a second call over the already-stripped doc is a no-op.
    const again = await store.migrateTeamGames(TEAM, migrated);
    assert.deepEqual(again.data.gameOrder, ['g_one', 'g_two']);
    await store.deleteAllGames(TEAM);
    await store.deleteTeam(TEAM);
  });
});
