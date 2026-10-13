const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { runMigrations } = require('../../db/migrate');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { EventKnowledgeRuntime } = require('../../events-v2/knowledge-runtime');
const { KnowledgeActivityRepository } = require('../../db/knowledge-activity-repository');
function definitions() {
  const question = { id: 'question', prompt: 'Private prepared question', correctOptionId: 'right', options: [{ id: 'right', label: 'Right' }, { id: 'wrong', label: 'Wrong' }] };
  return [{ id: 'trivia', category: 'contest', title: 'Trivia', identificationMode: 'optional_name', questionDurationSeconds: 5, questions: [question] },
    { id: 'evaluation', category: 'assessment', title: 'Evaluation', identificationMode: 'required_name', durationSeconds: 30,
      questions: [question, { ...question, id: 'second', prompt: 'Second question' }] },
    { id: 'anonymous', category: 'contest', title: 'Anonymous trivia', identificationMode: 'anonymous', questionDurationSeconds: 5, questions: [question] }];
}
async function knowledgeSuite(t, f) {
  const { request, sql, grants, domain, base, o1, a, b, stageA, activityA, activityB, publicId, knowledgeRuntime, preparations } = f;
  const eventPath = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'knowledge-version', slideCount: 5, knowledge: definitions(),
      polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choice', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] });
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  f.setKnowledgeClockOffset(0);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, name, payload = {}) => new Promise((resolve, reject) => client.timeout(5000).emit(name, payload, (error, result) => error ? reject(error) : resolve(result)));
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  async function issue(kind, fields, event = a) {
    const result = await request('admin1', 'POST', eventPath(event) + '/grants', { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(result.status, 201);
    const session = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: result.body.token }); assert.equal(session.status, 200); return session.body;
  }
  async function register(name = 'Nora') { const result = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(result.status, 201); return result.body; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE', participantId: 'forged', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('knowledge context timeout')), 5000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); });
    assert.equal((await ack(client, 'events:live:join', { liveSessionId: liveId })).ok, true); return client;
  }
  const snap = async client => { const result = await ack(client, 'events:knowledge:snapshot'); assert.equal(result.ok, true); return result.snapshot; };
  const command = (client, action, payload) => ack(client, `events:knowledge:${action}`, payload);
  async function control(client, action) { const state = (await snap(client)).execution; return command(client, action, { executionId: state.executionId, expectedRevision: state.revision }); }
  async function join(client, executionId, name) { return command(client, 'join', { executionId, ...(name !== undefined ? { name } : {}) }); }
  async function answer(client, executionId, questionId = 'question', optionId = 'right', attemptId = crypto.randomUUID()) { return command(client, 'answer', { executionId, questionId, optionId, attemptId }); }
  const rows = async table => Number((await sql(`SELECT COUNT(*) n FROM ${table}`))[0].n);
  const beforeLegacy = await rows('knowledge_activity_executions'), beforeSessions = await rows('presentation_sessions');
  let stage, player, speaker, attendee, other, stageSession, participantSession, runId, evaluationId, clock = 0;
  async function advance(ms, client = stage) { clock += ms; f.setKnowledgeClockOffset(clock); return snap(client); }
  await t.test('knowledge partial migration recovery; idle reads and denied commands cannot initialize data', async () => {
    await sql('DROP TABLE event_v2_knowledge_commands'); await sql("DELETE FROM schema_migrations WHERE id = '040_event_knowledge.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['040_event_knowledge.sql']); assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    player = await connect(await issue('PLAYER', { liveSessionId: live })); speaker = await connect(await issue('SPEAKER', { activityId: activityA }));
    participantSession = await register(); attendee = await connect(participantSession); other = await connect(await register('Other participant'));
    assert.equal((await snap(stage)).execution, null); assert.equal((await snap(attendee)).displayName, 'Nora'); assert.equal((await snap(attendee)).available, undefined);
    assert.equal((await command(attendee, 'open', { definitionId: 'trivia' })).code, 'KNOWLEDGE_COMMAND_DENIED');
    assert.equal(await rows('event_v2_knowledge_sessions'), 0); assert.equal(await rows('event_v2_knowledge_executions'), 0);
  });
  await t.test('knowledge setup and admission roll back atomically; concurrent activation leaves one execution', async () => {
    const faultyDomain = new EventDomainRepository(domain.pool);
    faultyDomain.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('KNOWLEDGE_TEST_COMMIT_FAILURE'); } finally { await db.rollback(); db.release(); } };
    const faulty = new EventGrantRepository(faultyDomain, { now: f.now });
    await assert.rejects(knowledgeRuntime.operate(faulty, credentials(stageSession), live, 'open', { definitionId: 'trivia' }), /KNOWLEDGE_TEST_COMMIT_FAILURE/);
    assert.equal(await rows('event_v2_knowledge_sessions'), 0); assert.equal(await rows('event_v2_knowledge_executions'), 0);
    const replies = await Promise.all([command(stage, 'open', { definitionId: 'trivia' }), command(speaker, 'open', { definitionId: 'trivia' })]);
    assert.equal(replies.filter(reply => reply.ok).length, 1); assert.equal(replies.find(reply => !reply.ok).code, 'INTERACTION_BUSY'); runId = replies.find(reply => reply.ok).snapshot.execution.executionId;
    assert.equal(await rows('event_v2_knowledge_executions'), 1);
    await assert.rejects(knowledgeRuntime.operate(faulty, credentials(participantSession), live, 'join', { executionId: runId, tabId: 'trusted-test-tab', name: 'Uncommitted' }), /KNOWLEDGE_TEST_COMMIT_FAILURE/);
    assert.equal(await rows('event_v2_knowledge_participants'), 0); assert.equal((await snap(attendee)).displayName, 'Nora');
  });
  await t.test('server-derived admission, name correction, reconnect and one active window; no keys before reveal', async () => {
    assert.equal((await join(attendee, runId, 'Alice')).ok, true); await join(other, runId); assert.equal((await snap(attendee)).displayName, 'Alice');
    const duplicate = await connect(participantSession); assert.equal((await join(duplicate, runId, '')).ok, true);
    assert.equal((await snap(duplicate)).displayName, 'Alice'); assert.equal((await snap(attendee)).execution.participant.tabActive, false);
    assert.equal((await control(player, 'start')).ok, true); await advance(4800);
    assert.equal((await answer(attendee, runId)).code, 'KNOWLEDGE_TAB_NOT_ACTIVE');
    const attempt = crypto.randomUUID(); const replied = await answer(duplicate, runId, 'question', 'right', attempt); assert.equal(replied.ok, true);
    assert.equal(JSON.stringify(replied.snapshot).includes('correctOptionId'), false); assert.equal(replied.snapshot.execution.personalResult, null);
    assert.equal((await answer(duplicate, runId, 'question', 'right', attempt)).ok, true); assert.equal((await answer(duplicate, runId, 'question', 'wrong')).code, 'KNOWLEDGE_DUPLICATE');
    assert.equal((await snap(player)).execution.definitionsSnapshot, undefined); assert.equal((await snap(player)).execution.result, undefined); assert.equal((await snap(player)).execution.reveal, null);
    assert.equal((await snap(other)).execution.answers.length, 0); assert.equal((await snap(other)).execution.participants, undefined);
    assert.equal((await sql('SELECT participant_id FROM event_v2_knowledge_answers WHERE execution_id = ?', [runId]))[0].participant_id, participantSession.context.participantId);
    duplicate.close(); attendee.close(); attendee = await connect(participantSession); await join(attendee, runId);
    assert.equal((await snap(attendee)).execution.answerCount, 1); assert.equal((await snap(attendee)).execution.participant.label, 'Alice');
  });
  await t.test('Player trivia reveal, processing, forced results and close; polls exclude knowledge while Q&A coexists', async () => {
    assert.equal((await ack(player, 'events:poll:launch', { interactionId: 'poll' })).code, 'INTERACTION_BUSY');
    assert.equal((await ack(stage, 'events:qna:open')).ok, true);
    await advance(5200); assert.equal((await snap(player)).execution.reveal.correctLabel, 'Right'); assert.equal((await snap(attendee)).execution.reveal.correct, true);
    await advance(5100); assert.equal((await snap(player)).execution.state, 'PROCESSING');
    assert.equal((await control(player, 'force_results')).ok, true); assert.equal((await snap(player)).execution.state, 'RESULTS_VISIBLE');
    assert.equal((await snap(player)).execution.top10[0].label, 'Alice'); assert.equal((await snap(attendee)).execution.personalResult.correctCount, 1);
    assert.equal((await control(player, 'close')).ok, true);
    const poll = await ack(player, 'events:poll:launch', { interactionId: 'poll' }); assert.equal(poll.ok, true);
    assert.equal((await command(stage, 'open', { definitionId: 'evaluation' })).code, 'INTERACTION_BUSY');
    await ack(player, 'events:poll:close', { pollRunId: poll.snapshot.pollRunId });
    const opened = await command(player, 'open', { definitionId: 'evaluation' }); assert.equal(opened.ok, true); evaluationId = opened.snapshot.execution.executionId;
    assert.equal((await answer(attendee, runId)).code, 'KNOWLEDGE_STALE_EXECUTION');
  });
  await t.test('assessment answers persist, submission locks edits and grades stay private until Speaker/Player reveal', async () => {
    await join(attendee, evaluationId); await join(other, evaluationId); assert.equal((await control(player, 'start')).ok, true); await advance(4800);
    const attempt = crypto.randomUUID(); assert.equal((await answer(attendee, evaluationId, 'question', 'right', attempt)).ok, true);
    assert.equal((await answer(attendee, evaluationId, 'second', 'right', attempt)).code, 'KNOWLEDGE_INVALID_INPUT');
    assert.equal((await answer(attendee, evaluationId, 'second', 'wrong')).ok, true);
    assert.equal((await command(attendee, 'submit', { executionId: evaluationId })).ok, true);
    assert.equal((await answer(attendee, evaluationId)).code, 'KNOWLEDGE_INVALID_STATE');
    const receipt = (await snap(attendee)).execution.submissionReceipt; assert.equal(receipt.answeredCount, 2); assert.equal(receipt.grade, undefined);
    assert.equal((await control(player, 'finalize')).ok, true); await advance(3100); assert.equal((await snap(stage)).execution.state, 'RESULTS_READY');
    assert.equal((await snap(attendee)).execution.personalResult, null); assert.equal((await snap(player)).execution.result, undefined);
    assert.equal((await control(player, 'show_results')).ok, true); assert.equal((await snap(attendee)).execution.personalResult.grade, 50);
    assert.equal((await snap(other)).execution.personalResult, null); assert.equal((await snap(player)).execution.participants, undefined);
  });
  await t.test('adapter reconstruction restores answers, orders and results; private versions and legacy history remain isolated', async () => {
    const rebuilt = new EventKnowledgeRuntime({ liveRuntime: f.runtime, pool: domain.pool, polls: f.pollRuntime, readKnowledge: async prepared => preparations.get(prepared.liveSessionId) });
    const restored = await grants.withSession(credentials(participantSession), (context, db) => rebuilt.projection(context, db, live));
    assert.equal(restored.execution.answerCount, 2); assert.equal(restored.execution.personalResult.grade, 50);
    assert.equal(await rows('knowledge_activity_executions'), beforeLegacy); assert.equal(await rows('presentation_sessions'), beforeSessions);
    assert.deepEqual(await new KnowledgeActivityRepository(domain.pool).listHistory('v2-private-deck'), []);
    const original = preparations.get(live); preparations.set(live, { ...original, knowledge: definitions().map(definition => ({ ...definition, title: 'Changed without a new version' })) });
    await assert.rejects(grants.withSession(credentials(stageSession), (context, db) => rebuilt.projection(context, db, live)), { code: 'CONTENT_VERSION_CHANGED' }); preparations.set(live, original);
    const before = await rows('event_v2_knowledge_answers'); await control(player, 'close');
    const opened = await command(player, 'open', { definitionId: 'anonymous' }); await join(attendee, opened.snapshot.execution.executionId);
    assert.match((await snap(attendee)).execution.participant.label, /^Usuario /); assert.equal((await snap(attendee)).displayName, 'Alice');
    assert.equal((await control(player, 'cancel')).ok, true); assert.equal(await rows('event_v2_knowledge_answers'), before);
  });
  await t.test('same prepared deck across executions/events cannot accept foreign execution IDs or emit foreign state', async () => {
    const sameRunPlayer = await connect(await issue('PLAYER', { liveSessionId: second }), second);
    const foreignPlayer = await connect(await issue('PLAYER', { liveSessionId: foreign }, b), foreign);
    const started = await command(sameRunPlayer, 'open', { definitionId: 'trivia' }); assert.equal(started.ok, true);
    assert.equal((await command(sameRunPlayer, 'cancel', { executionId: runId, expectedRevision: started.snapshot.execution.revision })).code, 'KNOWLEDGE_STALE_EXECUTION');
    assert.equal((await snap(foreignPlayer)).execution, null);
    let foreignEmissions = 0; foreignPlayer.on('events:knowledge:state', () => { foreignEmissions++; });
    await control(sameRunPlayer, 'cancel'); assert.equal(foreignEmissions, 0); sameRunPlayer.close(); foreignPlayer.close();
    const forged = await connect(participantSession); let denied = new Promise(resolve => forged.once('disconnect', resolve));
    const reply = await command(forged, 'join', { executionId: evaluationId, participantId: 'forged' }); assert.equal(reply.ok, false); await denied;
    const legacy = await connect(participantSession); let rawDenied = new Promise(resolve => legacy.once('events:command_denied', resolve));
    legacy.emit('interaction:execution:command', { actorRole: 'stage', intent: 'start', executionId: evaluationId }); assert.equal((await rawDenied).code, 'COMMAND_NOT_ENABLED'); legacy.close();
  });
  await t.test('deadline timers reauthorize; revocation, access downgrade, outage and finish block writes and delivery', async () => {
    const opened = await command(player, 'open', { definitionId: 'trivia' }); await join(attendee, opened.snapshot.execution.executionId); await control(player, 'start');
    const before = (await sql('SELECT revision FROM event_v2_knowledge_executions WHERE id = ?', [opened.snapshot.execution.executionId]))[0].revision;
    const narrowSession = await issue('SPEAKER', { activityId: activityA }); const narrow = await connect(narrowSession); let denied = new Promise(resolve => narrow.once('disconnect', resolve));
    await request('admin1', 'DELETE', eventPath(a) + '/grants/' + narrowSession.context.grantId); await denied;
    await assert.rejects(knowledgeRuntime.operate(grants, credentials(narrowSession), live, 'tick'));
    assert.equal((await sql('SELECT revision FROM event_v2_knowledge_executions WHERE id = ?', [opened.snapshot.execution.executionId]))[0].revision, before);
    let publicEmissions = 0; attendee.on('events:knowledge:state', () => { publicEmissions++; });
    await sql("UPDATE event_activities SET access_level = 'PAID' WHERE id = ?", [activityA]); await f.grantSockets.reviewAll(); publicEmissions = 0;
    assert.equal(attendee.connected, false); await advance(4800, player); assert.equal(publicEmissions, 0);
    f.setEnabled(false); await assert.rejects(knowledgeRuntime.operate(grants, credentials(stageSession), live, 'tick')); f.setEnabled(true);
    const broken = { withSession: async () => { throw new Error('database unavailable'); } }; await assert.rejects(knowledgeRuntime.operate(broken, credentials(stageSession), live, 'tick'), /database unavailable/);
    await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = CURRENT_TIMESTAMP WHERE id = ?", [live]);
    await assert.rejects(knowledgeRuntime.operate(grants, credentials(stageSession), live, 'tick')); await f.grantSockets.reviewAll(); assert.equal(player.connected, false);
    knowledgeRuntime.close(); await sql("UPDATE event_activities SET access_level = 'FREE' WHERE id = ?", [activityA]);
  });
}
module.exports = { knowledgeSuite, definitions };
