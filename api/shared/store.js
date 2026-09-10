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

let _container = null;
async function container() {
  if (_container) return _container;
  const svc = BlobServiceClient.fromConnectionString(connString());
  const c = svc.getContainerClient(CONTAINER);
  await c.createIfNotExists(); // private by default
  _container = c;
  return c;
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

/* -------- Short share links (no passcode) --------
 * One blob per share: shares/<code>.json holding { v, createdAt, payload }.
 * Codes are short base62 tokens; GET is public-read-by-code (unguessable). */
const SHARES_CONTAINER = 'shares';
let _shares = null;
async function sharesContainer() {
  if (_shares) return _shares;
  const svc = BlobServiceClient.fromConnectionString(connString());
  const c = svc.getContainerClient(SHARES_CONTAINER);
  await c.createIfNotExists(); // private; access is by unguessable code via the API
  _shares = c;
  return c;
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
};
