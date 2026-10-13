const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { executionKey } = require('../../events-v2/live-runtime');
async function gameTimeSuite(t, f) {
  const { request, sql, grants, domain, base, o1, a, b, stageA, activityA, activityB, publicId, gameRuntime, timeRuntime, preparations } = f;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID(), key = executionKey(a, live);
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'games-version', slideCount: 5,
      games: [{ id: 'breakout', durationMs: 1000 }, { id: 'pong', durationMs: 1000 }],
      raffles: [{ id: 'free', mode: 'free', title: 'Raffle', prompt: 'Enter', options: [] }],
      knowledge: [{ id: 'trivia', category: 'contest', title: 'Trivia', identificationMode: 'anonymous', questionDurationSeconds: 5,
        questions: [{ id: 'q', prompt: 'Choose', correctOptionId: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] }],
      polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] });
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  let clock = 0; const advanceClock = offset => { clock = offset; f.setGameClockOffset(clock); }; advanceClock(0);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, event, payload = {}) => { const diagnostic = new Error(`game/time ack failed: ${event}`); return new Promise((resolve, reject) => {
    if (!client.connected) return reject(Object.assign(diagnostic, { cause: new Error('disconnected') }));
    client.timeout(7000).emit(event, payload, (error, reply) => error ? reject(Object.assign(diagnostic, { cause: error })) : resolve(reply));
  }); };
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  async function issue(kind, fields, event = a) {
    const result = await request('admin1', 'POST', `/api/events-v2/organizations/${o1}/events/${event}/grants`, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(result.status, 201);
    const exchange = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: result.body.token }); assert.equal(exchange.status, 200); return exchange.body;
  }
  async function register(name) { const reply = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(reply.status, 201); return reply.body; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE', participantId: 'forged', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.add(client);
    await new Promise((resolve, reject) => { const handle = setTimeout(() => reject(new Error('game context timeout')), 7000); client.once('events:context', () => { clearTimeout(handle); resolve(); }); client.once('connect_error', error => { clearTimeout(handle); reject(error); }); });
    const joined = await ack(client, 'events:live:join', { liveSessionId: liveId }); assert.equal(joined.ok, true, JSON.stringify(joined)); return client;
  }
  const command = (client, action, payload = {}) => ack(client, `events:game:${action}`, payload);
  async function snap(client) { const reply = await command(client, 'snapshot'); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.snapshot; }
  async function timing(client) { const reply = await ack(client, 'events:time:snapshot'); assert.equal(reply.ok, true); return reply.snapshot; }
  async function controlTime(client, payload) { const reply = await ack(client, 'events:time:control', { expectedRevision: (await timing(client)).revision, ...payload }); return reply; }
  async function queueCommand(client, action, payload = {}) { const current = await snap(client); return command(client, action, { expectedRevision: current.revision, ...(['skip', 'end'].includes(action) ? { queueRunId: current.queueRunId } : {}), ...payload }); }
  function faultyGrants() {
    const broken = new EventDomainRepository(domain.pool);
    broken.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('GAME_TEST_COMMIT_FAILURE'); } finally { await db.rollback(); db.release(); } };
    return new EventGrantRepository(broken, { now: f.now });
  }
  const gone = client => !client.connected ? Promise.resolve() : new Promise((resolve, reject) => { const handle = setTimeout(() => reject(new Error('game disconnect timeout')), 7000); client.once('disconnect', () => { clearTimeout(handle); resolve(); }); });
  let stageSession, playerSession, publicSession, bobSession, stage, speaker, player, attendee, bob, secondClient, foreignClient, gameId;
  const legacyBefore = (await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n;
  await t.test('Games and Time idle reads do not initialize state; typed grants deny public controls before reading content', async () => {
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); playerSession = await issue('PLAYER', { liveSessionId: live }); player = await connect(playerSession);
    publicSession = await register('Game Alice'); attendee = await connect(publicSession); bobSession = await register('Game Bob'); bob = await connect(bobSession);
    assert.equal((await snap(player)).game, null); assert.equal((await timing(player)).screen.visible, false);
    assert.equal(gameRuntime.states.has(key), false); assert.equal(timeRuntime.states.has(key), false);
    assert.equal((await command(attendee, 'configure', { expectedRevision: 0, selected: ['pong'] })).code, 'GAME_COMMAND_DENIED');
    assert.equal((await ack(attendee, 'events:time:control', { expectedRevision: 0, target: 'speaker', action: 'start' })).code, 'TIME_COMMAND_DENIED');
    assert.equal(gameRuntime.states.has(key), false); assert.equal(timeRuntime.states.has(key), false);
  });
  await t.test('Games/Time candidates roll back on commit failure; concurrent queue starts serialize to one run', async () => {
    await assert.rejects(gameRuntime.operate(faultyGrants(), credentials(stageSession), live, 'configure', { expectedRevision: 0, selected: ['breakout', 'pong'] }), /GAME_TEST_COMMIT_FAILURE/);
    await assert.rejects(timeRuntime.operate(faultyGrants(), credentials(stageSession), live, { expectedRevision: 0, target: 'speaker', action: 'start' }), /GAME_TEST_COMMIT_FAILURE/);
    assert.equal(gameRuntime.states.has(key), false); assert.equal(timeRuntime.states.has(key), false);
    const configured = await queueCommand(stage, 'configure', { selected: ['pong', 'breakout'] }); assert.equal(configured.ok, true); assert.deepEqual(configured.snapshot.queue.selected, ['breakout', 'pong']);
    const revision = configured.snapshot.revision;
    const replies = await Promise.all([command(stage, 'start_queue', { expectedRevision: revision }), command(player, 'start_queue', { expectedRevision: revision })]);
    assert.equal(replies.filter(reply => reply.ok).length, 1); assert.equal(replies.find(reply => !reply.ok).code, 'GAME_STALE_REVISION');
    gameId = replies.find(reply => reply.ok).snapshot.game.id; assert.match(gameId, /^[0-9a-f-]{36}$/);
    const previous = gameRuntime.states.get(key);
    await assert.rejects(gameRuntime.operate(faultyGrants(), credentials(publicSession), live, 'input', { gameRunId: gameId, direction: 'right' }), /GAME_TEST_COMMIT_FAILURE/); assert.equal(gameRuntime.states.get(key), previous);
  });
  await t.test('Breakout uses grant-derived input with shared-window rate limits; revoked pending input is excluded by same-transaction SQL presence', async () => {
    assert.equal((await command(attendee, 'input', { gameRunId: gameId, direction: 'right' })).ok, true);
    const twin = await connect(publicSession); assert.equal((await command(twin, 'input', { gameRunId: gameId, direction: 'right' })).code, 'GAME_RATE_LIMITED'); twin.close();
    assert.equal((await command(bob, 'input', { gameRunId: gameId, direction: 'left' })).ok, true);
    const stalePresence = { withSession: (credential, operation) => grants.withSession(credential, async (context, db, g) => {
      assert.ok(f.sockets.of('/events-v2').sockets.has(bob.id)); await db.execute('UPDATE event_access_grants SET revoked_at = ? WHERE id = ?', [f.now(), bobSession.context.grantId]); return operation(context, db, g);
    }) };
    advanceClock(100); await gameRuntime.operate(stalePresence, credentials(stageSession), live, 'tick');
    assert.ok(gameRuntime.states.get(key).breakout.sessions.get(key).paddle.x > 0.5);
    const disconnected = gone(bob); await f.grantSockets.reviewAll(); await disconnected;
    assert.equal((await snap(attendee)).game.ball, undefined); assert.equal((await snap(player)).game.last_input_by_audience, undefined);
    assert.equal((await command(player, 'start', { gameRunId: gameId })).ok, true);
    assert.equal((await snap(player)).game.status, 'countdown'); advanceClock(4101);
    const timerEntry = [...f.gameTimers].at(-1); assert.ok(timerEntry); f.gameTimers.delete(timerEntry[0]); await timerEntry[1]();
    assert.equal((await snap(player)).game.status, 'running');
    const ballBefore = (await snap(player)).game.ball.x; advanceClock(4151); assert.notEqual((await snap(player)).game.ball.x, ballBefore);
    assert.equal((await command(speaker, 'pause', { gameRunId: gameId })).ok, true); const paused = (await snap(player)).game.remaining_ms;
    advanceClock(5000); assert.equal((await snap(player)).game.remaining_ms, paused); assert.equal((await command(player, 'resume', { gameRunId: gameId })).ok, true);
    advanceClock(6001); assert.equal((await snap(player)).game.status, 'finished'); assert.ok((await snap(player)).queue.transition_at_ms);
    assert.equal((await command(attendee, 'input', { gameRunId: gameId, direction: 'right' })).code, 'GAME_GAME_NOT_RUNNING');
  });
  await t.test('queue advances after five seconds to real Pong; Player controls names/start/pause/resume/end with deduplicated current teams', async () => {
    advanceClock(11002); const next = await snap(player); assert.equal(next.game.type, 'pong'); assert.equal(next.game.status, 'ready'); const pongId = next.game.id;
    assert.notEqual(pongId, gameId); assert.equal((await command(attendee, 'input', { gameRunId: gameId, direction: 'right' })).code, 'GAME_STALE_RUN');
    assert.equal((await command(player, 'start', { gameRunId: pongId })).code, 'GAME_TEAMS_INCOMPLETE');
    assert.equal((await command(player, 'team_names', { gameRunId: pongId, left: 'Azules', right: 'Naranjas' })).ok, true);
    assert.equal((await command(attendee, 'join_team', { gameRunId: pongId, team: 'left' })).ok, true);
    bobSession = await register('Game Bob replacement'); bob = await connect(bobSession); await command(bob, 'join_team', { gameRunId: pongId, team: 'right' });
    const duplicate = await connect(publicSession); await command(duplicate, 'join_team', { gameRunId: pongId, team: 'left' }); assert.equal((await snap(stage)).game.roster_counts.left, 1);
    assert.equal((await command(player, 'start', { gameRunId: pongId })).ok, true); assert.equal((await snap(player)).game.roster_counts, undefined);
    assert.equal((await command(duplicate, 'join_team', { gameRunId: pongId, team: 'right' })).code, 'GAME_ROSTER_LOCKED');
    duplicate.close(); attendee.close(); attendee = await connect(publicSession); assert.equal((await snap(attendee)).game.membership.team, 'left');
    const spectator = await connect(await register('Game spectator')); assert.equal((await snap(spectator)).game.membership.spectator, true); assert.equal((await command(spectator, 'input', { gameRunId: pongId, direction: 'up' })).code, 'GAME_SPECTATOR');
    assert.equal((await command(attendee, 'input', { gameRunId: pongId, direction: 'up' })).ok, true); assert.equal((await command(attendee, 'input', { gameRunId: pongId, direction: 'down' })).code, 'GAME_RATE_LIMITED');
    advanceClock(11102); const moved = await snap(player); assert.ok(moved.game.paddles.left.y < 0.5);
    assert.equal((await command(player, 'pause', { gameRunId: pongId })).ok, true); advanceClock(12000); assert.equal((await command(speaker, 'resume', { gameRunId: pongId })).ok, true);
    advanceClock(13001); const final = await snap(player); assert.equal(final.game.status, 'finished'); assert.equal(final.game.winner_team, 'tie'); assert.equal(final.queue.status, 'finished');
    assert.equal((await queueCommand(player, 'end')).ok, true); assert.equal((await snap(player)).queue.status, 'idle'); assert.equal((await snap(player)).game, null);
  });
  await t.test('Games exclude poll/raffle/Knowledge in both directions; Q&A and Time coexist while other lives/events remain isolated', async () => {
    const polling = await ack(stage, 'events:poll:launch', { interactionId: 'poll' }); assert.equal(polling.ok, true); assert.equal((await queueCommand(stage, 'start_queue')).code, 'INTERACTION_BUSY'); await ack(stage, 'events:poll:close', { pollRunId: polling.snapshot.pollRunId });
    const raffle = await ack(stage, 'events:raffle:open', { definitionId: 'free' }); assert.equal(raffle.ok, true); assert.equal((await queueCommand(stage, 'start_queue')).code, 'INTERACTION_BUSY'); await ack(stage, 'events:raffle:close', { raffleRunId: raffle.snapshot.raffleRunId });
    const knowledge = await ack(stage, 'events:knowledge:open', { definitionId: 'trivia' }); assert.equal(knowledge.ok, true); assert.equal((await queueCommand(stage, 'start_queue')).code, 'INTERACTION_BUSY'); await ack(stage, 'events:knowledge:cancel', { executionId: knowledge.snapshot.execution.executionId, expectedRevision: knowledge.snapshot.execution.revision });
    const qna = await ack(stage, 'events:qna:open'); assert.equal(qna.ok, true);
    assert.equal((await queueCommand(player, 'start_queue')).ok, true);
    for (const [event, payload] of [['events:poll:launch', { interactionId: 'poll' }], ['events:raffle:open', { definitionId: 'free' }], ['events:knowledge:open', { definitionId: 'trivia' }]]) assert.equal((await ack(stage, event, payload)).code, 'INTERACTION_BUSY');
    assert.equal((await controlTime(player, { target: 'screen', action: 'start', mode: 'clock' })).ok, true);
    secondClient = await connect(await issue('PLAYER', { liveSessionId: second }), second); foreignClient = await connect(await issue('PLAYER', { liveSessionId: foreign }, b), foreign);
    let crossEmissions = 0; secondClient.on('events:game:state', () => crossEmissions++); foreignClient.on('events:game:state', () => crossEmissions++);
    assert.equal((await queueCommand(player, 'skip')).ok, true); assert.equal(crossEmissions, 0);
    assert.equal((await snap(secondClient)).game, null); assert.equal((await timing(foreignClient)).screen.visible, false);
    assert.equal((await snap(player)).game.type, 'pong'); await queueCommand(player, 'end');
    const question = await ack(attendee, 'events:qna:submit', { roundId: qna.snapshot.roundId, question: 'Games coexist?', allowNameOnScreen: false }); assert.equal(question.ok, true);
    const original = gameRuntime.readGames; gameRuntime.readGames = async prepared => ({ ...preparations.get(prepared.liveSessionId), versionId: 'wrong' });
    await assert.rejects(grants.withSession(credentials(stageSession), (context, db) => gameRuntime.projection(context, db, live)), { code: 'GAME_CONTENT_NOT_PREPARED' }); gameRuntime.readGames = original;
  });
  await t.test('Time runs private Speaker and independent Screen stopwatch/countdown/clock with stale revision and timestamp protection', async () => {
    assert.equal((await controlTime(stage, { target: 'speaker', action: 'start' })).ok, true);
    assert.equal((await controlTime(player, { target: 'screen', action: 'start', mode: 'stopwatch' })).ok, true); advanceClock(14001);
    const controller = await timing(speaker); assert.equal(controller.speaker.elapsedMs, 1000); assert.equal(controller.screen.elapsedMs, 1000); assert.equal((await timing(player)).speaker, undefined); assert.equal((await timing(attendee)).screen, null);
    assert.equal((await controlTime(speaker, { target: 'screen', action: 'stop' })).ok, true); advanceClock(15001); assert.equal((await timing(player)).screen.elapsedMs, 1000);
    await controlTime(player, { target: 'screen', action: 'resume' }); advanceClock(16001); assert.equal((await timing(player)).screen.elapsedMs, 2000);
    await controlTime(player, { target: 'screen', action: 'reset' }); assert.equal((await timing(player)).screen.elapsedMs, 0);
    await controlTime(player, { target: 'screen', action: 'start', mode: 'countdown', hours: 0, minutes: 0, seconds: 2 }); advanceClock(17001); await controlTime(player, { target: 'screen', action: 'stop' }); advanceClock(18001); assert.equal((await timing(player)).screen.remainingMs, 1000);
    await controlTime(player, { target: 'screen', action: 'resume' }); advanceClock(19002); const expired = await timing(player); assert.equal(expired.screen.remainingMs, 0); assert.equal(expired.screen.running, false); assert.equal(expired.screen.visible, true);
    assert.equal((await controlTime(player, { target: 'screen', action: 'resume' })).code, 'TIME_INVALID_STATE'); await controlTime(player, { target: 'screen', action: 'reset' }); assert.equal((await timing(player)).screen.remainingMs, 2000);
    await controlTime(player, { target: 'screen', action: 'start', mode: 'clock' }); await controlTime(player, { target: 'screen', action: 'hide' }); assert.equal((await timing(player)).screen.visible, false);
    assert.equal((await ack(player, 'events:time:control', { expectedRevision: 0, target: 'screen', action: 'hide' })).code, 'TIME_STALE_REVISION');
    assert.equal((await ack(player, 'events:time:control', { expectedRevision: (await timing(player)).revision, target: 'speaker', action: 'stop', now: 1 })).code, 'TIME_INVALID_COMMAND');
    const previous = timeRuntime.states.get(key); await assert.rejects(timeRuntime.operate(faultyGrants(), credentials(stageSession), live, { expectedRevision: previous.state.revision, target: 'speaker', action: 'stop' }), /GAME_TEST_COMMIT_FAILURE/); assert.equal(timeRuntime.states.get(key), previous);
    await controlTime(stage, { target: 'speaker', action: 'stop' }); const stopped = (await timing(stage)).speaker.elapsedMs; advanceClock(20002); assert.equal((await timing(stage)).speaker.elapsedMs, stopped); await controlTime(stage, { target: 'speaker', action: 'reset' });
  });
  await t.test('forged actor/run/config and legacy game/time events cannot mutate; kill/outage/revoke/paid/finished live stop writes and pushes', async () => {
    const forged = await connect(publicSession), before = gameRuntime.states.get(key);
    assert.equal((await command(forged, 'input', { gameRunId: crypto.randomUUID(), direction: 'right', participantId: bobSession.context.participantId })).code, 'LIVE_ACCESS_DENIED'); assert.equal(gameRuntime.states.get(key), before);
    const raw = await connect(publicSession); for (const event of ['pong:input', 'breakout:input', 'games:queue:start', 'time:control']) {
      await new Promise((resolve, reject) => { const handle = setTimeout(() => reject(new Error('legacy denial timeout')), 7000); raw.once('events:command_denied', result => { clearTimeout(handle); assert.equal(result.code, 'COMMAND_NOT_ENABLED'); resolve(); }); raw.emit(event, {}); });
    }
    const gameBefore = gameRuntime.states.get(key), timeBefore = timeRuntime.states.get(key);
    await assert.rejects(gameRuntime.operate({ withSession: async () => { throw new Error('sql unavailable'); } }, credentials(stageSession), live, 'tick'), /sql unavailable/); assert.equal(gameRuntime.states.get(key), gameBefore);
    f.setEnabled(false); await assert.rejects(timeRuntime.operate(grants, credentials(stageSession), live, { expectedRevision: timeBefore.state.revision, target: 'speaker', action: 'start' }), { code: 'LIVE_ACCESS_DENIED' }); assert.equal(timeRuntime.states.get(key), timeBefore);
    const disconnects = [...clients].filter(client => client.connected).map(gone); await f.grantSockets.reviewAll(); await Promise.all(disconnects); f.setEnabled(true);
    player = await connect(playerSession); attendee = await connect(publicSession); stage = await connect(stageSession);
    let publicPushes = 0; attendee.on('events:game:state', () => publicPushes++); attendee.on('events:time:state', () => publicPushes++);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['PAID', activityA]);
    const audienceGone = gone(attendee); assert.equal((await controlTime(player, { target: 'screen', action: 'start', mode: 'clock' })).ok, true); await audienceGone; assert.equal(publicPushes, 0); assert.equal(attendee.connected, false);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['FREE', activityA]);
    const playerGone = gone(player); await sql('UPDATE event_access_grants SET revoked_at = ? WHERE id = ?', [f.now(), playerSession.context.grantId]);
    const deniedBefore = timeRuntime.states.get(key); await assert.rejects(timeRuntime.operate(grants, credentials(playerSession), live, { expectedRevision: deniedBefore.state.revision, target: 'screen', action: 'hide' }), { code: 'GRANT_ACCESS_DENIED' }); await f.grantSockets.reviewAll(); await playerGone; assert.equal(timeRuntime.states.get(key), deniedBefore);
    await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = ? WHERE id = ?", [f.now(), live]);
    await assert.rejects(gameRuntime.operate(grants, credentials(stageSession), live, 'tick'), { code: 'LIVE_ACCESS_DENIED' });
    assert.equal(gameRuntime.states.get(key), gameBefore); assert.equal((await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n, legacyBefore);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_v2_raffle_sessions WHERE id = ?', [second]))[0].n, 0);
  });
}
module.exports = { gameTimeSuite };
