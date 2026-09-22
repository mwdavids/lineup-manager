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

/* ------------------------------------------------------------------------
 * Generic sliding-window request limiter (per bucket + key), used to blunt
 * abuse of the low-/no-auth endpoints (invite, accept, share). Best-effort
 * in-memory, per warm instance — same tradeoff as the passcode limiter above.
 * Returns true when the caller is over the limit and should be rejected (429).
 * ---------------------------------------------------------------------- */
const buckets = new Map(); // 'bucket|key' -> number[] (recent hit timestamps)

function rateLimit(bucket, key, max, windowMs) {
  const now = Date.now();
  const k = (bucket || '?') + '|' + (key || '?');
  const win = windowMs || 60 * 1000;
  const limit = max || 30;
  const hits = (buckets.get(k) || []).filter((t) => now - t < win);
  if (hits.length >= limit) {
    buckets.set(k, hits); // keep the window pruned even when blocking
    return true;
  }
  hits.push(now);
  buckets.set(k, hits);
  // Opportunistic cleanup so the map can't grow without bound on a warm instance.
  if (buckets.size > 5000) {
    for (const [mk, arr] of buckets) {
      const live = arr.filter((t) => now - t < win);
      if (live.length) buckets.set(mk, live);
      else buckets.delete(mk);
    }
  }
  return false;
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (xff) return String(xff).split(',')[0].trim();
  return h['x-azure-clientip'] || h['x-client-ip'] || 'unknown';
}

module.exports = { isBlocked, recordFail, recordSuccess, rateLimit, clientIp };
