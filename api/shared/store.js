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
// Which roles may mutate team data. owner and editor (and legacy 'member', which
// predates the editor/viewer split) can write; an explicit 'viewer' is read-only.
function canWrite(role) {
  return role === 'owner' || role === 'editor' || role === 'member';
}

// Roles an owner may assign to a member (owner itself is not assignable this way).
const ASSIGNABLE_ROLES = ['editor', 'viewer'];
function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const r = role.trim().toLowerCase();
  return ASSIGNABLE_ROLES.indexOf(r) >= 0 ? r : null;
}

// ---- Pure membership transforms (no I/O) so they're unit-testable. Each takes
// a team doc and returns { ok, doc?, error? }; doc is a fresh doc ready to write
// (version bumped, updatedAt refreshed) — never mutates the input. ----
function _reshapeTeam(team, members) {
  return {
    version: (team.version || 1) + 1,
    ownerId: team.ownerId,
    members: members,
    displayName: team.displayName || '',
    data: team.data || null,
    updatedAt: new Date().toISOString(),
  };
}
function applySetRole(team, uid, role) {
  if (!isAccountTeam(team)) return { ok: false, error: 'not_account_team' };
  const r = normalizeRole(role);
  if (!r) return { ok: false, error: 'invalid_role' };
  if (uid === team.ownerId) return { ok: false, error: 'cannot_change_owner' };
  const members = team.members || [];
  const idx = members.findIndex((m) => m && m.uid === uid);
  if (idx < 0) return { ok: false, error: 'not_a_member' };
  if ((members[idx].role || 'member') === r) return { ok: true, doc: null }; // no-op
  const next = members.map((m, i) => (i === idx ? Object.assign({}, m, { role: r }) : m));
  return { ok: true, doc: _reshapeTeam(team, next) };
}
function applyRemoveMember(team, uid) {
  if (!isAccountTeam(team)) return { ok: false, error: 'not_account_team' };
  if (!uid) return { ok: false, error: 'invalid_uid' };
  if (uid === team.ownerId) return { ok: false, error: 'cannot_remove_owner' };
  const members = team.members || [];
  if (!members.some((m) => m && m.uid === uid)) return { ok: true, doc: null }; // already gone
  const next = members.filter((m) => m && m.uid !== uid);
  return { ok: true, doc: _reshapeTeam(team, next) };
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
        { uid: member.uid, provider: member.provider || 'aad', role: member.role || 'member', name: member.name || '', addedAt: new Date().toISOString() },
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

// Change a member's role (owner-only decision enforced by the caller) with an
// optimistic-retry loop. Returns the resulting team doc, or an { error } object.
async function setMemberRole(teamId, uid, role) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const team = await readTeam(teamId);
    if (!team || !isAccountTeam(team)) return { error: 'no_such_team' };
    const res = applySetRole(team, uid, role);
    if (!res.ok) return { error: res.error };
    if (!res.doc) return team; // no-op
    try {
      await writeTeam(teamId, res.doc, { ifMatch: team._etag });
      return res.doc;
    } catch (e) {
      if (isPreconditionError(e)) continue;
      throw e;
    }
  }
  throw new Error('member_role_contention');
}

// Remove a member from a team (owner removing someone, or a member leaving) with
// an optimistic-retry loop. Returns the resulting team doc, or an { error } object.
async function removeMember(teamId, uid) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const team = await readTeam(teamId);
    if (!team || !isAccountTeam(team)) return { error: 'no_such_team' };
    const res = applyRemoveMember(team, uid);
    if (!res.ok) return { error: res.error };
    if (!res.doc) return team; // already gone
    try {
      await writeTeam(teamId, res.doc, { ifMatch: team._etag });
      return res.doc;
    } catch (e) {
      if (isPreconditionError(e)) continue;
      throw e;
    }
  }
  throw new Error('member_remove_contention');
}

