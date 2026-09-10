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
    try {
      const code = await store.writeShare(payload);
      return json(context, 200, { code });
    } catch (e) {
      context.log.error('share post failed', e);
      return json(context, 500, { error: 'server_error' });
    }
  }

  return json(context, 405, { error: 'method_not_allowed' });
};
