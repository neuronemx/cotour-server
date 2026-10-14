# Events v2: Stage lifecycle (Phase 1C)

Only an active `STAGE` grant with `purpose=live` controls lifecycle in its assigned virtual Stage. An account Admin/Producer, Speaker, Player, Venue, Moderator or participant is not implicitly Stage. No client role or combined resource IDs expand this scope. Presentaciones keeps its own lifecycle unchanged.

HTTP uses the fixed HttpOnly host-only grant cookie and strict same-origin checks for mutations:

- `GET /api/events-v2/access/:eventId/:grantId/live-session`: Stage's current LiveSession metadata or null; no preparation/engine creation.
- `POST .../activities/:activityId/start` with `{}`: server generates the new LiveSession UUID. The activity and active Stage must belong to this event and grant. Activity must be SCHEDULED, with an approved `deck_id` and DECK_CHECK; pending/personal Deck fallback is forbidden. The private preparation reader validates the candidate in the authorization transaction. Missing production reader fails closed and rolls back the candidate. Response 201 follows commit; only then is the initial runtime state installed.
- `POST .../live-sessions/:liveId/finish` with `{}`: canonical event/activity/Stage chain, same organization authorization lock and execution queue as runtime commands. LIVE becomes FINISHED with server time, activity returns to SCHEDULED. This does not finish the whole Event or shorten its grant window. A repeat finish reauthorizes and returns the original terminal timestamps without modifying a newer run.

SQL authorization, mutation and minimal security audit share the transaction. Concurrent starts serialize under the organization lock and only one LIVE session is accepted per Stage through this service; separate Stages/events remain independent. Existing schema is reused, no migration or alternate Live ID source. No guarantee is claimed for direct SQL writers or the deferred multi-instance Command Service.

Socket names: `events:lifecycle:current` (`{}`), `events:lifecycle:start` (`{activityId}`), `events:lifecycle:finish` (`{}`). Start requires an unbound socket; finish uses the fixed current live binding. After starting, join with `events:live:join`. After finishing, open a fresh connection to operate another LiveSession; no accumulating bindings or restored rooms. Both HTTP and sockets call the same lifecycle service and revalidate persistent credentials each time.

After confirmed finish, per-execution live/poll/game/time/AV memory, scheduled engine timers and controller witnesses are discarded. Persisted Q&A, Knowledge, raffle snapshots and reaction aggregates remain historical data; no fictitious calculated results, attendance or poll history are synthesized. A failed commit preserves state/timers and sends no success or terminal notification. Missing preparation does not prevent authorized cleanup of an existing run.

Targeted terminal metadata `events:lifecycle:finished` contains only event/live IDs and FINISHED status. Connected recipients bound to that run (including fixed Player grants) disconnect; other runs and unbound Stage/Speaker/participant connections stay usable. Every later command/private asset request still checks LIVE state in SQL; an old socket cannot resurrect the run. Credentials that span the event/activity retain their scheduled grant window. The browser terminal/Fallback UI is deferred; previously buffered media bytes cannot be erased by finish.

The public feature remains off. Private production preparation/ownership/readers, start/finish consoles, durable versioned Command Service, recovery, general idempotency and distributed coordination remain later work. This is a functional authorization increment, not a complete operational deployment or capacity certification.
