'use strict';
/*
 * POST /api/invite  { teamId }  → { code, teamId, expiresAt }
 * Any member of an account team can mint an invite code (valid ~14 days).
 * Redeemed via POST /api/accept by another signed-in user.
 */
const store = require('../shared/store');

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function json(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

module.exports = async function (context, req) {
  const identity = store.identityFrom(req);
  if (!identity) return json(context, 401, { error: 'login_required' });

  const teamId = store.normalizeTeamId(req.body && req.body.teamId);
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('invite: team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team || !store.isAccountTeam(team)) return json(context, 404, { error: 'no_such_team' });
  if (!store.isMember(team, identity.uid)) return json(context, 403, { error: 'not_a_member' });

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  let code;
  try {
    code = await store.writeInvite({ teamId, createdBy: identity.uid, expiresAt });
  } catch (e) {
    context.log.error('invite: write failed', e);
    return json(context, 500, { error: 'server_error' });
  }

  return json(context, 200, { code, teamId, expiresAt });
};
