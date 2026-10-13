# Events v2 Phase 1C — live poll adapter

Second runtime increment, stacked on the live navigation adapter. Phase 1C is still open: Q&A, knowledge activities, raffle, games, timers/media/overlays and HTTP/media/export adapters remain separate work. No operational UI or production content is enabled.

## Shared engine and transaction boundary

The adapter uses the existing `InteractionStore` normalization, vote, aggregation, visibility and close semantics. It never attaches legacy socket handlers, invents legacy roles, or writes the legacy store. A separate store per event + LiveSession runs under the same queue as navigation. Each command clones the previous store and installs the candidate only after SQL authorization commits. Commit failure or kill switch leaves the prior engine untouched.

Only single-choice `poll` definitions are accepted in this increment. A trusted private catalog reader must match event/live/deck/version; definitions have bounded IDs/text/options and duplicate options are rejected. Normalization removes arbitrary private fields. A normalized catalog digest prevents changed definitions from silently replacing content within an active preparation version. No public deck or client definition fallback. The server has no private preparation/catalog reader: Events stays disabled and CONTENT_NOT_PREPARED. Tests supply scoped fixtures only.

## Commands on /events-v2

After the fixed authorized `events:live:join {liveSessionId}`:

- `events:poll:snapshot {}`: authorized projection.
- `events:poll:launch {interactionId}`: Stage/Speaker/PLAYER, server catalog only. Returns a new `pollRunId`. A second active poll is rejected.
- `events:poll:submit {pollRunId,optionId}`: PARTICIPANT only. Actor ID is derived from its grant, never submitted by the client. One vote per participant per launch, including simultaneous browser windows or reconnect.
- `events:poll:show`, `events:poll:hide`, `events:poll:close`, each `{pollRunId}`: Stage/Speaker/PLAYER. This supplies the complete poll emergency cycle for the technical Player function without granting Stage or unrestricted navigation permissions.

Acks are `{ok:true,snapshot}` or `{ok:false,code}`; `events:poll:state` sends the projection. Shape allowlists reject event, live, deck, role and participant overrides. Run IDs distinguish repeated launches of the same poll; stale close/vote/visibility commands never apply to a new launch. Raw legacy interaction commands remain blocked.

Stage/Speaker receive active definition, available IDs/titles and aggregate results. PLAYER receives the minimal available IDs/titles for emergency operation, the active question and aggregate results only while visible; internal active/result titles are omitted. Público gets the active question/options and only its own choice/receipt. It receives no catalog, aggregate results, other votes/identities, scripts, answers, paths or raw metric snapshots. Results default visible on Player, preserving the current engine behavior.

Every join, command, read and recipient send validates the current grant and live resource in SQL. FREE cannot enter PAID, including a level change while connected. Revoke, resource finish, outage and kill switch deny emission/mutation. Catalog/preparation/version checks precede poll state access. Idle reviews validate without emitting or creating an engine. Unimplemented families remain blocked; the cross-motor exclusivity coordinator is extended as those adapters are delivered.

## Limits

In-memory, single-instance state. Reconnect restores identity and current in-process poll/vote; full process restart recovery and durable poll metrics are not supplied. Closed snapshots are retained by the existing engine but no Events export/persistence route is enabled. Durable commands, delivery guarantees and multi-instance coordination belong to Phase 3. Private deck ownership/preparation/catalog publication belongs to Phase 2.

Real Better Auth, SQL and Socket.IO tests cover complete Player/Stage/Speaker/Público cycles, concurrent launch, duplicate vote from two connections, actor-derived identity, private projections, stale run IDs, invalid option/forged participant, raw legacy command denial, same-deck/poll isolation across executions/events, reconnect, revoked recipients, FREE/PAID transition, outage, kill switch and finished resource. Focused tests cover normalization and commit failure on launch/vote/close. CI and Temporal evidence must be recorded against the final SHA.

DNS for show.immersalive.com is still not needed. Notify Arturo when the portal/deployment target reaches the hostname/origin/HTTPS configuration step.
