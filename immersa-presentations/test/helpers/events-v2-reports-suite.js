const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { executionKey } = require('../../events-v2/live-runtime');
async function reportsSuite(t, f) {
  const { sql, request, base, cookies, ids, domain, reports, grants, runtime, qnaRuntime, knowledgeRuntime, avRuntime,
    o1, o2, a, b, stageA, stageB, activityA, activityB, publicId, preparations } = f;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
  const eventPath = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const path = (suffix, target = live, event = a, org = o1) => `/api/events-v2/organizations/${org}/events/${event}/live-sessions/${target}/${suffix}`;
  const question = { id: 'q', prompt: '¿Qué?, "東京"', correctOptionId: 'yes', options: [{ id: 'yes', label: 'Sí, "東京"' }, { id: 'no', label: 'No' }] };
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'reports-version', slideCount: 3,
      resources: [], playlists: [], polls: [], raffles: [], games: [], knowledge: [
        { id: 'assessment', category: 'assessment', title: 'Evaluación CSV', identificationMode: 'required_name', durationSeconds: 30, questions: [question] },
        { id: 'trivia', category: 'contest', title: 'Trivia CSV', identificationMode: 'optional_name', questionDurationSeconds: 5, questions: [question] }] });
  }
  await sql('UPDATE event_activities SET access_level=? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  async function get(actor, route, extra = {}, method = 'GET') {
    const response = await fetch(base + route, { method, headers: { origin: base, ...(cookies.has(actor) ? { cookie: cookies.get(actor) } : {}), ...extra } });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch (_) { data = null; }
    return { status: response.status, headers: response.headers, text, data };
  }
  async function issue(kind, fields) {
    const result = await request('admin1', 'POST', eventPath(a) + '/grants', { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(result.status, 201);
    const session = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: a, token: result.body.token }); assert.equal(session.status, 200);
    return { ...session.body, cookie: session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  async function register(name) {
    const result = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(result.status, 201);
    return { ...result.body, cookie: result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  let stage, speaker, player, alice, bob, assessmentId, triviaId, aliceQuestion;
  const counts = async () => {
    const result = {}; for (const table of ['event_v2_qna_sessions', 'event_v2_qna_questions', 'event_v2_knowledge_sessions', 'event_v2_knowledge_executions', 'event_v2_knowledge_answers', 'event_v2_reaction_counts', 'presentation_sessions', 'knowledge_activity_executions', 'presentation_reaction_counts']) result[table] = Number((await sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n); return result;
  };
  await t.test('report HTTP authenticates accounts, requires explicit Admin and never initializes idle engines or nominal data', async () => {
    const before = await counts(), states = [runtime.states.size, avRuntime.states.size], preparationReads = f.preparationReads();
    for (const suffix of ['qna/history', 'qna/export.csv', 'knowledge/history', 'reactions', 'reactions/export.csv']) {
      const result = await get('admin1', path(suffix)); assert.equal(result.status, 200, result.text);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      for (const [actor, status] of [[null, 401], ['platform', 404], ['producer', 403], ['dual', 403], ['member', 404], ['admin2', 404]]) assert.equal((await get(actor, path(suffix), { 'x-role': 'ADMIN' })).status, status);
    }
    assert.deepEqual(await counts(), before); assert.deepEqual([runtime.states.size, avRuntime.states.size], states); assert.equal(f.preparationReads(), preparationReads);
    stage = await issue('STAGE', { stageId: stageA }); speaker = await issue('SPEAKER', { activityId: activityA }); player = await issue('PLAYER', { liveSessionId: live });
    alice = await register('=SUM(1,2)'); bob = await register('東京, "Ana"');
    for (const session of [stage, speaker, player, alice]) assert.equal((await get(null, path('qna/export.csv'), { cookie: session.cookie, authorization: 'Bearer ' + session.sessionToken })).status, 401);
    assert.equal((await get('admin1', path('qna/history'), { 'sec-fetch-site': 'cross-site' })).status, 403);
  });
  await t.test('Q&A history and CSV use committed private rounds, bounded cursors and exact Unicode; event/live/org substitutions never expose rows', async () => {
    await runtime.operate(grants, credentials(stage), live);
    await qnaRuntime.operate(grants, credentials(stage), live, 'open', {});
    let round = (await sql('SELECT id FROM event_v2_qna_rounds WHERE presentation_session_id=? AND archived_at IS NULL', [live]))[0].id;
    await qnaRuntime.operate(grants, credentials(alice), live, 'submit', { roundId: round, question: '=HYPERLINK("https://example.invalid")', name: '=SUM(1,2)', allowNameOnScreen: false });
    await qnaRuntime.operate(grants, credentials(bob), live, 'submit', { roundId: round, question: 'Pregunta, "東京"\nSegunda línea', allowNameOnScreen: true });
    aliceQuestion = (await sql('SELECT id FROM event_v2_qna_questions WHERE audience_id=? AND qna_round_id=?', [alice.context.participantId, round]))[0].id;
    await qnaRuntime.operate(grants, credentials(stage), live, 'project', { roundId: round, questionId: aliceQuestion });
    await qnaRuntime.operate(grants, credentials(stage), live, 'new_round', { roundId: round });
    round = (await sql('SELECT id FROM event_v2_qna_rounds WHERE presentation_session_id=? AND archived_at IS NULL', [live]))[0].id;
    await qnaRuntime.operate(grants, credentials(alice), live, 'submit', { roundId: round, question: 'Ronda nueva', allowNameOnScreen: false });
    const first = await get('admin1', path('qna/history?limit=1')); assert.equal(first.status, 200, first.text); assert.equal(first.data.questions.length, 1); assert.ok(first.data.nextAfter);
    const rest = await get('admin1', path('qna/history?limit=2&after=' + first.data.nextAfter)); assert.equal(rest.data.questions.length, 2); assert.equal(rest.data.nextAfter, null);
    assert.equal(new Set([...first.data.questions, ...rest.data.questions].map(q => q.id)).size, 3);
    const exported = await get('admin1', path('qna/export.csv?limit=1')); assert.equal(exported.status, 200, exported.text); assert.equal(exported.headers.get('x-report-row-count'), '1'); assert.ok(exported.headers.get('x-report-next-after'));
    const all = await get('admin1', path('qna/export.csv?limit=3')); assert.match(all.text, /"\t=SUM\(1,2\)"/); assert.match(all.text, /"\t=HYPERLINK\(""/); assert.match(all.text, /東京/);
    assert.equal((await get('admin1', path('qna/history?limit=0'))).status, 400); assert.equal((await get('admin1', path('qna/history?role=ADMIN'))).status, 400);
    for (const target of [path('qna/history', foreign), path('qna/history', live, b), path('qna/history', live, a, o2)]) assert.equal((await get('admin1', target)).status, 404);
    assert.deepEqual((await get('admin1', path('qna/history', second))).data.questions, []);
    const head = await get('admin1', path('qna/export.csv'), {}, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.text, '');
    assert.equal((await get(null, '/api/qna/export/a_1234567890')).status, 404);
    assert.equal((await get(null, '/api/qna/history/a_1234567890', {}, 'DELETE')).status, 404);
    assert.equal((await get(null, '/api/qna/export/a_abcdefghij')).status, 200);
  });
  async function openKnowledge(definitionId) {
    await knowledgeRuntime.operate(grants, credentials(stage), live, 'open', { definitionId });
    return (await sql('SELECT latest_execution_id FROM event_v2_knowledge_sessions WHERE id=?', [live]))[0].latest_execution_id;
  }
  const act = (session, id, command, extra = {}) => knowledgeRuntime.operate(grants, credentials(session), live, command, { executionId: id, tabId: 'reports-tab', ...extra });
  async function control(id, command) { const revision = Number((await sql('SELECT revision FROM event_v2_knowledge_executions WHERE id=?', [id]))[0].revision); return act(stage, id, command, { expectedRevision: revision }); }
  await t.test('real assessment and Trivia results export only authorized completed rows; pagination never hydrates recovery secrets or answer keys', async () => {
    f.setKnowledgeClockOffset(0); assessmentId = await openKnowledge('assessment');
    assert.equal((await get('admin1', path(`knowledge/${assessmentId}/results`))).status, 409);
    for (const session of [alice, bob]) await act(session, assessmentId, 'join');
    await control(assessmentId, 'start'); f.setKnowledgeClockOffset(5001); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick');
    await act(alice, assessmentId, 'answer', { questionId: 'q', optionId: 'yes', attemptId: crypto.randomUUID() });
    await act(bob, assessmentId, 'answer', { questionId: 'q', optionId: 'no', attemptId: crypto.randomUUID() });
    f.setKnowledgeClockOffset(6001); await control(assessmentId, 'finalize'); f.setKnowledgeClockOffset(10001); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick');
    const first = await get('admin1', path(`knowledge/${assessmentId}/results?limit=1`)); assert.equal(first.status, 200, first.text); assert.equal(first.data.rowCount, 2); assert.equal(first.data.rows.length, 1); assert.equal(first.data.nextOffset, 1);
    const last = await get('admin1', path(`knowledge/${assessmentId}/results?offset=1&limit=1`)); assert.equal(last.data.nextOffset, null); assert.equal(last.data.rows.length, 1);
    const both = await get('admin1', path(`knowledge/${assessmentId}/results?limit=2`)); assert.equal(both.status, 200, both.text); assert.equal(both.data.rows.length, 2); assert.equal(both.data.rows.some(row => row.grade === 100), true); assert.equal(both.data.rows.some(row => row.grade === 0), true);
    for (const secret of ['recoveryTokenHash', 'activeTabId', 'clientAttemptId', 'correctOptionId', alice.context.participantId, bob.context.participantId]) assert.equal(both.text.includes(secret), false);
    const output = await get('admin1', path(`knowledge/${assessmentId}/export.csv?limit=1`)); assert.equal(output.status, 200, output.text); assert.equal(output.headers.get('x-report-next-offset'), '1');
    const complete = await get('admin1', path(`knowledge/${assessmentId}/export.csv?limit=2`)); assert.match(complete.text, /"\t=SUM\(1,2\)"/); assert.match(complete.text, /東京/);
    assert.equal((await get('producer', path(`knowledge/${assessmentId}/export.csv`))).status, 403);
    assert.equal((await get('admin1', path(`knowledge/${assessmentId}/results`, second))).status, 404);
    assert.equal((await get(null, `/api/knowledge-activities/${assessmentId}/export/a_abcdefghij`)).status, 404);
    await control(assessmentId, 'close'); triviaId = await openKnowledge('trivia'); await act(alice, triviaId, 'join'); await control(triviaId, 'start');
    f.setKnowledgeClockOffset(16002); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick'); await act(alice, triviaId, 'answer', { questionId: 'q', optionId: 'yes', attemptId: crypto.randomUUID() });
    f.setKnowledgeClockOffset(21003); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick'); f.setKnowledgeClockOffset(26004); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick');
    f.setKnowledgeClockOffset(31005); await knowledgeRuntime.operate(grants, credentials(stage), live, 'tick');
    const trivia = await get('admin1', path(`knowledge/${triviaId}/export.csv`)); assert.equal(trivia.status, 200, trivia.text); assert.match(trivia.text, /Posición/); assert.match(trivia.text, /"1"/); await control(triviaId, 'close');
    const history = await get('admin1', path('knowledge/history?limit=1')); assert.equal(history.status, 200, history.text); assert.equal(history.data.executions.length, 1); assert.ok(history.data.nextAfter);
    const following = await get('admin1', path('knowledge/history?after=' + history.data.nextAfter)); assert.equal(following.data.executions.length, 1);
    assert.equal(history.text.includes('=SUM'), false); assert.equal(following.text.includes('東京'), false);
    const before = await counts(); await get('admin1', path(`knowledge/${assessmentId}/results`)); await get('admin1', path('qna/history')); assert.deepEqual(await counts(), before);
  });
  await t.test('tampered record, source, participant and LiveSession relations fail closed without foreign names or private snapshot data', async () => {
    await sql('UPDATE event_v2_qna_sessions SET stage_id=? WHERE id=?', [stageB, live]); assert.equal((await get('admin1', path('qna/history'))).status, 409); await sql('UPDATE event_v2_qna_sessions SET stage_id=? WHERE id=?', [stageA, live]);
    const foreignParticipant = crypto.randomUUID(); await sql('INSERT INTO event_participants (id,event_workspace_id,registration_key_hash,audience_level) VALUES (?,?,?,?)', [foreignParticipant, b, crypto.randomBytes(32).toString('hex'), 'FREE']);
    await sql('UPDATE event_v2_qna_questions SET audience_id=? WHERE id=?', [foreignParticipant, aliceQuestion]); assert.equal((await get('admin1', path('qna/export.csv'))).status, 409); await sql('UPDATE event_v2_qna_questions SET audience_id=? WHERE id=?', [alice.context.participantId, aliceQuestion]);
    const result = (await sql('SELECT result_json FROM event_v2_knowledge_results WHERE execution_id=?', [assessmentId]))[0].result_json;
    const original = typeof result === 'string' ? JSON.parse(result) : result, corrupted = structuredClone(original); corrupted.rows[0].participantId = foreignParticipant; corrupted.rows[0].label = 'FOREIGN_REPORT_SECRET';
    await sql('UPDATE event_v2_knowledge_results SET result_json=? WHERE execution_id=?', [JSON.stringify(corrupted), assessmentId]); const rejected = await get('admin1', path(`knowledge/${assessmentId}/results`)); assert.equal(rejected.status, 409); assert.equal(rejected.text.includes('FOREIGN_REPORT_SECRET'), false);
    await sql('UPDATE event_v2_knowledge_results SET result_json=? WHERE execution_id=?', [JSON.stringify(original), assessmentId]);
    await sql('UPDATE event_v2_knowledge_sessions SET source_session_id=? WHERE id=?', [executionKey(b, foreign), live]); assert.equal((await get('admin1', path('knowledge/history'))).status, 409); await sql('UPDATE event_v2_knowledge_sessions SET source_session_id=? WHERE id=?', [executionKey(a, live), live]);
    await sql('UPDATE event_live_sessions SET event_stage_id=? WHERE id=?', [stageB, live]); assert.equal((await get('admin1', path('qna/history'))).status, 404); await sql('UPDATE event_live_sessions SET event_stage_id=? WHERE id=?', [stageA, live]);
    assert.equal((await get('admin1', path('qna/history?after=' + crypto.randomUUID()))).status, 400);
    assert.equal((await get('admin1', path('knowledge/history?after=' + crypto.randomUUID()))).status, 400);
  });
  await t.test('separate reaction reports preserve unsigned BIGINT counts exactly and do not mutate legacy metrics; finished LiveSessions remain readable by Admin', async () => {
    const legacy = Number((await sql('SELECT COUNT(*) AS n FROM presentation_reaction_counts'))[0].n);
    await avRuntime.operate(grants, credentials(alice), live, 'react', { emoji: '❤️' });
    await sql('UPDATE event_v2_reaction_counts SET heart_count=?, clap_count=7, fire_count=5 WHERE id=?', ['18446744073709551615', live]);
    const result = await get('admin1', path('reactions')); assert.equal(result.status, 200, result.text); assert.deepEqual(result.data.counts, { heart: '18446744073709551615', clap: '7', fire: '5', total: '18446744073709551627' });
    const output = await get('admin1', path('reactions/export.csv')); assert.match(output.text, /"\t18446744073709551627"/); assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM presentation_reaction_counts'))[0].n), legacy);
    await sql("UPDATE event_live_sessions SET status='FINISHED', ended_at=? WHERE id=?", [f.now(), live]);
    preparations.delete(live); runtime.states.delete(executionKey(a, live)); avRuntime.states.delete(executionKey(a, live));
    assert.equal((await get('admin1', path('qna/history'))).status, 200); assert.equal((await get('admin1', path(`knowledge/${assessmentId}/export.csv`))).status, 200);
    const before = await counts(); f.setEnabled(false); assert.equal((await get('admin1', path('qna/export.csv'))).status, 404); assert.equal((await get(null, `/api/knowledge-activities/${assessmentId}/export/a_abcdefghij`)).status, 404); f.setEnabled(true); assert.deepEqual(await counts(), before);
  });
  await t.test('account role and organization revocation use the same authorization lock; subsequent reads cannot reuse a cached export', async () => {
    await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('dual'), ['ADMIN', 'PRODUCER']);
    let enteredResolve, releaseResolve, changed = false;
    const entered = new Promise(resolve => { enteredResolve = resolve; }), release = new Promise(resolve => { releaseResolve = resolve; });
    const resource = reports.resource; reports.resource = async function (...args) { const value = await resource.apply(this, args); enteredResolve(); await release; return value; };
    try {
      const reading = get('dual', path('qna/export.csv')); await entered;
      const revoking = domain.setEventMember(ids.get('admin1'), o1, a, ids.get('dual'), ['PRODUCER']).then(() => { changed = true; });
      await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(changed, false); releaseResolve(); assert.equal((await reading).status, 200); await revoking;
    } finally { releaseResolve(); reports.resource = resource; }
    assert.equal((await get('dual', path('qna/export.csv'))).status, 403);
    await domain.setOrganizationMember(ids.get('admin1'), o1, ids.get('dual'), null); assert.equal((await get('dual', path('qna/history'))).status, 404);
    await domain.setOrganizationMember(ids.get('admin1'), o1, ids.get('dual'), 'MEMBER');
    for (const event of [a, b]) await domain.setEventMember(ids.get('admin1'), o1, event, ids.get('dual'), ['PRODUCER']);
  });
  await t.test('HTTP never sends nominal content before authorization commits; injected DB failure returns only a sanitized 503', async () => {
    const original = reports.domain, before = await counts(), auditRows = Number((await sql('SELECT COUNT(*) AS n FROM event_security_audit'))[0].n);
    const faulty = new EventDomainRepository(domain.pool);
    faulty.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('PRIVATE_DB_PASSWORD'); } finally { await db.rollback(); db.release(); } };
    reports.domain = faulty;
    try {
      const response = await get('admin1', path(`knowledge/${assessmentId}/export.csv`), { 'If-None-Match': '"private-cached"' });
      assert.equal(response.status, 503); assert.deepEqual(response.data, { code: 'AUTHORIZATION_UNAVAILABLE' }); assert.equal(response.headers.get('content-disposition'), null); assert.equal(response.text.includes('=SUM'), false); assert.equal(response.text.includes('PRIVATE_DB_PASSWORD'), false);
    } finally { reports.domain = original; }
    assert.deepEqual(await counts(), before); assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM event_security_audit'))[0].n), auditRows);
    assert.equal((await get('admin1', path(`knowledge/${assessmentId}/export.csv`))).status, 200);
  });
}
module.exports = { reportsSuite };
