# Events v2 — Phase 1B authorization perimeter

Stacks on Phase 1A. Main/legacy Presentations keeps its authorization and
runtime. `IMMERSA_EVENTS_V2_ENABLED` remains false by default; the new
`/events-v2` namespace and `/api/events-v2/access`/`public` fail closed.

Migration 038 adds an operational event end, hashed grants, short socket
sessions and optional participant names. It is additive and re-runnable
after partial DDL; no existing hub, user or credential is migrated. The end
must be an explicit ISO instant including Z or a UTC offset. The event's
existing timezone supplies the UI display convention. No arbitrary 12h cap.

Admin may explicitly issue STAGE (one virtual stage), VENUE (whole event),
MODERATOR (whole event), PLAYER (existing LiveSession), and SPEAKER (one
activity). Producer may issue only SPEAKER live/rehearsal. This is delegation
of that function; ADMIN/PRODUCER themselves do not gain operational control.
There are no human per-Screen permissions or extra general Venue permission.
The technical PLAYER scope will be extended to signals in Phase 4.

Every resource relationship is checked inside the authorization transaction:
event, active stage, activity's stage, LiveSession's stage/activity, or
participant's event and active QR level. Resource IDs, client roles, rooms,
participant IDs and access levels cannot change effective identity. Typed
columns/FKs and CHECKs prohibit malformed grants; current resource ownership
is also rechecked in SQL on every access, including cross-event relations.

Links carry a random 32-byte secret, stored only as SHA-256. API issuance
returns it once. A future client puts the secret in a fragment, exchanges via
POST, clears the fragment, and never persists it in localStorage or logs it.
1B supplies the backend protocol, not a new link landing UI or consoles.

HTTP canje uses a per-grant host-only __Host cookie: Secure, HttpOnly,
SameSite=Strict, Path=/, expires at the event end. Cookies for different actors
or events do not overwrite each other. Short socket credentials expire after
15 minutes or at event end, whichever is earlier. Same-origin POST `/renew`
uses the long HttpOnly cookie to mint a new short credential even after sleep
past the short TTL; an active socket can renew its short session. Renewal
keeps actor/scope and the original grant window. A future client renews before
expiry and uses the cookie endpoint on reconnect; no manual daily renewal.
After an event-end extension, online renewal refreshes the browser cookie end.
An offline browser whose cookie reaches the old end must reopen the original
operational link; an HTTP response cannot extend a cookie in an offline device.

Changing event end updates active unrevoked grants transactionally. Already
expired/revoked grants stay invalid. Grant access always rechecks the current
event window, organization/context, resources, issuer membership versions and
issuer's current delegation permission. Restoring membership does not revive
grants from its old version. Revocation is persistent and idempotent.

The organization lock is acquired before authorization reads. Locator queries
finish before a transaction obtains a connection, avoiding stale REPEATABLE
READ snapshots and nested pool starvation. Read callbacks and the initial
socket snapshot execute under the same lock used by revocation.

The namespace exposes only minimal authorized identity metadata and context
read/short-session renewal. Stage/Speaker/Player scopes and rehearsal purpose
are persisted, but no presentation snapshot, deck, media, scripts, answers,
engines, metrics or attendance are loaded. Unknown commands are denied.
Rehearsal does not join a live room. Reconnect revalidates from DB and preserves
actor; it neither registers again nor creates a LiveSession/attendance.
Connection-state recovery that skips fresh authorization is not supported.

On explicit grant revocation, sockets disconnect after commit. Membership
changes and end edits request a fresh review. Idle sockets are revalidated at
most every 5 seconds, including short/grant expiry, scope changes, kill switch
or DB outage. Sensitive reads/renewals revalidate immediately. This is a single
instance guarantee; distributed invalidation is required before scaling.

Public admission uses an existing event v2 QR, derives FREE/PAID server-side,
creates a participant and credential, and returns only the short session.
The long secret goes into the HttpOnly cookie. No account/email requirement;
name is optional. QR creation/program/admission UI and commercial access
remain later work. Client changes of identity/level are rejected. Participant
identity survives reconnect; possession of a participant UUID never suffices.

## Protocol

Administrative paths start `/api/events-v2/organizations/:orgId/events/:eventId`:

- `PUT /operational-window` `{endsAt}` — Admin/Producer preparation.
- `POST /grants` `{kind,purpose,stageId|activityId|liveSessionId}` — typed scope.
- `DELETE /grants/:grantId` — Admin, persistent revoke.

Access does not require an account:

- `POST /api/events-v2/access/exchange` `{eventId,token}` — sets grant cookie;
  returns minimal context, short `sessionToken`, `sessionExpiresAt`.
- `GET /api/events-v2/access/:eventId/:grantId/context` — grant cookie only.
- `POST .../:eventId/:grantId/renew` `{}` — grant cookie and same Origin.
- `POST /api/events-v2/public/:publicId/participants` `{name?}` — QR admission.
- Socket `/events-v2`, auth `{eventId,grantId,sessionToken}` and same Origin.
  `events:context` initial metadata; `events:context:get` `{}` with ack;
  `events:session:renew` `{}` with ack. No client-selected rooms or context swaps.

## Validation and rollback

CI runs real Better Auth, HTTP, Socket.IO and migrations in disposable MySQL
9.7.2 (verified Temporal version) and MariaDB 11.4. It tests grant scope, secrets,
origins/cookies, short vs link expiry, issuer dependency revocation, active/idle
disconnect, reconnect/process reconstruction, participant identity/level, DB
outage, kill switch and partial-DDL recovery without unauthorized mutations.

Temporal validation uses a separate disposable schema and loopback harness,
not its functional DB. A feature-off deployed check remains required. No
Beta/Production merge or deploy is authorized. Rollback disables v2 and retains
1A's legacy deny boundary and inert additive tables. Never run pre-1A code
over active v2 rows. Phase 1C will authorize all runtime commands and reads
before any operational content/controller is enabled.
