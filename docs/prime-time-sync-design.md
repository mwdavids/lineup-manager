# Prime-Time Sync & Plan Access — Migration Design

Status: proposal · Owner: TBD · Scope: `index.html` client + `api/` (Azure Functions) + Azure Storage

> **Review note (2026-09) — read before costing this.**
> Reviewed against the current code. The architecture holds up and the phasing is
> genuinely incremental. Three things to correct before acting:
> 1. **The roster field-drop bug is already fixed.** `importSharedRoster` now copies
>    *every* field (`Object.keys(p).forEach`, `index.html` ~2800), not just
>    `foot`+`positions`. Phase 2 no longer needs to "fix the copy path" — see §7.
> 2. **Players/games already have IDs** (`uid('p')`, `uid('g')`). The real defect is
>    that `uid()` is `Math.random().toString(36).slice(2,9)` — 7 random chars, not
>    stable or collision-safe across devices, which is *why* cross-device merge falls
>    back to name matching. Phase 2 is "harden IDs to real UUIDs," not "add IDs."
> 3. **Phase 3 is the cost cliff, not a gentle next step.** "Phases 1–3 with minimal
>    new infra" is true about *Azure services* but hides that #3 is a near-total
>    rewrite of the `Sync` client and every endpoint. See the effort table in §9.
>
> Context for sizing: expected load is **1–3 coaches per team**, so realtime/CRDT
> tiers can stay on free/lowest SKUs. Build for quality, not for scale.

This document describes how to evolve Lineup Manager's current sync/sharing from a
"single JSON blob per team, polled and last-write-wins" model into something that
behaves well for many teams, many concurrent editors, flaky mobile networks, and
guests who only need read access — without a rewrite. It is deliberately **incremental**:
every phase ships on its own and leaves the app working.

---

## 1. Where we are today

**Client** (`index.html`, the `Sync` object)
- Whole app `state` lives in `localStorage` (per-origin) and is the source of truth locally.
- Team sync serializes the **entire** `state` to one JSON document and pushes/pulls it.
- Reconciliation is **polling** (`syncStartPoll`) + optimistic concurrency (numeric
  `version` + blob `ETag`). Conflicts resolve as last-write-wins with an occasional
  manual keep/take merge prompt.
- Two auth models coexist ("hybrid"): legacy **passcode** teams and **account** teams
  (Static Web Apps managed AAD/Microsoft identity).

**Backend** (`api/`, `api/shared/store.js`)
- One blob per team: `teamdata/<teamId>.json` = `{ version, data, ownerId, members[], … }`.
- Per-user team index: `users/<hash(uid)>.json` = `{ displayName, teams[] }`.
- Invites: `invites/<code>.json`. Public read-only shares: `shares/<code>.json`.
- Endpoints (SWA Functions): `join`, `team`, `teams`, `me`, `invite`, `accept`, `share`.

**Known pain points**
1. **"Signed in" ≠ "connected."** Authentication only sets `loggedIn`; a device is not
   syncing until a team is explicitly opened. (Being addressed by the auto-connect change.)
2. **Coarse conflicts.** Two editors touching *different* things (one edits the roster,
   one edits a game) still collide because the unit of sync is the whole `state` blob.
3. **Polling latency + cost.** Every open client re-downloads the full blob on a timer;
   changes appear seconds late and every poll is a full read.
4. **No real offline story.** No service worker; a lost network mid-edit risks a stale
   overwrite on reconnect.
5. **Share ≠ sync.** "Share roster/game" is a one-shot copy. Guests can't get a
   live, read-only view.
   > **Correction:** the field-dropping half of this pain is *already fixed* —
   > `importSharedRoster` carries all player fields today. What remains is (a) the
   > copy is keyed by **name**, not id (`findPlayerByName`), so it still mismerges
   > when two devices use different names for the same player, and (b) there is no
   > *live* read-only view. Scope Phase 6 to those two, not to the field copy.

---

## 2. Goals / non-goals

**Goals**
- Being signed in auto-connects to the right team (returning devices reconnect silently).
- Concurrent edits to *different* entities never conflict; edits to the *same* field
  resolve deterministically without a modal in the common case.
- Changes propagate in ~1s, not on a poll interval, and cost less than full-blob polling.
- Works offline and survives a mid-edit disconnect (queue locally, reconcile on reconnect).
- Guests can open a **read-only** live view via a scoped link; no account required.
- Clear, least-privilege access: owner / editor (coach) / viewer (parent) roles.

**Non-goals**
- Rewriting the planner. The planner keeps consuming a plain in-memory `state`.
- Abandoning localStorage-first. Local remains the fast path and the offline cache.
- A bespoke realtime server we operate 24/7 (prefer managed Azure services).

---

## 3. Target data model (entity-scoped, not one blob)

Split the monolithic `state` blob into independently-syncable **entities**. Each entity
carries its own version/clock so unrelated edits don't collide.

