const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../knowledge-activity-engine');
const { createController } = require('../public/events-v2/knowledge-console');
const eventId = '00000000-0000-4000-8000-000000000001', liveId = '00000000-0000-4000-8000-000000000002';
const participantId = '00000000-0000-4000-8000-000000000003', other = '00000000-0000-4000-8000-000000000004';
const definition = category => ({ id: 'def', title: 'Activity', category, identificationMode: 'required_name', questionDurationSeconds: 5, durationSeconds: 30,
  questions: ['q1','q2'].map(id => ({ id, prompt: 'Question ' + id, correctOptionId: 'yes', options: [{ id: 'yes', label: 'Yes' },{ id: 'no', label: 'No' }] })) });
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
function harness(kind = 'STAGE', category = 'contest', command) {
  let clock = 1000000, run = engine.createExecution({ presentationSessionId: liveId, sourceSessionId: eventId + ':' + liveId, deckId: 'PRIVATE', definition: definition(category), nowMs: clock, random: () => .9 });
  let attempt = 0; const sent = [];
  const raw = () => ({ eventId, liveSessionId: liveId, displayName: 'Saved name', available: [{ id: 'def', title: 'Activity', category, private: 'PRIVATE' }],
    execution: run ? engine.stateForRole(run, { role: kind === 'PARTICIPANT' ? 'audience' : kind === 'PLAYER' ? 'screen' : 'stage', participantId, tabId: 'tab', nowMs: clock }) : null, private: 'PRIVATE' });
  const access = { command: async (name, payload) => {
    sent.push({ name, payload }); if (command) return command(name, payload, raw);
    const action = name.split(':').at(-1);
    try {
      if (action === 'join') engine.joinParticipant(run, { participantId, name: payload.name || 'Saved name', tabId: 'tab', nowMs: clock });
      else if (action === 'claim_tab') engine.claimParticipantTab(run, { participantId, tabId: 'tab', nowMs: clock });
      else if (action === 'answer') engine.submitAnswer(run, { participantId, tabId: 'tab', questionId: payload.questionId, optionId: payload.optionId, clientAttemptId: payload.attemptId, nowMs: clock });
      else if (action === 'submit') engine.submitAssessment(run, { participantId, tabId: 'tab', nowMs: clock });
      else if (action !== 'snapshot') ({ start: engine.startExecution, finalize: engine.finalizeExecution, cancel: engine.cancelExecution, close: engine.closeExecution,
        show_results: engine.showResults, retry_processing: engine.retryProcessing, force_results: (r, now) => engine.forceResults(r, { nowMs: now }) })[action](run, clock);
      return { ok: true, snapshot: raw() };
    } catch (e) { return { ok: false, code: 'KNOWLEDGE_' + e.code }; }
  } };
  const controller = createController({ access, createAttemptId: () => 'attempt-' + ++attempt });
  return { controller, access, sent, raw, run: () => run, replace: value => { run = value; },
    ready(generation = 1) { controller.updateAccess({ status: 'ready', generation, context: { kind, eventId, participantId } }); controller.updateLive({ status: 'live', snapshot: { eventId, liveSessionId: liveId } }); },
    admit(tabId = 'tab') { engine.joinParticipant(run, { participantId, name: 'Own', tabId, nowMs: clock }); },
    advance(ms) { clock += ms; engine.tickExecution(run, clock); },
    push() { controller.receive('events:knowledge:state', raw()); }
  };
}
test('Knowledge DTOs retain only role-bounded data; no private definitions, participant rows or answer keys escape to Público/Player', async () => {
  for (const kind of ['STAGE','SPEAKER','PLAYER','PARTICIPANT']) {
    const h = harness(kind); h.admit(); h.ready(); await settle(); const s = h.controller.getState().snapshot;
    assert.equal(h.controller.getState().status, 'ready'); assert.equal(JSON.stringify(s).includes('PRIVATE'), false);
    assert.equal(s.execution.definitionsSnapshot, undefined); assert.equal(s.execution.participants, undefined);
    assert.equal(s.execution.participant?.id, undefined); assert.equal(s.execution.participant?.activeTabId, undefined);
    assert.equal(s.available === undefined, kind === 'PARTICIPANT'); assert.equal(await h.controller.operate('start'), kind !== 'PARTICIPANT');
  }
});
test('Player follows the real contest machine through start, timed reveal, processing and results; menu actions carry exact revisions', async () => {
  const h = harness('PLAYER'); h.admit(); h.ready(); await settle(); const first = h.controller.emergencyActions().find(a => a.action === 'start');
  assert.equal(await h.controller.operate(first.action, first.input), true); assert.equal(h.controller.getState().snapshot.execution.state, 'COUNTDOWN');
  assert.equal(await h.controller.operate('cancel', first.input), false, 'retired menu revision');
  h.advance(4800); h.push(); assert.equal(h.controller.getState().snapshot.execution.currentQuestion.options, undefined);
  engine.submitAnswer(h.run(), { participantId, tabId: 'tab', questionId: 'q1', optionId: 'yes', nowMs: 1004800 });
  h.advance(5100); h.push(); assert.equal(h.controller.getState().snapshot.execution.reveal.correctLabel, 'Yes');
  assert.equal(await h.controller.operate('finalize'), true); assert.equal(h.controller.getState().snapshot.execution.state, 'PROCESSING');
  assert.equal(h.controller.emergencyActions().find(a => a.action === 'force_results').confirm, true);
  assert.equal(await h.controller.operate('force_results'), true); assert.equal(h.controller.getState().snapshot.execution.top10[0].label, 'Own');
  assert.equal(await h.controller.operate('close'), true); assert.deepEqual(h.controller.emergencyActions().map(a => a.action), ['open']);
});
test('admission and active-tab recovery are explicit; reconnect reads do not admit, claim, or replay answers', async () => {
  const h = harness('PARTICIPANT'); h.ready(); await settle(); assert.equal(h.sent.length, 1); assert.equal(h.controller.getState().snapshot.execution.participant, null);
  assert.equal(await h.controller.operate('join', { name: 'Correction' }), true); assert.equal(h.controller.getState().snapshot.execution.participant.label, 'Correction');
  h.run().participants[0].activeTabId = 'other-tab'; h.run().revision++; h.push();
  assert.equal(h.controller.getState().snapshot.execution.participant.tabActive, false); assert.equal(await h.controller.operate('answer', { questionId: 'q1', optionId: 'yes' }), false);
  assert.equal(await h.controller.operate('claim_tab'), true); h.controller.updateAccess({ status: 'retrying' }); h.ready(2); await settle();
  assert.equal(h.sent.filter(x => x.name === 'events:knowledge:join').length, 1); assert.equal(h.sent.filter(x => x.name === 'events:knowledge:claim_tab').length, 1);
});
test('assessment edits use new generated attempts, confirmed answers and one explicit submission; grades wait for publication', async () => {
  const h = harness('PARTICIPANT', 'assessment'); h.admit(); engine.startExecution(h.run(), 1000000); h.advance(4800); h.ready(); await settle();
  assert.equal(await h.controller.operate('answer', { questionId: 'q1', optionId: 'invented' }), false);
  assert.equal(await h.controller.operate('answer', { questionId: 'q1', optionId: 'yes', attemptId: 'forged' }), true);
  assert.equal(await h.controller.operate('answer', { questionId: 'q1', optionId: 'no' }), true);
  const answers = h.sent.filter(x => x.name === 'events:knowledge:answer'); assert.deepEqual(answers.map(x => x.payload.attemptId), ['attempt-1','attempt-2']);
  assert.equal(await h.controller.operate('submit'), true); assert.equal(h.controller.getState().snapshot.execution.submissionReceipt.answeredCount, 1);
  assert.equal(await h.controller.operate('answer', { questionId: 'q2', optionId: 'yes' }), false);
  engine.finalizeExecution(h.run(), 1004800); h.advance(3100); h.push(); assert.equal(h.controller.getState().snapshot.execution.personalResult, null);
  engine.showResults(h.run(), 1007900); h.push(); assert.equal(h.controller.getState().snapshot.execution.personalResult.grade, 0);
});
test('unknown execution events read canonical SQL state; retired runs, lower revisions and foreign Live/events cannot restore old questions', async () => {
  const h = harness('PLAYER'); h.ready(); await settle(); const old = h.raw();
  const next = engine.createExecution({ presentationSessionId: liveId, sourceSessionId: eventId + ':' + liveId, deckId: 'PRIVATE', definition: definition('assessment'), nowMs: 1000001 });
  h.replace(next); h.push(); await settle(); assert.equal(h.controller.getState().snapshot.execution.executionId, next.id);
  h.controller.receive('events:knowledge:state', old); h.controller.receive('events:knowledge:state', { ...h.raw(), eventId: other });
  h.controller.receive('events:knowledge:state', { ...h.raw(), execution: null }); assert.equal(h.controller.getState().snapshot.execution.executionId, next.id);
  h.controller.updateLive({ status: 'finished', snapshot: null }); assert.equal(h.controller.getState().snapshot, null);
});
test('late answer acknowledgements and lost authority cannot resurrect a retired execution or replay its answer', async () => {
  let release;
  const h = harness('PARTICIPANT', 'contest', (name, _payload, raw) => name.endsWith(':answer') ? new Promise(resolve => { release = resolve; }) : { ok: true, snapshot: raw() });
  h.admit(); engine.startExecution(h.run(), 1000000); h.advance(4800); h.ready(); await settle();
  const pending = h.controller.operate('answer', { questionId: 'q1', optionId: 'yes' }); h.controller.updateAccess({ status: 'connecting' });
  release({ ok: true, snapshot: h.raw() }); await pending; assert.equal(h.controller.getState().snapshot, null); h.ready(2); await settle();
  assert.equal(h.sent.filter(x => x.name === 'events:knowledge:answer').length, 1);
});
test('stale server revision recovery reads once without replay; processing recovery and cancellation stay in server-defined states', async () => {
  let stale = false;
  const h = harness('PLAYER', 'assessment', (name, _payload, raw) => name.endsWith(':start') ? (stale = true, { ok: false, code: 'KNOWLEDGE_STALE_REVISION' }) : { ok: true, snapshot: raw() });
  h.admit(); h.ready(); await settle(); assert.equal(await h.controller.operate('start'), false); assert.equal(stale, true);
  assert.equal(h.sent.filter(x => x.name.endsWith(':start')).length, 1); assert.equal(h.sent.filter(x => x.name.endsWith(':snapshot')).length, 2);
  const recovery = harness('PLAYER', 'assessment'); recovery.run().state = 'PROCESSING_ERROR'; recovery.ready(); await settle();
  assert.equal(recovery.controller.availableActions().includes('retry_processing'), true); assert.equal(await recovery.controller.operate('retry_processing'), true);
  assert.equal(await recovery.controller.operate('cancel'), true); assert.equal(recovery.controller.getState().snapshot.execution.state, 'CANCELLED');
});
test('forged own participant, image references and malformed states fail closed, with no public/preparation fallback', async () => {
  const h = harness('PARTICIPANT'); h.admit(); h.ready(); await settle(); const bad = h.raw(); bad.execution.participant.id = other;
  h.controller.receive('events:knowledge:state', bad); assert.equal(h.controller.getState().status, 'unavailable'); assert.equal(h.controller.getState().snapshot, null);
  const player = harness('PLAYER'); player.admit(); engine.startExecution(player.run(), 1000000); player.advance(4800); player.ready(); await settle();
  const image = player.raw(); image.execution.currentQuestion.image = { url: '/decks/private.png' }; player.controller.receive('events:knowledge:state', image); assert.equal(player.controller.getState().status, 'unavailable');
  const unavailable = harness('STAGE', 'contest', () => ({ ok: false, code: 'KNOWLEDGE_CONTENT_NOT_PREPARED' })); unavailable.ready(); await settle(); assert.equal(unavailable.controller.getState().snapshot, null);
});
