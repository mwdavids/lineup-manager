'use strict';
/*
 * Server-side data + passcode store for Lineup Manager team sync.
 * One blob per team: teamdata/<teamId>.json holding
 *   { version, passHash, salt, data, updatedAt }
 * The passcode is never stored in plaintext and never returned to the client.
 * Optimistic concurrency uses both the numeric `version` field and the blob ETag.
 */
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'teamdata';

function connString() {
  return (
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    'UseDevelopmentStorage=true' // Azurite for local dev
  );
}

// Shared BlobServiceClient + a small container-client cache so each container
// is only created once per warm instance.
let _svc = null;
function svc() {
  if (!_svc) _svc = BlobServiceClient.fromConnectionString(connString());
  return _svc;
}
const _containers = new Map();
async function getContainer(name) {
  if (_containers.has(name)) return _containers.get(name);
  const c = svc().getContainerClient(name);
  await c.createIfNotExists(); // private by default
  _containers.set(name, c);
  return c;
}
async function container() {
  return getContainer(CONTAINER);
}

// team ids are short slugs; keep them filesystem/URL safe and case-insensitive
function normalizeTeamId(id) {
  if (typeof id !== 'string') return null;
  const t = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(t)) return null;
  return t;
}

function hashPass(pass, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pass, 'utf8').digest('hex');
}
function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) {
    return false;
  }
}

async function readTeam(teamId) {
  const c = await container();
  const blob = c.getBlockBlobClient(teamId + '.json');
  try {
    const dl = await blob.download();
    const txt = await streamToString(dl.readableStreamBody);
    const doc = JSON.parse(txt);
    doc._etag = dl.etag;
    return doc;
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return null;
    throw e;
  }
}

// Write a team doc. opts.ifNoneMatch='*' creates only if absent (first join);
// opts.ifMatch=<etag> updates only if unchanged. Returns the new etag.
async function writeTeam(teamId, doc, opts) {
  const c = await container();
  const blob = c.getBlockBlobClient(teamId + '.json');
  const body = JSON.stringify(doc);
  const conditions = {};
  if (opts && opts.ifNoneMatch) conditions.ifNoneMatch = opts.ifNoneMatch;
  if (opts && opts.ifMatch) conditions.ifMatch = opts.ifMatch;
  const res = await blob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions,
  });
  return res.etag;
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function isPreconditionError(e) {
  return (
    e &&
    (e.statusCode === 409 ||
      e.statusCode === 412 ||
      e.code === 'ConditionNotMet' ||
      e.code === 'BlobAlreadyExists')
  );
}

/* ==========================================================================
 * Account identity + team membership (Static Web Apps managed auth)
 * ------------------------------------------------------------------------
 * SWA injects the signed-in user as the base64-encoded JSON header
 * `x-ms-client-principal`. We derive a stable per-user id from it. Account
 * teams carry `ownerId` + `members[]`; legacy passcode teams do not, so the
 * two models coexist (hybrid).
 * ======================================================================== */
function identityFrom(req) {
  const h = (req && req.headers) || {};
  const raw = h['x-ms-client-principal'] || h['X-MS-CLIENT-PRINCIPAL'];
  if (!raw) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!p || !p.userId) return null;
  return {
    uid: String(p.userId),
    provider: p.identityProvider || 'aad',
    name: p.userDetails || '',
  };
}

function isAccountTeam(team) {
  return !!(team && (team.ownerId || Array.isArray(team.members)));
}
function isMember(team, uid) {
  if (!team || !uid) return false;
  if (team.ownerId === uid) return true;
  return Array.isArray(team.members) && team.members.some((m) => m && m.uid === uid);
}
function roleOf(team, uid) {
  if (!team || !uid) return null;
  if (team.ownerId === uid) return 'owner';
  const m = (team.members || []).find((x) => x && x.uid === uid);
  return m ? m.role || 'member' : null;
}

// Random, collision-checked team id (account teams get generated ids so nobody
// can squat a friendly slug). Always passes normalizeTeamId().
function genTeamId() {
  return 'tm-' + crypto.randomBytes(6).toString('hex'); // e.g. tm-9f3a1c7b0d21
}

/* -------- Per-user team index: users/<uid>.json = { displayName, teams:[] } ---- */
const USERS_CONTAINER = 'users';
async function usersContainer() {
  return getContainer(USERS_CONTAINER);
}
function userKey(uid) {
  // uid can contain characters unsafe for a blob name; hash it to a stable slug.
  return crypto.createHash('sha256').update(String(uid), 'utf8').digest('hex') + '.json';
}
async function readUser(uid) {
  const c = await usersContainer();
  const blob = c.getBlockBlobClient(userKey(uid));
  try {
    const dl = await blob.download();
    const doc = JSON.parse(await streamToString(dl.readableStreamBody));
    doc._etag = dl.etag;
    return doc;
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return null;
    throw e;
  }
}
async function writeUser(uid, doc, opts) {
  const c = await usersContainer();
  const blob = c.getBlockBlobClient(userKey(uid));
  const body = JSON.stringify(doc);
  const conditions = {};
  if (opts && opts.ifNoneMatch) conditions.ifNoneMatch = opts.ifNoneMatch;
  if (opts && opts.ifMatch) conditions.ifMatch = opts.ifMatch;
  const res = await blob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions,
  });
  return res.etag;
}
// Add a team to a user's index (idempotent) with a small optimistic-retry loop.
async function addTeamToUser(uid, teamId, meta) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readUser(uid);
    if (!cur) {
      const doc = { displayName: (meta && meta.displayName) || '', teams: [teamId] };
      try {
        await writeUser(uid, doc, { ifNoneMatch: '*' });
        return;
      } catch (e) {
        if (isPreconditionError(e)) continue; // created concurrently → reread
        throw e;
      }
    }
    if (Array.isArray(cur.teams) && cur.teams.indexOf(teamId) >= 0) return; // already present
    const doc = {
      displayName: (meta && meta.displayName) || cur.displayName || '',
      teams: (cur.teams || []).concat([teamId]),
    };
    try {
      await writeUser(uid, doc, { ifMatch: cur._etag });
      return;
    } catch (e) {
      if (isPreconditionError(e)) continue; // changed under us → retry
      throw e;
    }
  }
  throw new Error('user_index_contention');
}
async function removeTeamFromUser(uid, teamId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readUser(uid);
    if (!cur || !Array.isArray(cur.teams) || cur.teams.indexOf(teamId) < 0) return;
    const doc = { displayName: cur.displayName || '', teams: cur.teams.filter((t) => t !== teamId) };
    try {
      await writeUser(uid, doc, { ifMatch: cur._etag });
      return;
    } catch (e) {
      if (isPreconditionError(e)) continue;
      throw e;
    }
  }
  throw new Error('user_index_contention');
}

