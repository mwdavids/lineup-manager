'use strict';
/*
 * POST /api/accept  { code }  → { teamId, name, version, data }
 * Redeems an invite code: the signed-in user is added to the team's members
 * and the team is added to their user index. Invites are multi-use until they
 * expire, so a whole coaching staff can join from one link.
 */
const store = require('../shared/store');

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

  const code = store.normalizeShareCode(req.body && req.body.code);
  if (!code) return json(context, 400, { error: 'invalid_code' });

  let invite;
  try {
    invite = await store.readInvite(code);
  } catch (e) {
    context.log.error('accept: invite read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!invite) return json(context, 404, { error: 'invite_not_found', message: 'That invite link is invalid or has been removed.' });
  if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
    return json(context, 410, { error: 'invite_expired', message: 'That invite link has expired. Ask for a new one.' });
  }

  const teamId = store.normalizeTeamId(invite.teamId);
  if (!teamId) return json(context, 404, { error: 'no_such_team' });

  let team;
  try {
    team = await store.addMember(teamId, { uid: identity.uid, provider: identity.provider });
  } catch (e) {
    context.log.error('accept: addMember failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team) return json(context, 404, { error: 'no_such_team', message: 'That team no longer exists.' });

  try {
    await store.addTeamToUser(identity.uid, teamId, { displayName: identity.name });
  } catch (e) {
    context.log.error('accept: index update failed', e);
    // Membership succeeded; the team will still appear on next /api/me refresh.
  }

  return json(context, 200, {
    teamId,
    name: team.displayName || teamId,
    version: team.version || 1,
    data: team.data || null,
  });
};
