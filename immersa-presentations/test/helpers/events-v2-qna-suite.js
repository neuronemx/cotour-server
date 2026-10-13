const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { runMigrations } = require('../../db/migrate');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { EventQnaRuntime } = require('../../events-v2/qna-runtime');
const { QnaRepository } = require('../../db/qna-repository');
async function qnaSuite(t, f) {
  const { request, sql, grants, domain, grantSockets, base, o1, a, b, stageA, activityA, activityB, publicId, qnaRuntime, preparations } = f;
  const path = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'qna-version', slideCount: 5,
      polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choice', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] });
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, name, payload = {}) => new Promise((resolve, reject) => client.timeout(5000).emit(name, payload, (error, result) => error ? reject(error) : resolve(result)));
  const disconnected = client => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Q&A denial did not disconnect')), 5000); client.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  async function issue(kind, fields, event = a) {
    const g = await request('admin1', 'POST', path(event) + '/grants', { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(g.status, 201);
    const r = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: g.body.token }); assert.equal(r.status, 200); return r.body;
  }
  async function register(name = 'Nora') { const r = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(r.status, 201); return r.body; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE', participantId: 'foreign', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Q&A context timeout')), 5000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); });
    assert.equal((await ack(client, 'events:live:join', { liveSessionId: liveId })).ok, true); return client;
  }
  const snap = client => ack(client, 'events:qna:snapshot');
  const command = (client, action, data) => ack(client, `events:qna:${action}`, data);
  const question = (client, roundId, text = 'Question one', extra = {}) => command(client, 'submit', { roundId, question: text, allowNameOnScreen: false, ...extra });
  const count = async () => Number((await sql('SELECT COUNT(*) n FROM event_v2_qna_questions'))[0].n);
  let stage, speaker, player, attendee, other, stageSession, participantSession, round, q1, q2;
  const beforeLegacy = (await sql('SELECT COUNT(*) n FROM qna_questions'))[0].n;
  const beforeSessions = (await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n;
  await t.test('Q&A migration recovers partial DDL; reads and denied roles never initialize a round', async () => {
    await sql('DROP TABLE event_v2_qna_projection'); await sql("DELETE FROM schema_migrations WHERE id = '039_event_qna.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['039_event_qna.sql']); assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); player = await connect(await issue('PLAYER', { liveSessionId: live }));
    participantSession = await register(); attendee = await connect(participantSession); other = await connect(await register('Other attendee'));
    assert.equal((await snap(attendee)).snapshot.displayName, 'Nora'); assert.equal((await snap(stage)).snapshot.roundId, null);
    assert.equal((await command(attendee, 'open', {})).code, 'QNA_COMMAND_DENIED');
    assert.equal((await sql('SELECT COUNT(*) n FROM event_v2_qna_sessions'))[0].n, 0);
  });
  await t.test('authorized SQL rollback leaves no Q&A setup, question or identity change before commit', async () => {
    const faultyDomain = new EventDomainRepository(domain.pool);
    faultyDomain.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('QNA_TEST_COMMIT_FAILURE'); } finally { await db.rollback(); db.release(); } };
    const faulty = new EventGrantRepository(faultyDomain, { now: f.now });
    await assert.rejects(qnaRuntime.operate(faulty, credentials(stageSession), live, 'open', {}), /QNA_TEST_COMMIT_FAILURE/);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_v2_qna_sessions'))[0].n, 0);
    const opened = await Promise.all([command(stage, 'open', {}), command(speaker, 'open', {})]);
    assert.ok(opened.every(result => result.ok)); round = opened[0].snapshot.roundId; assert.equal(opened[1].snapshot.roundId, round); await snap(stage); await snap(speaker);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_v2_qna_rounds WHERE presentation_session_id = ?', [live]))[0].n, 1);
    await assert.rejects(qnaRuntime.operate(faulty, credentials(participantSession), live, 'submit', { roundId: round, question: 'Uncommitted question', name: 'Uncommitted name', allowNameOnScreen: true }), /QNA_TEST_COMMIT_FAILURE/);
    assert.equal(await count(), 0); assert.equal((await snap(attendee)).snapshot.displayName, 'Nora');
  });
  await t.test('questions use participant identity, ten-second cooldown across windows and persistent name correction', async () => {
    const duplicate = await connect(participantSession);
    const replies = await Promise.all([question(attendee, round), question(duplicate, round)]);
    assert.equal(replies.filter(result => result.ok).length, 1); assert.equal(replies.find(result => !result.ok).code, 'QNA_COOLDOWN');
    await snap(attendee); await snap(duplicate); assert.equal(await count(), 1);
    const state = (await snap(stage)).snapshot; q1 = state.questions[0].id; assert.equal(state.questions[0].name, 'Nora');
    const stored = (await sql('SELECT audience_id FROM event_v2_qna_questions WHERE id = ?', [q1]))[0]; assert.equal(stored.audience_id, participantSession.context.participantId);
    assert.equal((await snap(other)).snapshot.questionId, null); assert.equal((await snap(other)).snapshot.questions, undefined);
    f.setQnaClockOffset(11000); assert.equal((await question(attendee, round, 'Question with consent', { name: 'Alice', allowNameOnScreen: true })).ok, true); await snap(attendee);
    q2 = (await snap(stage)).snapshot.questions.find(q => q.text === 'Question with consent').id;
    f.setQnaClockOffset(22000); assert.equal((await question(attendee, round, 'Blank name keeps identity', { name: '' })).ok, true); await snap(attendee);
    attendee.close(); attendee = await connect(participantSession); assert.equal((await snap(attendee)).snapshot.displayName, 'Alice');
    assert.equal((await snap(attendee)).snapshot.hasSubmitted, true); assert.equal((await snap(attendee)).snapshot.questions, undefined); duplicate.close();
  });
  await t.test('Player completes selection/projection/delete/panel cycle without an unprojected inbox or name leak', async () => {
    const initial = (await snap(player)).snapshot; assert.equal(initial.questions, undefined); assert.equal(initial.screen.visible, false);
    assert.ok(initial.availableQuestions.every(q => !q.text && !q.name));
    await command(player, 'select', { roundId: round, questionId: q1 });
    const first = await command(player, 'project', { roundId: round, questionId: q1 }); assert.equal(first.snapshot.screen.question.name, '');
    const consent = await command(speaker, 'project', { roundId: round, questionId: q2 }); assert.equal(consent.snapshot.screen.question.name, 'Alice');
    assert.equal((await command(player, 'delete', { roundId: round, questionId: q2 })).code, 'QNA_ALREADY_PROJECTED');
    const unprojected = (await snap(stage)).snapshot.questions.find(q => q.text === 'Blank name keeps identity');
    assert.equal((await command(player, 'delete', { roundId: round, questionId: unprojected.id })).ok, true);
    const closed = await command(player, 'panel_close', { roundId: round }); assert.equal(closed.snapshot.screen.visible, false); assert.equal(closed.snapshot.questionsOpen, true);
    assert.equal((await command(player, 'open', {})).snapshot.screen.visible, false); await snap(player);
    assert.equal((await command(stage, 'set_open', { roundId: round, open: false })).ok, true);
    assert.equal((await question(other, round)).code, 'QNA_CLOSED'); await command(stage, 'set_open', { roundId: round, open: true }); await snap(stage);
  });
  await t.test('polls coexist with Q&A; persisted projection reconstructs; legacy history cannot reach Events questions', async () => {
    await command(stage, 'project', { roundId: round, questionId: q2 }); await snap(stage);
    const launched = await ack(stage, 'events:poll:launch', { interactionId: 'poll' }); assert.equal(launched.ok, true); await snap(stage);
    assert.equal((await snap(stage)).snapshot.questionsOpen, true); assert.equal((await snap(player)).snapshot.screen.visible, true);
    const rebuilt = new EventQnaRuntime({ liveRuntime: f.runtime, pool: domain.pool });
    const restored = await grants.withSession(credentials(stageSession), (context, db) => rebuilt.projection(context, db, live));
    assert.equal(restored.screen.question.id, q2); assert.equal(restored.questions.length, 2);
    const legacy = new QnaRepository(domain.pool); assert.deepEqual(await legacy.listExportQuestionsByDeck('v2-private-deck'), []);
    const before = await count(); await legacy.clearDeckHistory('v2-private-deck'); assert.equal(await count(), before);
    assert.equal((await sql('SELECT COUNT(*) n FROM qna_questions'))[0].n, beforeLegacy); assert.equal((await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n, beforeSessions);
    await ack(stage, 'events:poll:close', { pollRunId: launched.snapshot.pollRunId }); await snap(stage);
  });
  await t.test('new round rejects stale packets; forbidden identity/control and old legacy commands never mutate', async () => {
    const old = round; round = (await command(stage, 'new_round', { roundId: old })).snapshot.roundId; await snap(stage); assert.notEqual(round, old);
    assert.equal((await snap(player)).snapshot.screen.visible, false); assert.equal((await snap(attendee)).snapshot.questionId, null);
    const before = await count(); let emitted = 0; other.on('events:qna:state', () => emitted++);
    assert.equal((await question(attendee, old, 'Late question')).code, 'QNA_STALE_ROUND');
    assert.equal((await command(player, 'project', { roundId: round, questionId: q2 })).code, 'QNA_QUESTION_NOT_FOUND');
    assert.equal((await command(attendee, 'set_open', { roundId: round, open: false })).code, 'QNA_COMMAND_DENIED'); assert.equal(await count(), before); assert.equal(emitted, 0);
    const stop = disconnected(other); assert.equal((await command(other, 'submit', { roundId: round, question: 'Spoof', allowNameOnScreen: true, participantId: participantSession.context.participantId })).ok, false); await stop; assert.equal(await count(), before); assert.equal(emitted, 0);
    const denied = new Promise(resolve => stage.once('events:command_denied', resolve)); stage.emit('qna:set_open', { open: false }); assert.equal((await denied).code, 'COMMAND_NOT_ENABLED'); assert.equal(await count(), before);
  });
  await t.test('same deck in two runs/events never shares Q&A rows or recipient emissions', async () => {
    const local = await connect(await issue('STAGE', { stageId: stageA }), second), otherEvent = await connect(await issue('STAGE', { stageId: stageB }, b), foreign);
    const localRound = (await command(local, 'open', {})).snapshot.roundId, foreignRound = (await command(otherEvent, 'open', {})).snapshot.roundId; await snap(local); await snap(otherEvent);
    const participantLocal = await connect(participantSession, second); await question(participantLocal, localRound, 'Other execution question'); await snap(participantLocal);
    const localId = (await snap(local)).snapshot.questions[0].id;
    let localEmits = 0, foreignEmits = 0; local.on('events:qna:state', () => localEmits++); otherEvent.on('events:qna:state', () => foreignEmits++);
    const before = await count(); assert.equal((await command(stage, 'project', { roundId: round, questionId: localId })).code, 'QNA_QUESTION_NOT_FOUND'); assert.equal((await question(attendee, foreignRound)).code, 'QNA_STALE_ROUND'); assert.equal(await count(), before);
    assert.equal((await question(attendee, round, 'Primary execution question')).ok, true); await snap(attendee); await snap(stage);
    assert.equal(localEmits, 0); assert.equal(foreignEmits, 0); assert.equal((await snap(otherEvent)).snapshot.questions.length, 0);
    local.close(); otherEvent.close(); participantLocal.close();
  });
  await t.test('revoke, FREE/PAID change, outage and finished resource block Q&A reads/writes/fanout', async () => {
    const revokedSession = await register(), revoked = await connect(revokedSession); let leaked = 0; revoked.on('events:qna:state', () => leaked++); const stopped = disconnected(revoked);
    await sql('UPDATE event_access_grants SET revoked_at = ? WHERE id = ?', [f.now(), revokedSession.context.grantId]);
    await command(stage, 'set_open', { roundId: round, open: false }); await grantSockets.reviewAll(); await stopped; await snap(stage); assert.equal(leaked, 0);
    const freeStopped = disconnected(attendee); let freeEmits = 0; attendee.on('events:qna:state', () => freeEmits++);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['PAID', activityA]); await command(stage, 'set_open', { roundId: round, open: true }); await grantSockets.reviewAll(); await freeStopped; assert.equal(freeEmits, 0);
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['FREE', activityA]);
    attendee = await connect(participantSession); const before = await count(); const outageStopped = disconnected(attendee); let outageEmits = 0; attendee.on('events:qna:state', () => outageEmits++);
    const original = grants.pool; grants.pool = { execute: async () => { throw new Error('Q&A DB unavailable'); } };
    try { attendee.emit('events:qna:submit', { roundId: round, question: 'Outage', allowNameOnScreen: false }); await outageStopped; assert.equal(outageEmits, 0); } finally { grants.pool = original; }
    assert.equal(await count(), before);
    stage.close(); stage = await connect(stageSession); const finished = disconnected(stage);
    await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = ? WHERE id = ?", [f.now(), live]); await grantSockets.reviewAll(); await finished; assert.equal(await count(), before);
  });
}
module.exports = { qnaSuite };
