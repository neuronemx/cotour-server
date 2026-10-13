# Events v2 Phase 1C — Q&A adapter

Third runtime increment. Reuses QnaRepository for question validation, ten-second participant cooldown, selection, projection/answered status, deletion protection and round archiving. Default Presentaciones storage/transactions remain unchanged. Events uses a fixed, allowlisted storage mode and the same DB connection/transaction that authorizes its grant; no nested transaction or pool connection. Events lifecycle/history/export calls on this repository are explicitly blocked.

## Storage and scope

Migration 039 adds four re-runnable tables: event_v2_qna_sessions, rounds, questions and projection. Context ID is the existing canonical LiveSession ID, FK-backed to live/stage/activity; question actors FK to internal participants. No legacy presentation_sessions or qna_* rows are created. Every operation resolves event/live/stage/activity/access scope before Q&A SQL and checks the prepared deck/version against the stored immutable binding. SQL table FKs are complemented by current server relationship checks; cross-event/same-event scope changes deny access before data emission.

Reads, review and reconnect do not initialize or replace a round. Explicit authorized `open` creates one context/round atomically, initially accepting questions. Repeating open returns the same state; it never changes a closed intake setting or resurrects a hidden projection. Existing round/selection/answered/projection data survive reconstruction of this adapter. This does not demonstrate full live-engine process restart recovery, private content publication, durable command idempotence or multi-instance operation.

## Protocol

On /events-v2 after fixed authorized live join:

- events:qna:snapshot {}
- events:qna:open {} — Stage/Speaker/PLAYER; first activation only initializes.
- events:qna:set_open {roundId,open:boolean} — intake setting.
- events:qna:submit {roundId,question,allowNameOnScreen:boolean,name?} — PARTICIPANT only, actor derived from grant.
- events:qna:select/project/delete {roundId,questionId} — control functions.
- events:qna:new_round {roundId} — archive old, preserve intake, clear projection.
- events:qna:panel_close {roundId} — clear projection, preserving intake/history.

Acks `{ok:true,snapshot}` or `{ok:false,code}`; events:qna:state publishes authorized projections. Payload allowlists reject role/event/live/deck/participant overrides. Current round IDs reject stale packets. PLAYER gets the full Q&A emergency command cycle within its live scope, without a Stage role or unrestricted slide controls. No keyboard/menu frontend is delivered here.

Stage/Speaker get the operational question list, selection and projected question. PLAYER receives generic `Pregunta N` candidates with IDs/answered flags; no unprojected text, names or inbox. Only the projected question's text and explicitly consented name appear in its Screen projection. Público receives only intake/current round and its own receipt/cooldown plus its own saved displayName; no question queue, other names/identities, selection, Screen data, scripts or answers.

The registered event name supplies the submission default. Nonblank correction updates that participant's saved name in the same transaction; blank fields never overwrite it. Failed/closed/cooldown/stale submissions roll back name changes too. Each question preserves its name and consent at submission; later profile corrections do not rewrite older questions. No external registration linkage/import or inferred attendance.

Every command/read and each recipient send rechecks grant, resource, level and preparation. FREE→PAID, revoke, finish and DB outage deny delivery/write. Closing the panel and reopening cannot redisplay a previously hidden question. Q&A may remain open alongside a poll; both use the same execution command queue and retain separate state.

## Verification and limits

Real Better Auth/HTTP/SQL/Socket.IO cases cover migration recovery, reads without setup, concurrent initialization, an injected failure before COMMIT with rollback of setup/question/name, two-window cooldown, name correction/reconnect/blank protection, consent/private projections, complete Player cycle, closed intake, delete protection, new round/stale packets, poll coexistence, repository reconstruction, legacy history isolation, cross-run/event scopes, forged identity/legacy commands, revoke/FREE→PAID/outage/finish. Focused checks prove transaction executor and storage allowlist plus existing Q&A regression. CI and a separate Temporal pilot must be recorded per final SHA.

Server private preparation/catalog readers remain absent; public v2 is off. Other motors/interactions and HTTP/media/export adapters still need coverage before Phase 1 completion. Retry idempotence, uncertain commit outcomes, full restart recovery, version publication and distributed coordination retain their later phases. show.immersalive.com does not require DNS yet; Arturo is notified at the portal/hostname/origin/HTTPS step.
