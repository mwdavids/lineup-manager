'use strict';
/*
 * Per-game entity endpoint (physical split). A game belongs to a team; it is its
 * own versioned blob so two coaches editing different games never conflict.
 *
 * GET    /api/game?teamId=..&gameId=..                  → { gameId, version, game }
 * PUT    /api/game { teamId, gameId, game, baseVersion } → { gameId, version }
 *    - baseVersion 0        → create (409 if it already exists)
 *    - baseVersion === cur  → save, bump version → { version }
 *    - mismatch             → 409 { gameId, version, game } (latest) so the client
 *                             can 3-way merge just that game and retry.
 * DELETE /api/game { teamId, gameId }                    → { deleted:true }
 *
 * Authorization mirrors /api/team: account members (writes require editor+), or
 * the legacy shared passcode (`x-team-pass`).
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
  const gameId = store.normalizeGameId(
    method === 'GET' ? (req.query && req.query.gameId) : (req.body && req.body.gameId)
  );
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });
  if (!gameId) return json(context, 400, { error: 'invalid_game_id' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('game: team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team) return json(context, 404, { error: 'no_such_team' });

  const identity = store.identityFrom(req);
  let role = null;

  // ---- Authorize (same rules as /api/team) ----
  if (store.isAccountTeam(team)) {
    if (!identity) return json(context, 401, { error: 'login_required', message: 'Sign in to access this team.' });
    if (!store.isMember(team, identity.uid)) return json(context, 403, { error: 'not_a_member', message: 'You are not a member of this team.' });
    role = store.roleOf(team, identity.uid);
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

  if (method === 'GET') {
    let doc;
    try {
      doc = await store.readGame(teamId, gameId);
    } catch (e) {
      context.log.error('game read failed', e);
      return json(context, 500, { error: 'server_error' });
    }
    if (!doc) return json(context, 404, { error: 'no_such_game' });
    return json(context, 200, { gameId, version: doc.version || 1, game: doc.game || null, updatedAt: doc.updatedAt || null });
  }

  // ---- writes require editor+ on account teams ----
  if (store.isAccountTeam(team) && !store.canWrite(role)) {
    return json(context, 403, { error: 'read_only', message: 'Your role on this team is view-only.' });
  }

  if (method === 'DELETE') {
    try {
      await store.deleteGame(teamId, gameId);
    } catch (e) {
      context.log.error('game delete failed', e);
      return json(context, 500, { error: 'server_error' });
    }
    return json(context, 200, { deleted: true });
  }

  // ---- PUT ----
  const body = req.body || {};
  const baseVersion = Number(body.baseVersion);
  if (!Number.isFinite(baseVersion)) return json(context, 400, { error: 'missing_base_version' });
  if (typeof body.game === 'undefined' || body.game === null) return json(context, 400, { error: 'missing_game' });

  let existing;
  try {
    existing = await store.readGame(teamId, gameId);
  } catch (e) {
    context.log.error('game read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  const curVer = existing ? (existing.version || 1) : 0;
  if (baseVersion !== curVer) {
    // Stale (or a create racing an existing game) → hand back the latest to merge.
    return json(context, 409, { error: 'conflict', gameId, version: curVer, game: existing ? existing.game : null });
  }

  const nextVer = curVer + 1;
  const doc = { teamId, gameId, version: nextVer, game: body.game, updatedAt: new Date().toISOString() };
  try {
    if (existing) await store.writeGame(teamId, gameId, doc, { ifMatch: existing._etag });
    else await store.writeGame(teamId, gameId, doc, { ifNoneMatch: '*' });
  } catch (e) {
    if (store.isPreconditionError(e)) {
      const latest = await store.readGame(teamId, gameId);
      return json(context, 409, { error: 'conflict', gameId, version: latest ? (latest.version || 1) : 0, game: latest ? latest.game : null });
    }
    context.log.error('game write failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  return json(context, 200, { gameId, version: nextVer, updatedAt: doc.updatedAt });
};
