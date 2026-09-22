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
