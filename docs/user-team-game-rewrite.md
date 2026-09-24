# User → Team → Game Rewrite

Status: in progress · Scope: `index.html` client + `api/` (Azure Functions) + Azure Blob storage

Goal: replace today's muddy hybrid model (passcode **or** account teams, whole-app
state serialized into one blob per team) with a clean, login-first hierarchy:

```
User  (Microsoft account — login required)
  |
Team  (owned by a user, shareable with other coaches)
  |
Game  (belongs to a team; its own record)
```

This keeps the single-file, no-build PWA client and stays on Azure Static Web Apps +
Functions + Blob storage. It restructures the data model underneath, it does not
introduce a build step or a new framework.

## Decisions (agreed)

- **Login required.** Sign in once while online with a Microsoft account. After that,
  cached credentials (SWA auth cookie) + cached data allow **full offline use** on the
  sideline. No live login needed every launch.
- **Incremental refactor**, not a from-scratch rewrite — keep `index.html` + no-build PWA.
- **Auto-migration.** On first owner login, a legacy passcode team + local-only data is
  converted into an account team; passcode mode is then retired.
- **Players stay on the team** (roster), not separate per-player records. Games are the
  independently-synced child entity.
- **Storage stays on Azure Blob** (fine for 1–3 coaches per team); no Cosmos.
- **Polling stays** for now; realtime (Web PubSub) is a later optional phase.

## Target storage model (entity-scoped Blob)

| Level | Blob | Contents |
|-------|------|----------|
| User  | `users/<hash(uid)>.json` | `{ uid, displayName, provider, teams:[teamId…] }` *(exists today)* |
| Team  | `teams/<teamId>.json` | `{ teamId, name, ownerId, members:[{uid,role,name}], players:[…], prefs, gameIds:[…], version }` |
| Game  | `teams/<teamId>/games/<gameId>.json` | `{ gameId, teamId, opponent, date, availability, plan, pins, edits, version }` |

The team blob no longer embeds `games[]`; each game is its own versioned blob. Two coaches
editing **different games** no longer conflict.

## Phases

1. **Mandatory login gate.** On load: if online and not signed in → blocking login gate
   (Microsoft). If offline → fall back to cached identity + data so the sideline works.
   Retire the passcode connect UI (migration code paths stay).
2. **Stable UUIDs.** `uid()` → `crypto.randomUUID()`; backfill existing ids across
   `availability` / `plan.slots` / `pins` / `edits`.
3. **Entity-scoped storage.** Team blob drops embedded `games[]`; add `api/game/`
   (GET/PUT/DELETE one game) and `api/games/` (list). `store.js` gains per-game
   read/write with its own `version` + ETag.
4. **Entity-aware sync client.** Team doc syncs roster/prefs/members; each game
   pushes/pulls independently with its own version. Polling stays.
5. **Auto-migration.** First owner login converts a passcode team + local data into an
   account team, splits games into per-game docs, marks passcode retired.
6. **Role enforcement.** Enforce owner/editor/viewer server-side on every mutating
   endpoint (fixes today's gap where any member can write).

## Notes / references

- Supersedes the relevant parts of `docs/prime-time-sync-design.md` (this is that doc's
  Phase 3 + role enforcement, plus mandatory login). That doc remains useful background.
- Current client sync lives in `index.html` under the `Sync` object (~line 3526+).
- Current backend: `api/shared/store.js` + folder-per-endpoint Functions
  (`me`, `teams`, `team`, `invite`, `accept`, `members`, `share`, `join`).
