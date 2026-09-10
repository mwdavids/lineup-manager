'use strict';
/*
 * Best-effort in-memory rate limiter for failed passcode attempts.
 * Per-instance only (SWA managed functions may scale), which is fine for a
 * low-security youth-sports app: it slows brute force without a datastore.
 */
const attempts = new Map(); // key -> { count, first }
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILS = 10;

function keyFor(teamId, ip) {
  return (teamId || '?') + '|' + (ip || '?');
}

function isBlocked(teamId, ip) {
  const rec = attempts.get(keyFor(teamId, ip));
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(keyFor(teamId, ip));
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(teamId, ip) {
  const k = keyFor(teamId, ip);
  const rec = attempts.get(k);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(k, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

function recordSuccess(teamId, ip) {
  attempts.delete(keyFor(teamId, ip));
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (xff) return String(xff).split(',')[0].trim();
  return h['x-azure-clientip'] || h['x-client-ip'] || 'unknown';
}

module.exports = { isBlocked, recordFail, recordSuccess, clientIp };