/* -------- Invites: invites/<code>.json = { teamId, createdBy, expiresAt } ------ */
const INVITES_CONTAINER = 'invites';
async function invitesContainer() {
  return getContainer(INVITES_CONTAINER);
}
async function writeInvite(doc) {
  const c = await invitesContainer();
  const body = JSON.stringify(Object.assign({ v: 1, createdAt: new Date().toISOString() }, doc));
  const bytes = Buffer.byteLength(body);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newShareCode(10);
    const blob = c.getBlockBlobClient(code + '.json');
    try {
      await blob.upload(body, bytes, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: { ifNoneMatch: '*' },
      });
      return code;
    } catch (e) {
      if (isPreconditionError(e)) continue; // collision → new code
      throw e;
    }
  }
  throw new Error('invite_code_exhausted');
}
async function readInvite(code) {
  const c = await invitesContainer();
  const blob = c.getBlockBlobClient(code + '.json');
  try {
    const dl = await blob.download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return null;
    throw e;
  }
}

// Add a member to an account team (idempotent) with an optimistic-retry loop.
// Bumps the team version so a client mid-edit re-syncs and keeps the new member.
// Returns the resulting team doc (or null if the team is gone / not an account team).
async function addMember(teamId, member) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const team = await readTeam(teamId);
    if (!team || !isAccountTeam(team)) return null;
    if (isMember(team, member.uid)) return team; // already a member
    const doc = {
      version: (team.version || 1) + 1,
      ownerId: team.ownerId,
      members: (team.members || []).concat([
        { uid: member.uid, provider: member.provider || 'aad', role: member.role || 'member', addedAt: new Date().toISOString() },
      ]),
      displayName: team.displayName || teamId,
      data: team.data || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeTeam(teamId, doc, { ifMatch: team._etag });
      doc._etag = undefined;
      return doc;
    } catch (e) {
      if (isPreconditionError(e)) continue; // changed under us → retry
      throw e;
    }
  }
  throw new Error('member_add_contention');
}

/* -------- Short share links (no passcode) --------
 * One blob per share: shares/<code>.json holding { v, createdAt, payload }.
 * Codes are short base62 tokens; GET is public-read-by-code (unguessable). */
const SHARES_CONTAINER = 'shares';
async function sharesContainer() {
  return getContainer(SHARES_CONTAINER);
}

const SHARE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function newShareCode(len) {
  const n = len || 8;
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += SHARE_ALPHABET[bytes[i] % SHARE_ALPHABET.length];
  return out;
}
function normalizeShareCode(code) {
  if (typeof code !== 'string') return null;
  const t = code.trim();
  if (!/^[A-Za-z0-9]{4,16}$/.test(t)) return null;
  return t;
}

// Write a share, retrying on the (astronomically rare) code collision.
async function writeShare(payload) {
  const c = await sharesContainer();
  const doc = JSON.stringify({ v: 1, createdAt: new Date().toISOString(), payload });
  const bytes = Buffer.byteLength(doc);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newShareCode(8);
    const blob = c.getBlockBlobClient(code + '.json');
    try {
      await blob.upload(doc, bytes, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: { ifNoneMatch: '*' },
      });
      return code;
    } catch (e) {
      if (isPreconditionError(e)) continue; // collision → new code
      throw e;
    }
  }
  throw new Error('share_code_exhausted');
}

async function readShare(code) {
  const c = await sharesContainer();
  const blob = c.getBlockBlobClient(code + '.json');
  try {
    const dl = await blob.download();
    const txt = await streamToString(dl.readableStreamBody);
    const doc = JSON.parse(txt);
    return doc.payload !== undefined ? doc.payload : doc;
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return null;
    throw e;
  }
}

module.exports = {
  normalizeTeamId,
  hashPass,
  newSalt,
  safeEqualHex,
  readTeam,
  writeTeam,
  isPreconditionError,
  writeShare,
  readShare,
  normalizeShareCode,
  // accounts / membership
  identityFrom,
  isAccountTeam,
  isMember,
  roleOf,
  genTeamId,
  readUser,
  writeUser,
  addTeamToUser,
  removeTeamFromUser,
  writeInvite,
  readInvite,
  addMember,
};
