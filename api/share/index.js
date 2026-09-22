'use strict';
/*
 * Short server-backed share links (no passcode).
 *   POST /api/share   { payload }         → { code }   (stores the game payload)
 *   GET  /api/share?code=<code>           → { payload } (404 if unknown)
 * The payload is the same encoded object the client puts in a long #g= link;
 * storing it server-side lets us hand out a tiny #s=<code> URL instead.
 * Access is by unguessable code only — there is no listing endpoint.
 */
const store = require('../shared/store');
const throttle = require('../shared/throttle');

function json(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

// Cap stored payload size so a share blob can't be abused for large uploads.
const MAX_BYTES = 512 * 1024;

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();
  const ip = throttle.clientIp(req);

  if (method === 'GET') {
    const code = store.normalizeShareCode(req.query && req.query.code);
    if (!code) return json(context, 400, { error: 'invalid_code' });
    try {
      const payload = await store.readShare(code);
      if (payload == null) return json(context, 404, { error: 'not_found' });
      return json(context, 200, { payload });
    } catch (e) {
      context.log.error('share get failed', e);
      return json(context, 500, { error: 'server_error' });
    }
  }

  if (method === 'POST') {
    // Anonymous, so cap creation volume per IP to blunt abuse.
    if (throttle.rateLimit('share', ip, 20, 60 * 1000)) {
      return json(context, 429, { error: 'too_many_requests', message: 'Slow down and try again in a minute.' });
    }
    const body = req.body || {};
    const payload = body.payload;
    if (payload == null || typeof payload !== 'object') {
      return json(context, 400, { error: 'invalid_payload' });
    }
    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(payload));
    } catch (e) {
      return json(context, 400, { error: 'invalid_payload' });
    }
    if (size > MAX_BYTES) return json(context, 413, { error: 'payload_too_large' });
    // Record the creator when signed in so they can revoke the link later.
    const identity = store.identityFrom(req);
    const opts = {};
    if (identity) opts.createdBy = identity.uid;
    if (Number.isFinite(body.ttlDays) && body.ttlDays > 0) opts.ttlMs = Math.min(body.ttlDays, 365) * 24 * 60 * 60 * 1000;
    try {
      const code = await store.writeShare(payload, opts);
      return json(context, 200, { code, revocable: !!identity });
    } catch (e) {
      context.log.error('share post failed', e);
      return json(context, 500, { error: 'server_error' });
    }
  }

  if (method === 'DELETE') {
    // Revoke a share early. Only the signed-in user who created it may do so.
    const identity = store.identityFrom(req);
    if (!identity) return json(context, 401, { error: 'login_required' });
    const code = store.normalizeShareCode((req.query && req.query.code) || (req.body && req.body.code));
    if (!code) return json(context, 400, { error: 'invalid_code' });
    try {
      const doc = await store.readShareDoc(code);
      if (doc == null) return json(context, 404, { error: 'not_found' });
      if (!doc.createdBy || doc.createdBy !== identity.uid) {
        return json(context, 403, { error: 'not_owner', message: 'Only the person who created this link can revoke it.' });
      }
      await store.deleteShare(code);
      return json(context, 200, { revoked: true });
    } catch (e) {
      context.log.error('share delete failed', e);
      return json(context, 500, { error: 'server_error' });
    }
  }

  return json(context, 405, { error: 'method_not_allowed' });
};
