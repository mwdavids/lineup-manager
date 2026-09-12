'use strict';
/*
 * GET /api/team?teamId=..      → { data, version, name?, role? }
 * PUT /api/team { teamId, data, baseVersion }  → { version }
 *    - baseVersion === current version → save, bump version → { version }
 *    - baseVersion mismatch → 409 { data, version } (latest) so the client can
 *      prompt keep-mine / take-theirs.
 * Optimistic concurrency is enforced by both the numeric version and the blob ETag.
 *
 * Authorization is hybrid:
 *  - Account teams (they carry ownerId/members[]) authorize by the signed-in
 *    user (Static Web Apps `x-ms-client-principal`) being a member.
 *  - Legacy teams authorize by the shared passcode (`x-team-pass` header).
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
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team) return json(context, 404, { error: 'no_such_team', message: 'No team with that ID. Connect once to create it.' });

  const identity = store.identityFrom(req);

  // ---- Authorize ----
  if (store.isAccountTeam(team)) {
    if (!identity) return json(context, 401, { error: 'login_required', message: 'Sign in to access this team.' });
    if (!store.isMember(team, identity.uid)) return json(context, 403, { error: 'not_a_member', message: 'You are not a member of this team.' });
  } else {
    // Legacy passcode team.
    const passcode = passOf(req);
    if (!passcode) return json(context, 401, { error: 'missing_passcode' });
    if (throttle.isBlocked(teamId, ip)) return json(context, 429, { error: 'too_many_attempts', message: 'Too many attempts. Wait a few minutes.' });
    const ok = store.safeEqualHex(team.passHash, store.hashPass(passcode, team.salt));
    if (!ok) {
      throttle.recordFail(teamId, ip);
      return json(context, 401, { error: 'bad_passcode', message: 'Wrong team passcode.' });
    }
    throttle.recordSuccess(teamId, ip);
  }

  if (method === 'GET') {
    const out = { data: team.data || null, version: team.version || 1 };
    if (store.isAccountTeam(team)) {
      out.name = team.displayName || teamId;
      out.role = store.roleOf(team, identity.uid);
    }
    return json(context, 200, out);
  }

  // ---- PUT ----
  const body = req.body || {};
  const baseVersion = Number(body.baseVersion);
  if (!Number.isFinite(baseVersion)) return json(context, 400, { error: 'missing_base_version' });
  if (typeof body.data === 'undefined') return json(context, 400, { error: 'missing_data' });

  if (baseVersion !== (team.version || 1)) {
    // Stale write → hand back the latest so the client can resolve.
    return json(context, 409, { error: 'conflict', data: team.data || null, version: team.version || 1, updatedAt: team.updatedAt || null });
  }

  // Preserve ownership/passcode metadata; only version/data/updatedAt change.
  const doc = {
    version: (team.version || 1) + 1,
    data: body.data,
    updatedAt: new Date().toISOString(),
  };
  if (store.isAccountTeam(team)) {
    doc.ownerId = team.ownerId;
    doc.members = team.members || [];
    doc.displayName = team.displayName || teamId;
  } else {
    doc.passHash = team.passHash;
    doc.salt = team.salt;
  }
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
