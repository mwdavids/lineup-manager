'use strict';
/*
 * GET /api/me  → { user:{uid,name,provider}, teams:[{id,name,version,updatedAt,role}] }
 * Lists the teams the signed-in user belongs to (from their user index).
 * Requires a Static Web Apps authenticated principal.
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

  let user;
  try {
    user = await store.readUser(identity.uid);
  } catch (e) {
    context.log.error('me: user read failed', e);
    return json(context, 500, { error: 'server_error' });
  }

  const ids = (user && Array.isArray(user.teams)) ? user.teams : [];
  const teams = [];
  for (const id of ids) {
    let t;
    try {
      t = await store.readTeam(id);
    } catch (e) {
      context.log.warn('me: team read failed for ' + id, e);
      continue;
    }
    if (!t || !store.isMember(t, identity.uid)) continue; // pruned/removed
    teams.push({
      id,
      name: t.displayName || id,
      version: t.version || 1,
      updatedAt: t.updatedAt || null,
      role: store.roleOf(t, identity.uid),
    });
  }

  return json(context, 200, {
    user: { uid: identity.uid, name: identity.name, provider: identity.provider },
    teams,
  });
};
