'use strict';
/*
 * POST /api/invite  { teamId }  → { code, teamId, expiresAt }
 * Any member of an account team can mint an invite code (valid ~14 days).
 * Redeemed via POST /api/accept by another signed-in user.
 */
const store = require('../shared/store');
const throttle = require('../shared/throttle');

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

  const ip = throttle.clientIp(req);
  if (throttle.rateLimit('invite', ip, 20, 60 * 1000)) {
    return json(context, 429, { error: 'too_many_requests', message: 'Slow down and try again in a minute.' });
  }

  const teamId = store.normalizeTeamId(req.body && req.body.teamId);
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });

  // Optional role for the invitee: 'editor' (default) or 'viewer'. Only the
  // owner may hand out invites that grant edit rights; any member can invite a
  // view-only parent.
  const wantRole = (req.body && req.body.role) ? store.normalizeRole(req.body.role) : 'editor';
  if (!wantRole) return json(context, 400, { error: 'invalid_role' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('invite: team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team || !store.isAccountTeam(team)) return json(context, 404, { error: 'no_such_team' });
  if (!store.isMember(team, identity.uid)) return json(context, 403, { error: 'not_a_member' });

  // Only the owner can mint an editor invite; non-owners may only invite viewers.
  const role = (wantRole === 'editor' && store.roleOf(team, identity.uid) !== 'owner') ? 'viewer' : wantRole;

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  let code;
  try {
    code = await store.writeInvite({ teamId, createdBy: identity.uid, role, expiresAt });
  } catch (e) {
    context.log.error('invite: write failed', e);
    return json(context, 500, { error: 'server_error' });
  }

  return json(context, 200, { code, teamId, role, expiresAt });
};
