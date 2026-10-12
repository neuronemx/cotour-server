# Events v2 — Phase 1A domain and HTTP boundary

Implemented behind `IMMERSA_EVENTS_V2_ENABLED=true`; disabled by default.
This increment provides organizations, events, explicit memberships and
ADMIN/PRODUCER preparation permissions. It does not enable live Events v2,
operational grants, public registration, decks, Venue, Muro or Screen models.

The canonical Event id remains `event_hubs.workspace_id`. Migration 037 adds
`event_v2_contexts`, a one-to-one authorization extension (no duplicate event
title/slug/status), plus organization and membership tables. Using a separate
extension avoids ALTER operations on legacy tables and makes recovery from
partially completed DDL safe with CREATE TABLE IF NOT EXISTS. Existing hubs
are not assigned to organizations automatically.

The new router is `/api/events-v2`. Account identity comes from Better Auth;
workspace plans and client-supplied roles are never event authorization.
Organization creation/creation entitlement are platform-admin actions; the
platform admin gets no operational membership automatically. Creation is
disabled until explicitly enabled for a pilot or approved contract. This
boolean is a temporary pilot gate, not commercial billing/entitlements.

An event is created as DRAFT without physical stages or public QR. Its creator
gets explicit Event ADMIN membership. ADMIN delegates and prepares; PRODUCER
prepares but cannot delegate. Unsupported operational roles are rejected until
their scopes are implemented. Agreed later scopes: Muro per event, Venue all
Venue screens of the event (no extra general-interaction permission), Stage
per virtual stage with multiple screens. Links will cover creation/setup/tests
through the complete event, including multiple days; there is no 12-hour cap.

Read/write methods validate organization and event membership in a SQL
transaction. Writes lock the organization before checking actor and resource;
membership revocation uses the same order. Composite foreign keys prevent
cross-organization event memberships. Revoking organization membership also
deactivates event memberships; restoring the organization membership does
not resurrect those event permissions. Transfer the last active Admin before
removal. Event routes reject unknown/ownership/actor fields in request bodies.

The legacy boundary is ALWAYS active when a database is configured, even if
the v2 feature flag is disabled. It excludes v2 hubs from legacy lists and
blocks v1 event, stage, activity, live, public QR, linked deck and asset paths.
Legacy access links and Socket.IO joins also reject v2-linked execution or
content BEFORE runtime state creation. No v2 live route falls through to v1.
This does not retrofit grants into personal Presentations; their defaults,
role cookies, public links and existing behavior remain unchanged.

Validation: existing suite, authorization unit tests, and mandatory CI job
`Events v2 database and access isolation`. That job uses disposable MariaDB
11.4 and a test DB explicitly named `events_v2_test`; it runs migrations,
real Better Auth sign-up/sign-in sessions, HTTP requests, Socket.IO clients,
revocation, cross-org/event attacks, constraints and rollback checks. No test
uses the runtime DB by default. Target-runtime version parity still needs
confirmation before Temporal testing; this fixture is not that evidence.

## Temporal and rollback

Deploy an exact green commit only in Temporal. Run migration before startup;
keep the flag disabled until explicitly enabling a pilot organization.
The metadata endpoints provide backend foundations, not the Production UI.
Record deploy SHA, migration logs and Presentations smoke separately.

Disable the feature flag to close v2 endpoints; the legacy deny boundary must
remain. Keep additive tables and permissions inert; do not DROP data.
Do not redeploy pre-1A code on a DB containing v2 hubs: that code would ignore
the extension and expose them to old routes/listings. Keep this boundary in
the rollback build, or back up and remove all pilot v2 resources from legacy
tables before using pre-1A code. No Beta/Production merge or deployment is
authorized by this increment.