// Permanently delete a team blob (owner-only decision enforced by the caller).
async function deleteTeam(teamId) {
  const c = await container();
  const blob = c.getBlockBlobClient(teamId + '.json');
  try {
    await blob.deleteIfExists();
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return;
    throw e;
  }
  // Physical entity split: a team's games live in their own blobs — clear them too.
  try { await deleteAllGames(teamId); } catch (e) { /* best-effort */ }
}

/* ==========================================================================
 * Per-game blobs (physical entity split): teamgames/<teamId>/<gameId>.json
 * ------------------------------------------------------------------------
 * Each game is its own versioned blob so two coaches editing DIFFERENT games
 * never collide. The blob body is { teamId, gameId, version, game, updatedAt };
 * the numeric `version` is also mirrored into blob metadata so listGames() can
 * report versions without downloading every body. Optimistic concurrency uses
 * the numeric version plus the blob ETag, exactly like team docs.
 * ======================================================================== */
const GAMES_CONTAINER = 'teamgames';
async function gamesContainer() {
  return getContainer(GAMES_CONTAINER);
}
// Game ids are client-minted (uid('g') → 'g_' + UUID). Keep them blob-name safe.
function normalizeGameId(id) {
  if (typeof id !== 'string') return null;
  const t = id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,80}$/.test(t)) return null;
  return t;
}
function gameBlobName(teamId, gameId) {
  return teamId + '/' + gameId + '.json';
}
async function readGame(teamId, gameId) {
  const c = await gamesContainer();
  const blob = c.getBlockBlobClient(gameBlobName(teamId, gameId));
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
// Write a game doc. opts.ifNoneMatch='*' creates only if absent; opts.ifMatch=<etag>
// updates only if unchanged. The version is mirrored into blob metadata for listGames.
async function writeGame(teamId, gameId, doc, opts) {
  const c = await gamesContainer();
  const blob = c.getBlockBlobClient(gameBlobName(teamId, gameId));
  const body = JSON.stringify(doc);
  const conditions = {};
  if (opts && opts.ifNoneMatch) conditions.ifNoneMatch = opts.ifNoneMatch;
  if (opts && opts.ifMatch) conditions.ifMatch = opts.ifMatch;
  const res = await blob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    metadata: { version: String(doc.version || 1) },
    conditions,
  });
  return res.etag;
}
async function deleteGame(teamId, gameId) {
  const c = await gamesContainer();
  const blob = c.getBlockBlobClient(gameBlobName(teamId, gameId));
  try {
    await blob.deleteIfExists();
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return;
    throw e;
  }
}
// List a team's games as [{ gameId, version }] using blob metadata — no body download.
async function listGames(teamId) {
  const c = await gamesContainer();
  const prefix = teamId + '/';
  const out = [];
  for await (const b of c.listBlobsFlat({ prefix, includeMetadata: true })) {
    const gameId = b.name.slice(prefix.length).replace(/\.json$/, '');
    if (!gameId) continue;
    const version = Number((b.metadata && b.metadata.version) || 0) || 1;
    out.push({ gameId, version });
  }
  return out;
}
async function deleteAllGames(teamId) {
  const c = await gamesContainer();
  const prefix = teamId + '/';
  for await (const b of c.listBlobsFlat({ prefix })) {
    try { await c.getBlockBlobClient(b.name).deleteIfExists(); } catch (e) { /* best-effort */ }
  }
}
// Upsert games into their own blobs, creating any that don't exist yet, and return
// the ordered list of ids. Used as a safety net when an older cached client still
// PUTs embedded games to /api/team during the migration window (existing per-game
// blobs are left untouched so a live edit is never clobbered).
async function upsertGamesIfAbsent(teamId, games) {
  const order = [];
  for (const g of (games || [])) {
    const gid = g && normalizeGameId(g.id);
    if (!gid) continue;
    order.push(gid);
    try {
      const existing = await readGame(teamId, gid);
      if (!existing) {
        await writeGame(teamId, gid, { teamId, gameId: gid, version: 1, game: g, updatedAt: new Date().toISOString() });
      }
    } catch (e) { /* best-effort */ }
  }
  return order;
}
// One-time server-side migration: if a team doc still embeds its games inside
// `data.games`, move each game into its own blob and strip games from the team doc,
// leaving an ordered `data.gameOrder` index behind. Idempotent and best-effort:
// on any per-game failure we leave the embedded copy so nothing is lost. Returns
// the (possibly rewritten) team doc so the caller can serve it immediately.
async function migrateTeamGames(teamId, team) {
  if (!team || !team.data || !Array.isArray(team.data.games) || !team.data.games.length) return team;
  const games = team.data.games;
  const order = [];
  let allMoved = true;
  for (const g of games) {
    const gid = g && normalizeGameId(g.id);
    if (!gid) { allMoved = false; continue; }
    order.push(gid);
    try {
      const existing = await readGame(teamId, gid);
      if (!existing) {
        await writeGame(teamId, gid, { teamId, gameId: gid, version: 1, game: g, updatedAt: new Date().toISOString() });
      }
    } catch (e) {
      allMoved = false; // leave the embedded copy in place for a later retry
    }
  }
  if (!allMoved) return team; // don't strip until every game is safely split out
  const newData = Object.assign({}, team.data, { gameOrder: order });
  delete newData.games;
  const doc = {
    version: (team.version || 1) + 1,
    data: newData,
    updatedAt: new Date().toISOString(),
  };
  if (isAccountTeam(team)) {
    doc.ownerId = team.ownerId;
    doc.members = team.members || [];
    doc.displayName = team.displayName || teamId;
  } else {
    doc.passHash = team.passHash;
    doc.salt = team.salt;
  }
  try {
    await writeTeam(teamId, doc, { ifMatch: team._etag });
    doc._etag = undefined;
    return doc;
  } catch (e) {
    return team; // lost the race — a concurrent writer will migrate; serve current
  }
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

// Default share lifetime. Shares are convenience links (a game/roster snapshot),
// so they expire on their own; an authenticated creator can also revoke early.
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Write a share, retrying on the (astronomically rare) code collision.
// opts.createdBy (uid) enables later revocation; opts.ttlMs overrides the default.
async function writeShare(payload, opts) {
  const c = await sharesContainer();
  const now = Date.now();
  const ttl = opts && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : SHARE_TTL_MS;
  const doc = JSON.stringify({
    v: 1,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    createdBy: (opts && opts.createdBy) || null,
    payload,
  });
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

// Read the full share doc (metadata + payload), or null if missing.
async function readShareDoc(code) {
  const c = await sharesContainer();
  const blob = c.getBlockBlobClient(code + '.json');
  try {
    const dl = await blob.download();
    return JSON.parse(await streamToString(dl.readableStreamBody));
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return null;
    throw e;
  }
}

function shareExpired(doc) {
  return !!(doc && doc.expiresAt && Date.parse(doc.expiresAt) < Date.now());
}

async function readShare(code) {
  const doc = await readShareDoc(code);
  if (doc == null) return null;
  // Legacy shares (no wrapper) were stored as the bare payload.
  if (doc.payload === undefined) return doc;
  if (shareExpired(doc)) return null;
  return doc.payload;
}

async function deleteShare(code) {
  const c = await sharesContainer();
  const blob = c.getBlockBlobClient(code + '.json');
  try {
    await blob.deleteIfExists();
  } catch (e) {
    if (e.statusCode === 404 || e.code === 'BlobNotFound') return;
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
  readShareDoc,
  deleteShare,
  shareExpired,
  normalizeShareCode,
  // accounts / membership
  identityFrom,
  isAccountTeam,
  isMember,
  roleOf,
  canWrite,
  normalizeRole,
  applySetRole,
  applyRemoveMember,
  genTeamId,
  readUser,
  writeUser,
  addTeamToUser,
  removeTeamFromUser,
  writeInvite,
  readInvite,
  addMember,
  setMemberRole,
  removeMember,
  deleteTeam,
  // per-game entity storage (physical split)
  normalizeGameId,
  readGame,
  writeGame,
  deleteGame,
  listGames,
  deleteAllGames,
  upsertGamesIfAbsent,
  migrateTeamGames,
};
