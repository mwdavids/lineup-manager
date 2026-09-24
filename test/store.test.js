'use strict';
/*
 * Unit tests for the pure (non-blob) helpers in api/shared/store.js: id/code
 * validation, passcode hashing + timing-safe compare, account identity parsing,
 * and role/membership authorization. These need no Azure connection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../api/shared/store');

test('normalizeTeamId: lowercases and validates slugs', () => {
  assert.equal(store.normalizeTeamId('Thunder-U13'), 'thunder-u13');
  assert.equal(store.normalizeTeamId('  ABC_12  '), 'abc_12');
  assert.equal(store.normalizeTeamId('a'), null, 'too short');
  assert.equal(store.normalizeTeamId('-bad'), null, 'must start alphanumeric');
  assert.equal(store.normalizeTeamId('has space'), null);
  assert.equal(store.normalizeTeamId(42), null, 'non-string');
});

test('normalizeShareCode: accepts base62 codes of a sane length', () => {
  assert.equal(store.normalizeShareCode('Ab3xZ9'), 'Ab3xZ9');
  assert.equal(store.normalizeShareCode('  code12  '), 'code12');
  assert.equal(store.normalizeShareCode('bad-code'), null, 'no punctuation');
  assert.equal(store.normalizeShareCode('abc'), null, 'too short');
  assert.equal(store.normalizeShareCode('x'.repeat(20)), null, 'too long');
});

test('genTeamId always produces a valid, normalizable team id', () => {
  for (let i = 0; i < 50; i++) {
    const id = store.genTeamId();
    assert.equal(store.normalizeTeamId(id), id);
  }
});

test('normalizeGameId: accepts blob-safe game ids, rejects the rest', () => {
  assert.equal(store.normalizeGameId('g_1a2b3c'), 'g_1a2b3c');
  assert.equal(store.normalizeGameId('  g_trim  '), 'g_trim', 'trims surrounding space');
  assert.equal(store.normalizeGameId('g_' + 'a'.repeat(60)), 'g_' + 'a'.repeat(60));
  assert.equal(store.normalizeGameId('a/b'), null, 'no path separators');
  assert.equal(store.normalizeGameId('a.b'), null, 'no dots');
  assert.equal(store.normalizeGameId('x'), null, 'too short');
  assert.equal(store.normalizeGameId('_lead'), null, 'must start alphanumeric');
  assert.equal(store.normalizeGameId('x'.repeat(200)), null, 'too long');
  assert.equal(store.normalizeGameId(42), null, 'non-string');
});

test('hashPass + safeEqualHex: deterministic hash, timing-safe compare', () => {
  const salt = store.newSalt();
  const h1 = store.hashPass('secret', salt);
  const h2 = store.hashPass('secret', salt);
  assert.equal(h1, h2, 'same passcode + salt → same hash');
  assert.ok(store.safeEqualHex(h1, h2));
  assert.notEqual(store.hashPass('secret', store.newSalt()), h1, 'different salt → different hash');
  assert.notEqual(store.hashPass('secret', salt), store.hashPass('other', salt), 'different passcode → different hash');
  assert.equal(store.safeEqualHex(h1, store.hashPass('other', salt)), false);
});

test('safeEqualHex rejects malformed / mismatched-length input', () => {
  assert.equal(store.safeEqualHex('zz', 'zz'), false, 'non-hex');
  assert.equal(store.safeEqualHex('', ''), false, 'empty');
  assert.equal(store.safeEqualHex('ab', 'abcd'), false, 'length mismatch');
  assert.equal(store.safeEqualHex('abcd', 'abcd'), true);
});

test('identityFrom: parses the SWA client principal header', () => {
  const principal = { userId: 'u-123', identityProvider: 'aad', userDetails: 'Coach Sam' };
  const raw = Buffer.from(JSON.stringify(principal), 'utf8').toString('base64');
  const id = store.identityFrom({ headers: { 'x-ms-client-principal': raw } });
  assert.deepEqual(id, { uid: 'u-123', provider: 'aad', name: 'Coach Sam' });
  assert.equal(store.identityFrom({ headers: {} }), null, 'no header → anonymous');
  assert.equal(store.identityFrom({ headers: { 'x-ms-client-principal': 'not-base64-json' } }), null, 'garbage → null');
  const noUser = Buffer.from(JSON.stringify({ identityProvider: 'aad' }), 'utf8').toString('base64');
  assert.equal(store.identityFrom({ headers: { 'x-ms-client-principal': noUser } }), null, 'missing userId → null');
});

test('membership + roles: owner/editor/member write, viewer is read-only', () => {
  const team = {
    ownerId: 'owner-1',
    members: [
      { uid: 'owner-1', role: 'owner' },
      { uid: 'ed-1', role: 'editor' },
      { uid: 'legacy-1', role: 'member' },
      { uid: 'view-1', role: 'viewer' },
    ],
  };
  assert.ok(store.isAccountTeam(team));
  assert.ok(store.isMember(team, 'owner-1'));
  assert.ok(store.isMember(team, 'view-1'));
  assert.equal(store.isMember(team, 'stranger'), false);

  assert.equal(store.roleOf(team, 'owner-1'), 'owner');
  assert.equal(store.roleOf(team, 'ed-1'), 'editor');
  assert.equal(store.roleOf(team, 'legacy-1'), 'member');
  assert.equal(store.roleOf(team, 'view-1'), 'viewer');
  assert.equal(store.roleOf(team, 'stranger'), null);

  assert.equal(store.canWrite('owner'), true);
  assert.equal(store.canWrite('editor'), true);
  assert.equal(store.canWrite('member'), true, 'legacy members retain write');
  assert.equal(store.canWrite('viewer'), false, 'viewers are read-only');
  assert.equal(store.canWrite(null), false);
});

test('legacy passcode teams are not treated as account teams', () => {
  const legacy = { passHash: 'abc', salt: 'def', version: 1, data: {} };
  assert.equal(store.isAccountTeam(legacy), false);
  assert.equal(store.roleOf(legacy, 'anyone'), null);
});

test('normalizeRole: only editor/viewer are assignable', () => {
  assert.equal(store.normalizeRole('editor'), 'editor');
  assert.equal(store.normalizeRole('Viewer'), 'viewer');
  assert.equal(store.normalizeRole('  EDITOR '), 'editor');
  assert.equal(store.normalizeRole('owner'), null, 'owner is not assignable');
  assert.equal(store.normalizeRole('member'), null, 'legacy member is not assignable');
  assert.equal(store.normalizeRole('admin'), null);
  assert.equal(store.normalizeRole(null), null);
});

function acctTeam() {
  return {
    version: 3,
    ownerId: 'owner-1',
    displayName: 'Thunder',
    data: { x: 1 },
    members: [
      { uid: 'owner-1', role: 'owner', name: 'Coach' },
      { uid: 'ed-1', role: 'editor', name: 'Ed' },
      { uid: 'view-1', role: 'viewer', name: 'Val' },
    ],
  };
}

test('applySetRole: changes a member role, bumps version, never mutates input', () => {
  const team = acctTeam();
  const snapshot = JSON.stringify(team);
  const res = store.applySetRole(team, 'view-1', 'editor');
  assert.equal(res.ok, true);
  assert.equal(res.doc.version, 4, 'version bumped');
  assert.equal(res.doc.members.find((m) => m.uid === 'view-1').role, 'editor');
  assert.deepEqual(res.doc.data, { x: 1 }, 'data preserved');
  assert.equal(JSON.stringify(team), snapshot, 'input unchanged');
});

test('applySetRole: guards owner, unknown member, bad role, and no-ops', () => {
  const team = acctTeam();
  assert.equal(store.applySetRole(team, 'owner-1', 'editor').error, 'cannot_change_owner');
  assert.equal(store.applySetRole(team, 'ghost', 'editor').error, 'not_a_member');
  assert.equal(store.applySetRole(team, 'ed-1', 'owner').error, 'invalid_role');
  const noop = store.applySetRole(team, 'ed-1', 'editor');
  assert.equal(noop.ok, true);
  assert.equal(noop.doc, null, 'same role → no-op, no write');
  assert.equal(store.applySetRole({ passHash: 'x' }, 'a', 'editor').error, 'not_account_team');
});

test('applyRemoveMember: drops a member, bumps version, protects the owner', () => {
  const team = acctTeam();
  const res = store.applyRemoveMember(team, 'ed-1');
  assert.equal(res.ok, true);
  assert.equal(res.doc.members.some((m) => m.uid === 'ed-1'), false);
  assert.equal(res.doc.members.length, 2);
  assert.equal(res.doc.version, 4);
  assert.equal(store.applyRemoveMember(team, 'owner-1').error, 'cannot_remove_owner');
  const gone = store.applyRemoveMember(team, 'never');
  assert.equal(gone.ok, true);
  assert.equal(gone.doc, null, 'not present → no-op');
});

test('shareExpired: only past expiry counts as expired', () => {
  assert.equal(store.shareExpired({ expiresAt: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(store.shareExpired({ expiresAt: new Date(Date.now() + 60000).toISOString() }), false);
  assert.equal(store.shareExpired({}), false, 'no expiry → never expires (legacy)');
  assert.equal(store.shareExpired(null), false);
});
