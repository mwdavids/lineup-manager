'use strict';
/*
 * POST /api/join  { teamId, passcode }
 * - First use of a teamId claims it and sets the passcode (hashed).
 * - Subsequent calls validate the passcode.
 * Returns { data, version } (data is null for a brand-new team).
 * The client pushes its local state up after a successful first join.
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

module.exports = async function (context, req) {
  const body = req.body || {};
  const teamId = store.normalizeTeamId(body.teamId);
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  const ip = throttle.clientIp(req);

  if (!teamId) return json(context, 400, { error: 'invalid_team_id', message: 'Team ID must be 2–48 letters, numbers, dashes or underscores.' });
  if (passcode.length < 4) return json(context, 400, { error: 'weak_passcode', message: 'Passcode must be at least 4 characters.' });
  if (throttle.isBlocked(teamId, ip)) return json(context, 429, { error: 'too_many_attempts', message: 'Too many attempts. Wait a few minutes and try again.' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('join read failed', e);
    return json(context, 500, { error: 'server_error' });
  }

  // First use → claim the team + set the passcode.
  if (!team) {
    const salt = store.newSalt();
    const doc = {
      version: 1,
      passHash: store.hashPass(passcode, salt),
      salt,
      data: null,
      updatedAt: new Date().toISOString(),
    };
    try {
      await store.writeTeam(teamId, doc, { ifNoneMatch: '*' });
      throttle.recordSuccess(teamId, ip);
      return json(context, 200, { created: true, data: null, version: 1 });
    } catch (e) {
      if (store.isPreconditionError(e)) {
        // Someone claimed it between our read and write → re-read and validate.
        team = await store.readTeam(teamId);
      } else {
        context.log.error('join create failed', e);
        return json(context, 500, { error: 'server_error' });
      }
    }
  }

  // Existing team → verify passcode.
  const ok = store.safeEqualHex(team.passHash, store.hashPass(passcode, team.salt));
  if (!ok) {
    throttle.recordFail(teamId, ip);
    return json(context, 401, { error: 'bad_passcode', message: 'Wrong team passcode.' });
  }
  throttle.recordSuccess(teamId, ip);
  return json(context, 200, { created: false, data: team.data || null, version: team.version || 1 });
};
