# Events v2 Phase 1C — first runtime increment

This increment supplies a live navigation adapter, not completion of Phase 1 or an operational Events UI. Other motor/interaction/media/export commands remain blocked. Stage start/finish, rehearsal runs, preparation/version ownership, Screen/Signal models, durable command IDs and engine restart recovery remain later work.

## Boundary and execution

`EventLiveRuntime` shares the slide reducer used by Presentaciones, without fictitious legacy roles or joining its namespace. States and queues use `evt:{eventId}:live:{liveSessionId}`. Executions sharing a deck have independent indices/revisions. Candidates are installed only after the authorization transaction commits; a failed commit cannot create or advance an engine.

The server has no content reader. Even with the Events flag enabled, joins return `CONTENT_NOT_PREPARED`. There is no fallback to `/decks`, demo content, user decks or client manifests/counts. Phase 2 must supply a trusted private preparation reader accepting server-resolved event/live/activity/stage/deck IDs. Its result must match event/live/deck and include immutable `versionId` and positive `slideCount`. Changing preparation during a run denies access instead of resetting the run. Tests inject scoped fixtures, never published assets.

## Socket protocol

Authenticate through the existing short grant session on `/events-v2`, then:

- `events:live:join {liveSessionId}` checks event, stage/activity/live scope, LIVE/not-ended status, active stage, purpose and audience level before accessing content or an engine. Binding is fixed per connection; changing runs requires reconnect.
- `events:live:snapshot {}` returns the current authorized projection.
- `events:slide:next {}`, `events:slide:prev {}`, `events:slide:go {slideIndex}` allow Stage/Speaker navigation. PLAYER can only next/prev; Público cannot control. `go` accepts a nonnegative safe integer and clamps to the last slide.
- `events:presentation:pause {}`, `events:presentation:play {}` allow Stage/Speaker only. Paused navigation keeps the live index. Only the controller kind that paused navigates while paused, matching current presentation semantics. Play publishes the presenter index.

Acks: `{ok:true,snapshot}` or `{ok:false,code}`. `events:live:state` publishes snapshots. Payloads reject extra fields and changes of execution. Unknown families remain `COMMAND_NOT_ENABLED`.

Stage/Speaker receive live and presenter indices, count and pause ownership. PLAYER/Público receive event/live IDs, revision, visible index and paused flag only. No presenter preview, script, manifest, asset paths, answers, participant lists or grant secrets. FREE cannot enter a PAID activity; current DB level is checked after access changes.

No room broadcast is used for state. Every recipient is checked in SQL against its fixed binding at send time under the organization lock used for revoke. Idle reviews check the live resource and preparation. Reconnect restores the same in-process execution/identity without starting a run or inserting attendance. Single-instance in-memory state does not provide durable restart recovery, multi-instance ordering or idempotent retries.

## Verification and next steps

Real Better Auth/HTTP/SQL/Socket.IO tests with private fixtures cover denial before content/engine, cross-event and same-event scopes, rehearsal/live separation, typed permissions, fixed binding, preview privacy, FREE/PAID, same-deck isolation, parallel commands, reconnect, revoke, finished resources, changed versions and injected DB outage. Shared reducer regression and commit failure have focused tests. MySQL/MariaDB CI and Temporal validation are required.

`show.immersalive.com` is the intended public hostname. DNS is not needed for this increment. That step follows a reviewable portal/deployment target and host-only credential, origin and HTTPS checks.
