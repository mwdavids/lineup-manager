'use strict';
/*
 * POST /api/teams  { name }  → { teamId, name, version, data:null }
 * Creates a new account-owned team for the signed-in user and adds it to
 * their user index. The creator is the owner (and first member).
 */
const store = require('../shared/store');

function json(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

function cleanName(n) {
  const s = (typeof n === 'string' ? n : '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 60);
}

module.exports = async function (context, req) {
  const identity = store.identityFrom(req);
  if (!identity) return json(context, 401, { error: 'login_required' });

  const name = cleanName((req.body && req.body.name)) || 'My team';

  // Generate a fresh, unclaimed team id (retry on the astronomically rare clash).
  let teamId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = store.genTeamId();
    const doc = {
      version: 1,
      ownerId: identity.uid,
      members: [{ uid: identity.uid, provider: identity.provider, role: 'owner', addedAt: new Date().toISOString() }],
      displayName: name,
      data: null,
      updatedAt: new Date().toISOString(),
    };
    try {
      await store.writeTeam(candidate, doc, { ifNoneMatch: '*' });
      teamId = candidate;
      break;
    } catch (e) {
      if (store.isPreconditionError(e)) continue; // id taken → new id
      context.log.error('teams: create failed', e);
      return json(context, 500, { error: 'server_error' });
    }
  }
  if (!teamId) return json(context, 500, { error: 'team_id_exhausted' });

  try {
    await store.addTeamToUser(identity.uid, teamId, { displayName: identity.name });
  } catch (e) {
    context.log.error('teams: index update failed', e);
    // The team exists; the client can still open it, but report soft failure.
  }

  return json(context, 200, { teamId, name, version: 1, data: null });
};