| Entity       | Key                                   | Notes |
|--------------|---------------------------------------|-------|
| Team         | `teams/<teamId>`                      | name, ownerId, members[], roles, settings |
| Player       | `teams/<teamId>/players/<playerId>`   | name, foot, positions[], `avoidGK`, skill, minutesWeight |
| Game         | `teams/<teamId>/games/<gameId>`       | opponent, date, periods, minutes, roster subset |
| Plan         | `teams/<teamId>/games/<gameId>/plan`  | generated assignments (derived; can be regenerated) |
| Preferences  | `teams/<teamId>/prefs`                | planner rules: fairWeight, minPlayFrac, freshness, stability, avoid-GK defaults |

Give every player/game a **stable UUID** (today they get a 7-char
`Math.random().toString(36).slice(2,9)` id via `uid()` — locally unique but neither
collision-safe nor stable across devices, which is exactly why Share-roster falls back
to name-matching). Switch `uid()` to `crypto.randomUUID()` and backfill existing ids.
IDs are the single most important prerequisite for everything below — do this first.

> **Migration caution:** ids are referenced indirectly all over game state —
> `availability{}`, `plan.segments[].slots{}`, `pins{}`, `edits{}` (see `remapGameIds`).
> A backfill must rewrite every one of those maps atomically, not just the `players[]`
> and `games[]` arrays. Note the payload already carries a schema version (`SHARE_V=2`);
> build the migration on that mechanism rather than inventing a new one.

Storage stays in Blob for phase 1–2. If/when query needs grow (list games across teams,
audit history), move entities to **Azure Cosmos DB** (partition key = `teamId`), which
gives per-item ETags, TTL, and change feed for free.

---

## 4. Conflict handling

**Phase A — field-level LWW (cheap, ships first).** Move from one blob to per-entity
docs, each with `version` + ETag. Because the unit shrinks to a single player/game/prefs
object, the vast majority of "conflicts" simply disappear. Remaining same-entity races
resolve last-write-wins per entity, with the existing keep/take prompt as the rare fallback.

**Phase B — CRDT / op-based merge (for true concurrent editing).** For entities that two
coaches realistically edit at once (roster, a single game's lineup), adopt a small CRDT:
- Model each entity as a map of `field -> {value, lamport, actorId}` (a LWW-Element-Map).
- Clients exchange **ops**, not whole documents; the server appends ops to a per-entity
  log and folds them into a materialized snapshot.
- Deterministic merge (highest lamport, tie-break by actorId) means **no user-facing merge
  modal** for concurrent edits to different fields, and a stable winner for the same field.
- Libraries to evaluate before hand-rolling: **Yjs** or **Automerge** (both have mature
  JS implementations and binary update encodings that are small over the wire).

Recommendation: ship Phase A now (low risk, immediate win); adopt Phase B only for roster
and lineup entities where concurrent editing is real. Preferences and team settings can
stay LWW indefinitely.

---

## 5. Realtime transport (replace polling)

Replace `syncStartPoll` with push:
- **Azure Web PubSub** (or SignalR Service) with one **group per team** (`team:<teamId>`).
- On write, the Function publishes a lightweight `{entity, id, version}` **invalidation**
  (not the payload) to the team group. Clients fetch just that entity if their version is
  behind. This keeps messages tiny and avoids trusting broadcast data.
- Clients get a short-lived, **team-scoped** access token from a new `GET /rt-token`
  endpoint that authorizes only that team's group (respecting the caller's role).
- Fallback: if the socket can't connect, degrade to the current poll at a slow interval so
  the app still works on restrictive networks.

Cost/latency: push replaces N clients × full-blob-every-Ns with one small message per
change, delivered in ~1s.

---

## 6. Offline & PWA

- Add a **service worker** to cache the app shell (`index.html` + assets) for offline load,
  and a web app manifest so it installs on phones (also improves the "keep screen awake"
  use case since it runs like an app).
- Keep localStorage-first writes; maintain a **durable outbox** (IndexedDB) of pending ops.
- On reconnect: replay the outbox against current server versions. With Phase B CRDT ops
  this is automatic; with Phase A LWW, replay compares versions and only prompts on a true
  same-entity clash.
- Surface a clear connection state in the UI: `synced` / `syncing` / `offline (N pending)`.

---

## 7. Sharing & plan access (scoped, revocable)

Today's shares are one-shot copies. Add **live, read-only** access without an account:
- `POST /share` returns a scoped, unguessable code that grants **read** on a specific
  entity set — a whole team (viewer), a single game's lineup, or a roster snapshot.
- A shared link opens a **read-only** view (no editor UI, no push token beyond that scope).
- Codes are **revocable** (delete the share blob / mark expired) and support **TTL**
  (e.g. auto-expire a game link after game day). Blob TTL or a Cosmos TTL field handles this.
- Fix the existing copy path regardless: `importSharedRoster` must carry **all** player
  fields (`avoidGK`, `skill`, `minutesWeight`), keyed by player UUID rather than by name.
  > **Status:** the all-fields half is **done** (`importSharedRoster` copies every key).
  > Remaining work here is only the **key-by-UUID** change, which depends on Phase 2.

