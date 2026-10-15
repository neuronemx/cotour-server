const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const { createController: createKnowledge } = require('../../public/events-v2/knowledge-console');

// Shipped controllers with actual HTTP/SQL/Socket.IO, controlled private
// preparation and a fixed engine clock. This is not browser acceptance.
async function consoleKnowledgeSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Knowledge console', otherStage, a, 'Other Knowledge console']);
  const question = { id: 'question', prompt: 'Prepared question', correctOptionId: 'right', options: [{ id: 'right', label: 'Right' }, { id: 'wrong', label: 'Wrong' }] };
  const definitions = [
    { id: 'trivia', category: 'contest', title: 'Trivia', identificationMode: 'optional_name', questionDurationSeconds: 300, questions: [question] },
    { id: 'evaluation', category: 'assessment', title: 'Evaluation', identificationMode: 'required_name', durationSeconds: 10800, questions: [question, { ...question, id: 'second', prompt: 'Second question' }] }
  ];
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'Knowledge fixture', 'console-knowledge-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-knowledge-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-knowledge-deck', versionId: 'console-knowledge-v1', slideCount: 5,
      knowledge: definitions, polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }], raffles: [], games: [], resources: [], playlists: [] });
  }
  let clock = 0; f.setKnowledgeClockOffset(clock);
  const active = new Set();
  const close = () => { for (const c of active) c.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console Knowledge timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, knowledge; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { knowledge.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); knowledge.receive(name, value); } });
    live = createLive({ access, onState: state => knowledge?.updateLive(state) }); knowledge = createKnowledge({ access });
    const record = { access, live, knowledge, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && knowledge.getState().status === 'ready' && !knowledge.getState().pending, 'snapshot'),
      snapshot: () => knowledge.getState().snapshot, run: () => knowledge.getState().snapshot?.execution };
    active.add(record); return record;
  }
  const stage = open(await issue('stage', 'STAGE', { stageId }));
  const speakerItem = await issue('speaker', 'SPEAKER', { activityId: activity }), speaker = open(speakerItem);
  const player = open(await issue('screen', 'PLAYER', { liveSessionId: liveId }));
  const registered = await request(null, 'POST', `/api/events-v2/public/${f.publicId}/participants`, { name: 'Registered name' }); assert.equal(registered.status, 201);
  const attendeeItem = { view: 'audience', issued: { grantId: registered.body.context.grantId }, cookie: registered.headers.get('set-cookie').split(';')[0] }, attendee = open(attendeeItem);
  const action = async name => {
    await player.ready(); assert.equal(await player.knowledge.refresh(), true);
    const candidate = player.knowledge.emergencyActions().find(row => row.action === name); assert.ok(candidate, name + ': ' + JSON.stringify(player.knowledge.getState()));
    assert.equal(await player.knowledge.operate(candidate.action, candidate.input), true, name + ': ' + JSON.stringify(player.knowledge.getState()));
  };
  const advance = async ms => { await player.ready(); clock += ms; f.setKnowledgeClockOffset(clock); assert.equal(await player.knowledge.refresh(), true); };
  const refreshPublic = async () => { await attendee.ready(); assert.equal(await attendee.knowledge.refresh(), true, JSON.stringify(attendee.knowledge.getState())); };
  let trivia, evaluation;
  try {
    await t.test('shipped Knowledge consoles read without initialization, preserve role privacy and Q&A coexistence', async () => {
      for (const c of [stage, speaker, player, attendee]) await c.start();
      assert.equal(stage.run(), null); assert.deepEqual(stage.snapshot().available.map(row => row.id), ['trivia','evaluation']);
      assert.equal(await attendee.knowledge.operate('open', { definitionId: 'trivia' }), false);
      assert.equal(await speaker.knowledge.operate('open', { definitionId: 'trivia' }), true); trivia = speaker.run().executionId;
      await until(() => player.run()?.executionId === trivia && attendee.run()?.executionId === trivia, 'open fanout');
      assert.equal(player.run().definitionSnapshot, undefined); assert.equal(attendee.snapshot().available, undefined);
      assert.equal((await stage.access.command('events:qna:open')).ok, true);
      assert.equal((await stage.access.command('events:poll:launch', { interactionId: 'poll' })).code, 'INTERACTION_BUSY');
      speaker.access.close();
    });
    await t.test('explicit Knowledge admission and tab claim preserve saved name and participant without automatic takeover', async () => {
      assert.equal(attendee.snapshot().displayName, 'Registered name');
      assert.equal(await attendee.knowledge.operate('join', { name: 'Corrected name' }), true);
      const same = open({ ...attendeeItem, cookie: attendee.cookie() }); await same.start();
      assert.equal(same.run().participant.tabActive, false); assert.equal(same.snapshot().displayName, 'Corrected name');
      assert.equal(same.commands.includes('events:knowledge:join'), false); assert.equal(same.commands.includes('events:knowledge:claim_tab'), false);
      assert.equal(await same.knowledge.operate('claim_tab'), true); await refreshPublic(); assert.equal(attendee.run().participant.tabActive, false);
      assert.equal(await attendee.knowledge.operate('claim_tab'), true); same.access.close();
      await action('start'); await advance(4800); await refreshPublic();
      assert.equal(attendee.run().currentQuestion.id, 'question'); assert.equal(attendee.run().currentQuestion.correctOptionId, undefined);
      assert.equal(player.run().currentQuestion.options, undefined); assert.equal(player.run().reveal, null);
    });
    await t.test('lost Knowledge answer acknowledgement recovers the committed receipt without replay; Player reveals, retries, forces and closes', async () => {
      const socket = attendee.sockets.at(-1), emit = socket.emit.bind(socket); let dropped = false;
      const before = {}; for (const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions']) before[table] = Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n);
      const actor = attendee.access.getState().context.actorId;
      socket.emit = (name, ...args) => { if (name === 'events:knowledge:answer' && !dropped) { dropped = true; args.pop(); return emit(name, ...args, () => {}); } return emit(name, ...args); };
      await attendee.knowledge.operate('answer', { questionId: 'question', optionId: 'right' });
      await until(() => attendee.sockets.at(-1) !== socket && attendee.run()?.answerCount === 1 && attendee.knowledge.getState().status === 'ready', 'lost answer receipt');
      assert.equal(attendee.commands.filter(n => n === 'events:knowledge:answer').length, 1); assert.equal(attendee.run().participant.tabActive, false);
      assert.equal(attendee.access.getState().context.actorId, actor);
      assert.equal(Number((await sql('SELECT COUNT(*) n FROM event_v2_knowledge_answers WHERE execution_id = ?', [trivia]))[0].n), 1);
      for (const table of Object.keys(before)) assert.equal(Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n), before[table]);
      assert.equal(await attendee.knowledge.operate('claim_tab'), true);
      await advance(300100); await refreshPublic(); assert.equal(player.run().reveal.correctLabel, 'Right'); assert.equal(attendee.run().reveal.correct, true);
      await advance(5100); assert.equal(player.run().state, 'PROCESSING');
      const stored = (await sql('SELECT snapshot_json FROM event_v2_knowledge_executions WHERE id = ?', [trivia]))[0].snapshot_json;
      const fixture = typeof stored === 'string' ? JSON.parse(stored) : stored; fixture.state = 'PROCESSING_ERROR'; fixture.processingReadyAt = null;
      await sql("UPDATE event_v2_knowledge_executions SET state = 'PROCESSING_ERROR', snapshot_json = ? WHERE id = ?", [JSON.stringify(fixture), trivia]);
      await action('retry_processing'); assert.equal(player.run().state, 'RESULTS_VISIBLE');
      const storedAgain = (await sql('SELECT snapshot_json FROM event_v2_knowledge_executions WHERE id = ?', [trivia]))[0].snapshot_json;
      const forcing = typeof storedAgain === 'string' ? JSON.parse(storedAgain) : storedAgain; forcing.state = 'PROCESSING'; forcing.result = null; forcing.resultsVisible = false; forcing.processingReadyAt = new Date(f.knowledgeClockStart() + clock + 3000).toISOString();
      await sql('DELETE FROM event_v2_knowledge_results WHERE execution_id = ?', [trivia]);
      await sql("UPDATE event_v2_knowledge_executions SET state = 'PROCESSING', snapshot_json = ? WHERE id = ?", [JSON.stringify(forcing), trivia]);
      await action('force_results'); assert.equal(player.run().top10[0].label, 'Corrected name');
      await refreshPublic(); assert.equal(attendee.run().personalResult.correctCount, 1); await action('close');
    });
    await t.test('assessment edits, explicit submission and cookie recovery retain own receipt and delay private grades until publication', async () => {
      await player.ready(); assert.equal(await player.knowledge.operate('open', { definitionId: 'evaluation' }), true); evaluation = player.run().executionId;
      await refreshPublic(); assert.equal(await attendee.knowledge.operate('join'), true); await action('start'); await advance(4800); await refreshPublic();
      assert.deepEqual(new Set(attendee.run().questions.map(q => q.id)), new Set(['question','second']));
      assert.equal(await attendee.knowledge.operate('answer', { questionId: 'question', optionId: 'wrong' }), true);
      assert.equal(await attendee.knowledge.operate('answer', { questionId: 'question', optionId: 'right' }), true);
      assert.equal(await attendee.knowledge.operate('answer', { questionId: 'second', optionId: 'wrong' }), true);
      assert.equal(await attendee.knowledge.operate('submit'), true); assert.equal(attendee.run().submissionReceipt.answeredCount, 2);
      assert.equal(await attendee.knowledge.operate('answer', { questionId: 'second', optionId: 'right' }), false);
      const previousSocket = attendee.sockets.at(-1); await attendee.access.resume(); await until(() => attendee.sockets.at(-1) !== previousSocket && attendee.run()?.submissionReceipt, 'assessment cookie recovery'); await attendee.ready();
      assert.equal(attendee.run().participant.tabActive, false); assert.equal(attendee.run().personalResult, null);
      await action('finalize'); await advance(3100); await refreshPublic(); assert.equal(player.run().state, 'RESULTS_READY'); assert.equal(attendee.run().personalResult, null);
      await action('show_results'); await refreshPublic(); assert.equal(attendee.run().personalResult.grade, 50);
      assert.equal(player.run().participants, undefined); assert.equal(player.run().result, null); assert.equal(player.run().personalResult, undefined); await action('close');
    });
    await t.test('Knowledge stale runs, cancellation, grant revocation and Live finish cannot affect a separate execution', async () => {
      await player.ready(); assert.equal(await player.knowledge.operate('open', { definitionId: 'trivia' }), true); const next = player.run().executionId;
      assert.notEqual(next, trivia); assert.notEqual(next, evaluation);
      const stale = await attendee.access.command('events:knowledge:answer', { executionId: trivia, questionId: 'question', optionId: 'right', attemptId: crypto.randomUUID() }); assert.equal(stale.code, 'KNOWLEDGE_STALE_EXECUTION');
      const other = open(await issue('screen', 'PLAYER', { liveSessionId: otherLive }), otherActivity); await other.start();
      assert.equal(await other.knowledge.operate('open', { definitionId: 'trivia' }), true); const separate = other.run().executionId;
      await action('cancel'); assert.equal(player.run().state, 'CANCELLED'); assert.equal(other.run().state, 'LOBBY');
      const revoked = open({ ...speakerItem, issued: { grantId: speakerItem.issued.grantId }, cookie: speaker.cookie() }); await revoked.start();
      await grants.revoke(admin, o1, a, speakerItem.issued.grantId); await f.grantSockets.reviewAll(); await until(() => revoked.access.getState().status === 'denied', 'revoked');
      assert.equal(revoked.snapshot(), null); assert.equal(await revoked.knowledge.operate('open', { definitionId: 'trivia' }), false);
      // The authorized finish event can retire the pending ack before it
      // returns. Verify committed completion and a single command, not ack order.
      const finishes = stage.commands.filter(name => name === 'events:lifecycle:finish').length;
      assert.equal(stage.live.getState().status, 'live'); await stage.live.operate('finish');
      await until(() => stage.live.getState().status === 'finished' && player.snapshot() === null && attendee.snapshot() === null, 'finished');
      assert.equal(stage.commands.filter(name => name === 'events:lifecycle:finish').length, finishes + 1);
      assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id = ?', [liveId]))[0].status, 'FINISHED');
      assert.equal(other.run().executionId, separate); assert.equal(other.run().state, 'LOBBY');
    });
  } finally { close(); f.setKnowledgeClockOffset(0); }
}
module.exports = { consoleKnowledgeSuite };
