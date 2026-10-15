const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/events-v2/qna-console');
const eventId = '00000000-0000-4000-8000-000000000001', liveId = '00000000-0000-4000-8000-000000000002';
const round = '00000000-0000-4000-8000-000000000003', questionId = '00000000-0000-4000-8000-000000000004', other = '00000000-0000-4000-8000-000000000005';
function raw(extra = {}) {
  return { eventId, liveSessionId: liveId, revision: 1, roundId: round, roundNumber: 1, questionsOpen: true,
    displayName: 'Own name', hasSubmitted: false, questionId: null, cooldownRemainingMs: 0,
    screen: { visible: false, question: null }, selectedQuestionId: questionId,
    questions: [{ id: questionId, text: 'PRIVATE question', name: 'PRIVATE name', allowNameOnScreen: false, answered: false, audienceId: 'PRIVATE actor' }],
    availableQuestions: [{ id: questionId, label: 'Pregunta 1', answered: false, text: 'PRIVATE question' }], internal: 'PRIVATE script', ...extra };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(kind = 'STAGE', command) {
  let current = raw(); const sent = [];
  const controller = createController({ access: { command: async (name, payload) => { sent.push({ name, payload }); return command ? command(name, payload) : { ok: true, snapshot: current }; } } });
  return { controller, sent, current: v => { current = v; }, ready(generation = 1) {
    controller.updateAccess({ status: 'ready', generation, context: { eventId, kind } });
    controller.updateLive({ status: 'live', snapshot: { eventId, liveSessionId: liveId } });
  } };
}
test('Q&A role projections strip private fields and keep participant intake, own name and receipt only', async () => {
  for (const kind of ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT']) {
    const h = harness(kind); h.ready(); await settle(); const s = h.controller.getState().snapshot;
    assert.equal(h.controller.getState().status, 'ready'); assert.equal(s.internal, undefined);
    if (kind === 'PARTICIPANT') { assert.deepEqual(Object.keys(s).sort(), ['eventId','liveSessionId','revision','roundId','roundNumber','questionsOpen','displayName','hasSubmitted','questionId','cooldownRemainingMs'].sort()); assert.equal(JSON.stringify(s).includes('PRIVATE'), false); }
    if (kind === 'PLAYER') { assert.equal(JSON.stringify(s).includes('PRIVATE'), false); assert.equal(s.questions, undefined); }
    if (kind === 'STAGE') assert.equal(s.questions[0].audienceId, undefined);
    assert.equal(await h.controller.operate('set_open', { open: false }), kind !== 'PARTICIPANT');
    assert.equal(await h.controller.operate('submit', { question: 'Own?', allowNameOnScreen: false, name: '' }), kind === 'PARTICIPANT');
  }
});
test('Q&A rejects stale/foreign snapshots and stale action rounds; finish and disconnect clear authority', async () => {
  const h = harness(); h.ready(); await settle(); h.controller.receive('events:qna:state', raw({ revision: 4, roundId: other, roundNumber: 2 }));
  for (const snapshot of [raw(), raw({ eventId: other, revision: 50 }), raw({ liveSessionId: other, revision: 50 })]) h.controller.receive('events:qna:state', snapshot);
  assert.equal(h.controller.getState().snapshot.roundId, other); assert.equal(await h.controller.operate('new_round', { roundId: round }), false);
  h.controller.updateLive({ status: 'finished', snapshot: null }); assert.equal(h.controller.getState().snapshot, null);
  h.ready(2); await settle(); h.controller.updateAccess({ status: 'denied' }); assert.equal(await h.controller.operate('open'), false); assert.equal(h.controller.getState().snapshot, null);
});
test('Q&A complete Player cycle uses generic candidates and blocks deleting projected questions', async () => {
  const h = harness('PLAYER'); h.current(raw({ roundId: null, roundNumber: 0, questionsOpen: false, availableQuestions: [] })); h.ready(); await settle();
  assert.deepEqual(h.controller.emergencyActions().map(a => a.action), ['open']); h.current(raw()); assert.equal(await h.controller.operate('open'), true);
  for (const action of ['select', 'project', 'delete']) assert.equal(await h.controller.operate(action, { questionId }), true);
  assert.equal(await h.controller.operate('project', { questionId: other }), false);
  const menu = h.controller.emergencyActions(); assert.equal(JSON.stringify(menu).includes('PRIVATE'), false); assert.equal(menu.find(a => a.action === 'new_round').confirm, true);
  h.controller.receive('events:qna:state', raw({ revision: 2, availableQuestions: [{ id: questionId, label: 'Pregunta 1', answered: true }], screen: { visible: true, question: { id: questionId, text: 'Consented projection', name: '' } } }));
  assert.equal(await h.controller.operate('delete', { questionId }), false); assert.equal(h.controller.emergencyActions().some(a => a.action === 'delete'), false);
  assert.equal(await h.controller.operate('panel_close'), true); assert.equal(await h.controller.operate('new_round'), true); assert.equal(await h.controller.operate('finish'), false);
});
test('late Q&A acknowledgements cannot revive retired projections and recovery never replays submissions', async () => {
  let release; const h = harness('PARTICIPANT', name => name === 'events:qna:submit' ? new Promise(resolve => { release = resolve; }) : { ok: true, snapshot: raw() });
  h.ready(); await settle(); const pending = h.controller.operate('submit', { question: 'Question?', allowNameOnScreen: false });
  h.controller.updateAccess({ status: 'retrying' }); release({ ok: true, snapshot: raw({ questionId }) }); await pending;
  assert.equal(h.controller.getState().snapshot, null); h.ready(2); await settle(); assert.equal(h.sent.filter(r => r.name === 'events:qna:submit').length, 1);
  assert.equal(h.sent.filter(r => r.name === 'events:qna:snapshot').length, 2);
});
test('cooldown/closed/stale Q&A command recovery reads authoritative state without retrying the mutation', async () => {
  for (const code of ['QNA_COOLDOWN', 'QNA_CLOSED', 'QNA_STALE_ROUND']) {
    let attempted = false;
    const h = harness('PARTICIPANT', name => name === 'events:qna:submit' ? (attempted = true, { ok: false, code })
      : { ok: true, snapshot: raw(attempted ? { hasSubmitted: true, questionId, cooldownRemainingMs: 9000 } : {}) });
    h.ready(); await settle(); assert.equal(await h.controller.operate('submit', { question: 'Q?', allowNameOnScreen: true }), false);
    assert.equal(h.controller.getState().snapshot.questionId, questionId); assert.equal(await h.controller.operate('submit', { question: 'Again?', allowNameOnScreen: false }), false);
    assert.equal(h.sent.filter(r => r.name === 'events:qna:submit').length, 1);
  }
});
test('malformed Q&A projections and unavailable private preparation fail closed without fallback content', async () => {
  for (const extra of [{ roundNumber: 0 }, { questions: [{ ...raw().questions[0], text: 'x'.repeat(1001) }] }, { screen: { visible: false, question: { id: questionId } } }]) {
    const h = harness(); h.ready(); await settle(); h.controller.receive('events:qna:state', raw({ revision: 3, ...extra })); assert.equal(h.controller.getState().status, 'unavailable');
    assert.equal(h.controller.getState().snapshot, null); assert.equal(await h.controller.operate('new_round'), false);
  }
  const h = harness('STAGE', () => ({ ok: false, code: 'CONTENT_NOT_PREPARED' })); h.ready(); await settle(); assert.equal(h.controller.getState().snapshot, null);
});
