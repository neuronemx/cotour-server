const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { executionKey } = require('../../events-v2/live-runtime');
async function pollSuite(t, f) {
  const { request, sql, grants, grantSockets, base, o1, a, b, stageA, activityA, activityB, publicId, pollRuntime, preparations } = f;
  const path = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  const definition = { id: 'poll-shared', type: 'poll', title: 'Internal title', prompt: 'What do you prefer?', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], script: 'PRIVATE SCRIPT', settings: { correct_option_ids: ['one'] }, participants: ['PRIVATE PARTICIPANT'] };
  const another = { ...definition, id: 'poll-other', title: 'Other poll' };
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'poll-version', slideCount: 5, polls: [definition, another] });
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, event, payload = {}) => new Promise((resolve, reject) => client.timeout(3000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
  const disconnected = client => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('denial did not disconnect')), 3000); client.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  async function issue(kind, fields, event = a) {
    const g = await request('admin1', 'POST', path(event) + '/grants', { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(g.status, 201);
    const s = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: g.body.token }); assert.equal(s.status, 200); return s.body;
  }
  async function register() { const r = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'Poll attendee' }); assert.equal(r.status, 201); return r.body; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken, role: 'STAGE', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('poll context timeout')), 3000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); });
    const joined = await ack(client, 'events:live:join', { liveSessionId: liveId }); assert.equal(joined.ok, true, JSON.stringify(joined)); return client;
  }
  const snap = client => ack(client, 'events:poll:snapshot');
  const launch = (client, interactionId = 'poll-shared') => ack(client, 'events:poll:launch', { interactionId });
  const command = (client, name, pollRunId) => ack(client, `events:poll:${name}`, { pollRunId });
  const vote = (client, pollRunId, optionId = 'one') => ack(client, 'events:poll:submit', { pollRunId, optionId });
  const key = executionKey(a, live);
  let stage, speaker, player, attendee1, attendee2, firstSession, stageSession, run;
  await t.test('poll controls and projections use the same fixed authorized live binding', async () => {
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); player = await connect(await issue('PLAYER', { liveSessionId: live }));
    firstSession = await register(); attendee1 = await connect(firstSession); attendee2 = await connect(await register());
    assert.equal(pollRuntime.states.size, 0, 'idle snapshot does not create a poll engine');
    assert.deepEqual((await snap(player)).snapshot.available, [{ id: 'poll-shared', title: 'Internal title' }, { id: 'poll-other', title: 'Other poll' }]);
    assert.equal((await snap(attendee1)).snapshot.available, undefined);
    assert.equal((await launch(attendee1)).code, 'POLL_COMMAND_DENIED'); assert.equal(pollRuntime.states.size, 0);
    const begun = await launch(speaker); assert.equal(begun.ok, true); run = begun.snapshot.pollRunId; assert.match(run, /^[a-f0-9-]{36}$/);
    assert.equal((await snap(attendee1)).snapshot.active.title, undefined);
    assert.equal((await snap(player)).snapshot.active.title, undefined);
    const publicJson = JSON.stringify((await snap(attendee1)).snapshot); assert.ok(!publicJson.includes('PRIVATE')); assert.ok(!publicJson.includes('correct_option')); assert.ok(!publicJson.includes(firstSession.context.participantId));
  });
  await t.test('two connections share one participant vote; other participants never receive it', async () => {
    const sameActor = await connect(firstSession);
    const replies = await Promise.all([vote(attendee1, run), vote(sameActor, run)]);
    assert.equal(replies.filter(result => result.ok).length, 1); assert.equal(replies.find(result => !result.ok).code, 'POLL_DUPLICATE_RESPONSE');
    assert.equal((await snap(stage)).snapshot.results.totalResponses, 1);
    assert.equal((await snap(sameActor)).snapshot.response.optionId, 'one'); assert.equal((await snap(attendee2)).snapshot.response, null);
    assert.equal((await snap(attendee2)).snapshot.results, undefined);
    attendee1.close(); attendee1 = await connect(firstSession); assert.equal((await snap(attendee1)).snapshot.response.optionId, 'one');
    assert.equal((await vote(attendee1, run)).code, 'POLL_DUPLICATE_RESPONSE'); sameActor.close();
    const state = pollRuntime.states.get(key); assert.equal(state.store.getSession(key).responses.size, 1);
    assert.equal([...state.store.getSession(key).responses.values()][0].audienceId, firstSession.context.participantId);
  });
  await t.test('hide/reveal/close/relaunch work from Player; stale poll run packets cannot alter a new run', async () => {
    assert.equal((await snap(player)).snapshot.results.totalResponses, 1);
    assert.equal((await command(player, 'hide', run)).snapshot.results, null);
    assert.equal((await snap(stage)).snapshot.results.totalResponses, 1);
    assert.equal((await snap(attendee1)).snapshot.response.optionId, 'one');
    assert.equal((await command(player, 'show', run)).snapshot.results.totalResponses, 1);
    assert.equal((await command(player, 'close', run)).snapshot.active, null);
    const restarted = await launch(player); const previousRun = run; run = restarted.snapshot.pollRunId; assert.notEqual(run, previousRun); await snap(player);
    const before = pollRuntime.states.get(key); let emitted = 0; attendee2.on('events:poll:state', () => emitted++);
    assert.equal((await vote(attendee1, previousRun)).code, 'POLL_NOT_ACTIVE'); assert.equal((await command(stage, 'close', previousRun)).code, 'POLL_NOT_ACTIVE');
    assert.equal(pollRuntime.states.get(key), before); assert.equal(emitted, 0);
    assert.equal((await vote(attendee1, run, 'two')).ok, true); assert.equal((await snap(stage)).snapshot.results.totalResponses, 1);
  });
  await t.test('concurrent launch cannot replace an active poll; invalid option and forged identity do not mutate', async () => {
    await command(stage, 'close', run);
    const replies = await Promise.all([launch(stage), launch(speaker, 'poll-other')]); assert.equal(replies.filter(result => result.ok).length, 1); assert.equal(replies.find(result => !result.ok).code, 'POLL_ALREADY_ACTIVE');
    run = (await snap(stage)).snapshot.pollRunId; await snap(speaker);
    const before = pollRuntime.states.get(key); let emitted = 0; attendee2.on('events:poll:state', () => emitted++);
    assert.equal((await vote(attendee2, run, 'foreign-option')).code, 'POLL_INVALID_OPTION'); assert.equal(pollRuntime.states.get(key), before); assert.equal(emitted, 0);
    const stop = disconnected(attendee2); assert.equal((await ack(attendee2, 'events:poll:submit', { pollRunId: run, optionId: 'one', participantId: firstSession.context.participantId })).ok, false); await stop;
    assert.equal(pollRuntime.states.get(key), before); assert.equal(emitted, 0);
    const denied = new Promise(resolve => stage.once('events:command_denied', resolve)); stage.emit('interaction:launch', { interactionId: 'poll-shared' }); assert.equal((await denied).code, 'COMMAND_NOT_ENABLED'); assert.equal(pollRuntime.states.get(key), before);
  });
  await t.test('same poll/deck across live executions and events never shares votes or fanout', async () => {
    const localOther = await connect(await issue('STAGE', { stageId: stageA }), second);
    const foreignOther = await connect(await issue('STAGE', { stageId: stageB }, b), foreign);
    const secondRun = (await launch(localOther)).snapshot.pollRunId, foreignRun = (await launch(foreignOther)).snapshot.pollRunId;
    const participantOther = await connect(firstSession, second); assert.equal((await vote(participantOther, secondRun)).ok, true);
    assert.equal((await snap(localOther)).snapshot.results.totalResponses, 1); assert.equal((await snap(foreignOther)).snapshot.results.totalResponses, 0);
    await snap(participantOther); await snap(foreignOther);
    let localEmits = 0, foreignEmits = 0; localOther.on('events:poll:state', () => localEmits++); foreignOther.on('events:poll:state', () => foreignEmits++);
    const before = pollRuntime.states.get(key); assert.equal((await vote(attendee1, foreignRun)).code, 'POLL_NOT_ACTIVE'); assert.equal(pollRuntime.states.get(key), before);
    await vote(attendee1, run); await snap(attendee1); await snap(stage); assert.equal(localEmits, 0); assert.equal(foreignEmits, 0);
    assert.equal(pollRuntime.states.get(executionKey(a, second)).runId, secondRun); assert.equal(pollRuntime.states.get(executionKey(b, foreign)).runId, foreignRun);
    participantOther.close(); localOther.close(); foreignOther.close();
  });
  await t.test('revoked recipient and FREE after PAID transition receive no poll results', async () => {
    const session = await register(), revoked = await connect(session);
    let leaked = 0; revoked.on('events:poll:state', () => leaked++); const stopped = disconnected(revoked);
    await sql('UPDATE event_access_grants SET revoked_at = ?, authz_version = authz_version + 1 WHERE id = ?', [f.now(), session.context.grantId]);
    await command(stage, 'hide', run); await grantSockets.reviewAll(); await stopped; await snap(stage); assert.equal(leaked, 0);
    const stoppedFree = disconnected(attendee1); let freeEmits = 0; attendee1.on('events:poll:state', () => freeEmits++);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['PAID', activityA]);
    await command(stage, 'show', run); await grantSockets.reviewAll(); await stoppedFree; assert.equal(freeEmits, 0);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['FREE', activityA]);
  });
  await t.test('poll DB outage and kill switch cannot publish state or accept a response', async () => {
    attendee1 = await connect(firstSession); const before = pollRuntime.states.get(key);
    let leaked = 0, denied = false; attendee1.on('events:poll:state', () => leaked++); attendee1.on('events:access_denied', () => { denied = true; }); const stopped = disconnected(attendee1);
    const original = grants.pool; grants.pool = { execute: async () => { throw new Error('DB outage'); } };
    try { attendee1.emit('events:poll:submit', { pollRunId: run, optionId: 'one' }); await stopped; assert.equal(denied, true); assert.equal(leaked, 0); assert.equal(pollRuntime.states.get(key), before); }
    finally { grants.pool = original; }
    stage.close(); stage = await connect(stageSession); const killed = disconnected(stage); let killEmits = 0; stage.on('events:poll:state', () => killEmits++);
    f.setEnabled(false); await grantSockets.reviewAll(); await killed; assert.equal(killEmits, 0); assert.equal(pollRuntime.states.get(key), before); f.setEnabled(true);
  });
  await t.test('finished live resource denies old poll commands and never recreates a poll engine', async () => {
    stage = await connect(stageSession); const before = pollRuntime.states.get(key), size = pollRuntime.states.size;
    const stopped = disconnected(stage); let leaked = 0; stage.on('events:poll:state', () => leaked++);
    await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = ? WHERE id = ?", [f.now(), live]);
    await grantSockets.reviewAll(); await stopped; assert.equal(leaked, 0); assert.equal(pollRuntime.states.get(key), before); assert.equal(pollRuntime.states.size, size);
  });
}
module.exports = { pollSuite };