**Roles** (enforced server-side on every write):
- `owner` — manage members, delete team.
- `editor` (coach) — edit roster, games, prefs, generate plans.
- `viewer` (parent/player) — read team/games/plans; no writes; can hold a scoped link only.

---

## 8. Security

- All mutating endpoints re-derive identity from `x-ms-client-principal` (never trust a
  client-supplied uid) and check `roleOf(team, uid)` before writing — extend the existing
  `isMember`/`roleOf` checks in `store.js` to enforce editor-vs-viewer, not just membership.
  > **Confirmed gap:** `roleOf` exists in `store.js` but the `PUT /api/team` handler only
  > calls `isMember` — any member can write. This is a small, high-value change and is the
  > one piece of §6/§8 worth pulling forward early, independent of the entity split.
- Realtime tokens are short-lived and **team-scoped**; a token for `team:A` can't read `team:B`.
- Share codes are high-entropy, single-scope, revocable, and expiring; GET-by-code only,
  never enumerable.
- Rate-limit `join`/`accept`/`share` to blunt guessing and abuse.
- Keep passcodes hashed+salted (already done) and plan a **passcode→account migration**
  path so the hybrid model can eventually retire.

---

## 9. Phased rollout

Each phase is independently shippable and reversible.

1. **Auto-connect UX (done / in progress).** Signed-in returning devices reconnect to their
   last team silently; first-time single-team devices open with a one-time merge; empty
   state explains what to do. *No schema change.*
2. **Stable IDs + field-complete share.** Assign UUIDs to players/games; fix
   `importSharedRoster` to carry all fields by ID. *Backfill migration for existing state.*
3. **Entity-scoped storage + LWW (Phase A conflicts).** Split the blob into per-entity docs;
   keep polling. Big drop in false conflicts.
4. **Realtime push.** Add Web PubSub invalidations + `/rt-token`; polling becomes fallback.
5. **PWA + offline outbox.** Service worker, manifest, IndexedDB outbox, connection UI.
6. **Scoped read-only shares + roles.** Live viewer links with TTL; enforce editor/viewer.
7. **CRDT for roster & lineups (Phase B).** Op-based merge where concurrent editing is real.
8. **(Optional) Cosmos DB.** Move entities off Blob when query/history/TTL needs justify it;
   retire passcode teams after an account-migration window.

**Suggested first cut:** phases 1–3 deliver most of the felt improvement (auto-connect,
no lost roster fields, and far fewer conflicts) with minimal new infrastructure.

### Effort / cost / risk (review addendum)

Sizes reflect **1–3 coaches per team** — realtime and DB stay on free/lowest tiers.
"New infra $" is *added recurring Azure cost* over today's baseline (SWA Free +
managed Functions + Standard_LRS blob ≈ free).

| Phase | Eng effort | New infra $ | Risk | Notes |
|-------|-----------|-------------|------|-------|
| 1 · Auto-connect | S | none | low | Client-only; no schema change. |
| 2 · Harden IDs + backfill | S–M | none | med | Risk is the id-remap migration (`availability`/`slots`/`pins`/`edits`), not the field copy (done). |
| **3 · Entity split + LWW** | **L** | none | med–high | **The cost cliff.** Near-total rewrite of `Sync` (push/pull/poll/apply all assume one doc + one `version`) + all endpoints + data migration. Biggest correctness win, largest lift. |
| 4 · Realtime push | M | low (Web PubSub/SignalR **Free**: ~20 conn, 20k msg/day — ample for 1–3 coaches) | med | `/rt-token` fits managed Functions; keep poll fallback. |
| 5 · PWA + offline outbox | M (shell) / L (outbox) | none | med–high | Shell cache is cheap; durable IndexedDB outbox + replay is hard under Phase-A LWW. **Sequencing:** wants Phase 7 first — until then, scope 5 to shell caching + manifest only. |
| 6 · Scoped shares + roles | S (roles) / M (live links) | none | low | Server role enforcement is small and high-value — pull it forward (see §8). Live links + TTL straightforward on blob. |
| 7 · CRDT (roster/lineups) | L | none (bundle size cost) | med | Yjs/Automerge; only if real concurrent editing or cross-device undo materializes. At 1–3 coaches, likely **defer**. |
| 8 · Cosmos DB | M | low (free tier: 1000 RU/s, 25 GB, one/subscription) | low | Optional; added ops surface. Justify by query/history/TTL needs, not scale. |

**Given the 1–3 coach load:** do **1, 2, 3, 6-roles**, and probably **4**. Treat **5-outbox,
7, 8** as opt-in — they buy scale and true concurrent editing you don't yet need. Set an
explicit budget ceiling ("stay on free tiers") since these phases *are* the entire recurring bill.

---

## 10. Open questions

- Do we need edit history / undo across devices? (If yes, favor an op-log/CRDT sooner.)
- Expected concurrency per team (2 coaches? a whole club?) — sizes the realtime tier.
- Should viewer links require any gate (email, expiry only), or is unguessable-URL enough?
- Migration UX for existing passcode teams — auto-upgrade on next owner sign-in, or manual?
