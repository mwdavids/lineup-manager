'use strict';
/*
 * GET /api/team?teamId=..      (passcode via x-team-pass header) → { data, version }
 * PUT /api/team { teamId, data, baseVersion }  (passcode via x-team-pass header)
 *    - baseVersion === current version → save, bump version → { version }
 *    - baseVersion mismatch → 409 { data, version } (latest) so the client can
 *      prompt keep-mine / take-theirs.
 * Optimistic concurrency is enforced by both the numeric version and the blob ETag.
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

function passOf(req) {
  const h = req.headers || {};
  return h['x-team-pass'] || h['X-Team-Pass'] || '';
}

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();
  const ip = throttle.clientIp(req);
  const teamId = store.normalizeTeamId(
    method === 'GET' ? (req.query && req.query.teamId) : (req.body && req.body.teamId)
  );
  const passcode = passOf(req);

  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });
  if (!passcode) return json(context, 401, { error: 'missing_passcode' });
  if (throttle.isBlocked(teamId, ip)) return json(context, 429, { error: 'too_many_attempts', message: 'Too many attempts. Wait a few minutes.' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team) return json(context, 404, { error: 'no_such_team', message: 'No team with that ID. Connect once to create it.' });

  const ok = store.safeEqualHex(team.passHash, store.hashPass(passcode, team.salt));
  if (!ok) {
    throttle.recordFail(teamId, ip);
    return json(context, 401, { error: 'bad_passcode', message: 'Wrong team passcode.' });
  }
  throttle.recordSuccess(teamId, ip);

  if (method === 'GET') {
    return json(context, 200, { data: team.data || null, version: team.version || 1 });
  }

  // PUT
  const body = req.body || {};
  const baseVersion = Number(body.baseVersion);
  if (!Number.isFinite(baseVersion)) return json(context, 400, { error: 'missing_base_version' });
  if (typeof body.data === 'undefined') return json(context, 400, { error: 'missing_data' });

  if (baseVersion !== (team.version || 1)) {
    // Stale write → hand back the latest so the client can resolve.
    return json(context, 409, { error: 'conflict', data: team.data || null, version: team.version || 1, updatedAt: team.updatedAt || null });
  }

  const doc = {
    version: (team.version || 1) + 1,
    passHash: team.passHash,
    salt: team.salt,
    data: body.data,
    updatedAt: new Date().toISOString(),
  };
  try {
    await store.writeTeam(teamId, doc, { ifMatch: team._etag });
  } catch (e) {
    if (store.isPreconditionError(e)) {
      // Lost the race at the storage layer → return latest.
      const latest = await store.readTeam(teamId);
      return json(context, 409, { error: 'conflict', data: (latest && latest.data) || null, version: (latest && latest.version) || team.version });
    }
    context.log.error('team write failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  return json(context, 200, { version: doc.version, updatedAt: doc.updatedAt });
};
