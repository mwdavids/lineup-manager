'use strict';
/*
 * Membership management for account teams.
 *   PATCH  /api/members  { teamId, uid, role }  → { members }   (owner only)
 *   DELETE /api/members  { teamId, uid }         → { removed:true }
 *      - owner removing another member, or a member removing themselves (leave).
 *      - the owner cannot remove themselves here; they delete the team instead.
 * Role is 'editor' or 'viewer'; the owner role is fixed and not reassignable.
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

function membersOut(team) {
  return (team.members || []).map((m) => ({
    uid: m.uid,
    role: m.uid === team.ownerId ? 'owner' : (m.role || 'member'),
    name: m.name || '',
    addedAt: m.addedAt || null,
  }));
}

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();
  const identity = store.identityFrom(req);
  if (!identity) return json(context, 401, { error: 'login_required' });

  const ip = throttle.clientIp(req);
  if (throttle.rateLimit('members', ip, 40, 60 * 1000)) {
    return json(context, 429, { error: 'too_many_requests', message: 'Slow down and try again in a minute.' });
  }

  const body = req.body || {};
  const teamId = store.normalizeTeamId(body.teamId || (req.query && req.query.teamId));
  if (!teamId) return json(context, 400, { error: 'invalid_team_id' });
  const targetUid = String(body.uid || (req.query && req.query.uid) || '');
  if (!targetUid) return json(context, 400, { error: 'invalid_uid' });

  let team;
  try {
    team = await store.readTeam(teamId);
  } catch (e) {
    context.log.error('members: team read failed', e);
    return json(context, 500, { error: 'server_error' });
  }
  if (!team || !store.isAccountTeam(team)) return json(context, 404, { error: 'no_such_team' });

  const myRole = store.roleOf(team, identity.uid);
  if (!myRole) return json(context, 403, { error: 'not_a_member' });

  if (method === 'PATCH') {
    if (myRole !== 'owner') return json(context, 403, { error: 'owner_only', message: 'Only the owner can change roles.' });
    const role = store.normalizeRole(body.role);
    if (!role) return json(context, 400, { error: 'invalid_role', message: 'Role must be editor or viewer.' });
    if (targetUid === team.ownerId) return json(context, 400, { error: 'cannot_change_owner' });
    let res;
    try {
      res = await store.setMemberRole(teamId, targetUid, role);
    } catch (e) {
      context.log.error('members: setMemberRole failed', e);
      return json(context, 500, { error: 'server_error' });
    }
    if (res && res.error) return json(context, res.error === 'not_a_member' ? 404 : 400, { error: res.error });
    return json(context, 200, { members: membersOut(res) });
  }

  if (method === 'DELETE') {
    const isSelf = targetUid === identity.uid;
    if (targetUid === team.ownerId) {
      return json(context, 400, { error: 'cannot_remove_owner', message: 'The owner cannot be removed. Delete the team instead.' });
    }
    // Owners can remove anyone; everyone else can only remove themselves (leave).
    if (myRole !== 'owner' && !isSelf) {
      return json(context, 403, { error: 'forbidden', message: 'You can only remove yourself from this team.' });
    }
    let res;
    try {
      res = await store.removeMember(teamId, targetUid);
    } catch (e) {
      context.log.error('members: removeMember failed', e);
      return json(context, 500, { error: 'server_error' });
    }
    if (res && res.error) return json(context, 400, { error: res.error });
    try {
      await store.removeTeamFromUser(targetUid, teamId);
    } catch (e) {
      context.log.warn('members: unlink failed for ' + targetUid, e);
    }
    return json(context, 200, { removed: true, left: isSelf, members: myRole === 'owner' ? membersOut(res) : undefined });
  }

  return json(context, 405, { error: 'method_not_allowed' });
};
