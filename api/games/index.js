'use strict';
/*
 * GET /api/games?teamId=..  → { games: [{ gameId, version }] }
 *
 * Lightweight index of a team's games (versions only, from blob metadata) so a
 * client can pull just the games whose version changed. Authorization mirrors
 * /api/team: account members, or the legacy shared passcode.
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
  const ip = throttle.clientIp(req);
  const teamId = store.normalizeTeamId(req.query && req.query.teamId);
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('games: team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team) return json(context, 404, { error: 'no_such_team' });

  const identity = store.identityFrom(req);
  if (store.isAccountTeam(team)) {
    if (!identity) return json(context, 401, { error: 'login_required', message: 'Sign in to access this team.' });
    if (!store.isMember(team, identity.uid)) return json(context, 403, { error: 'not_a_member', message: 'You are not a member of this team.' });
  } else {
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

  let games;
  try {
    games = await store.listGames(teamId);
  } catch (e) {
    context.log.error('games list failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  return json(context, 200, { games });
};
