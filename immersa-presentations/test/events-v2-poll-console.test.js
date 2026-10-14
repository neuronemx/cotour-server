const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/events-v2/poll-console');
const eventId = '00000000-0000-4000-8000-000000000001', liveId = '00000000-0000-4000-8000-000000000002';
const run = '00000000-0000-4000-8000-000000000003', other = '00000000-0000-4000-8000-000000000004';
function raw(extra = {}) {
  return { eventId, liveSessionId: liveId, revision: 1, pollRunId: run, resultsVisible: true,
    active: { id: 'poll', type: 'poll', title: 'Internal', prompt: 'Question?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], privateScript: 'PRIVATE', en: { prompt: 'English?', options: { a: 'English A' } } },
    available: [{ id: 'poll', title: 'Internal', privateScript: 'PRIVATE' }],
    results: { interactionId: 'poll', totalResponses: 0, options: [{ id: 'a', label: 'A', count: 0, percentage: 0 }, { id: 'b', label: 'B', count: 0, percentage: 0 }], voters: ['PRIVATE'] },
    response: null, privateScript: 'PRIVATE', ...extra };
}
const idle = (revision = 0) => raw({ revision, pollRunId: null, active: null, results: null, resultsVisible: false });
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(kind = 'STAGE', command) {
  const sent = []; let current = raw(), controller;
  const access = { command: async (name, payload) => { sent.push({ name, payload }); return command ? command(name, payload) : { ok: true, snapshot: current }; } };
  controller = createController({ access });
  const ready = (generation = 1) => { controller.updateAccess({ status: 'ready', generation, context: { kind, eventId, participantId: 'own', purpose: kind === 'PLAYER' ? 'player' : kind === 'PARTICIPANT' ? 'public' : 'live' } }); controller.updateLive({ status: 'live', snapshot: { eventId, liveSessionId: liveId } }); };
  return { controller, ready, sent, current: value => { current = value; } };
}

test('four console kinds receive only canonical bounded poll projections and allowed controls', async () => {
  for (const kind of ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT']) {
    const h = harness(kind); h.ready(); await settle(); const state = h.controller.getState(); assert.equal(state.status, 'ready');
    assert.equal(JSON.stringify(state).includes('PRIVATE'), false);
    if (kind === 'PARTICIPANT') { assert.equal(state.snapshot.available, undefined); assert.equal(state.snapshot.results, undefined); assert.equal(state.snapshot.active.title, undefined); }
    if (kind === 'PLAYER') assert.equal(state.snapshot.active.title, undefined);
    assert.equal(await h.controller.operate('hide'), kind !== 'PARTICIPANT');
    assert.equal(await h.controller.operate('submit', { optionId: 'a' }), kind === 'PARTICIPANT');
    assert.equal(await h.controller.operate('launch', { interactionId: 'invented' }), false);
  }
});
test('old revisions, foreign events and executions cannot replace a current poll; disconnect clears controls', async () => {
  const h = harness(); h.ready(); await settle(); h.controller.receive('events:poll:state', raw({ revision: 4, pollRunId: other }));
  for (const snapshot of [raw({ revision: 3 }), raw({ revision: 50, eventId: other }), raw({ revision: 50, liveSessionId: other })]) h.controller.receive('events:poll:state', snapshot);
  assert.equal(h.controller.getState().snapshot.pollRunId, other);
  h.controller.updateAccess({ status: 'retrying' }); assert.equal(h.controller.getState().snapshot, null); assert.equal(await h.controller.operate('close'), false);
});
test('late mutation acknowledgement cannot restore state; recovery reads only and never resubmits a vote', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = harness('PARTICIPANT', name => name === 'events:poll:submit' ? pending : { ok: true, snapshot: raw() });
  h.ready(); await settle(); const action = h.controller.operate('submit', { optionId: 'a' });
  h.controller.updateAccess({ status: 'connecting' }); release({ ok: true, snapshot: raw({ response: { optionId: 'a', submittedAt: new Date().toISOString() } }) }); await action;
  assert.equal(h.controller.getState().snapshot, null); h.ready(2); await settle();
  assert.equal(h.sent.filter(row => row.name === 'events:poll:submit').length, 1); assert.equal(h.sent.filter(row => row.name === 'events:poll:snapshot').length, 2);
});
test('duplicate vote recovery reads the own receipt; unrelated actors and invalid aggregates fail closed', async () => {
  let submitted = false;
  const h = harness('PARTICIPANT', name => { if (name === 'events:poll:submit') { submitted = true; return { ok: false, code: 'POLL_DUPLICATE_RESPONSE' }; }
    return { ok: true, snapshot: raw({ response: submitted ? { optionId: 'b', submittedAt: new Date().toISOString() } : null }) }; });
  h.ready(); await settle(); assert.equal(await h.controller.operate('submit', { optionId: 'a' }), false);
  assert.equal(h.controller.getState().snapshot.response.optionId, 'b'); assert.equal(await h.controller.operate('submit', { optionId: 'a' }), false);
  h.controller.receive('events:poll:state', raw({ revision: 9, response: { audienceId: 'foreign', optionId: 'a', submittedAt: new Date().toISOString() } })); assert.equal(h.controller.getState().snapshot, null);
  const stage = harness(); stage.ready(); await settle(); stage.controller.receive('events:poll:state', raw({ revision: 3, results: { interactionId: 'poll', totalResponses: 1, options: [{ id: 'a', count: 2, percentage: 200 }, { id: 'b', count: 0, percentage: 0 }] } }));
  assert.equal(stage.controller.getState().status, 'unavailable'); assert.equal(await stage.controller.operate('close'), false);
});
test('Player emergency actions complete the real poll cycle without assigning Stage or lifecycle permissions', async () => {
  const h = harness('PLAYER'); h.current(idle()); h.ready(); await settle(); assert.deepEqual(h.controller.emergencyActions().map(row => row.title), ['Internal']);
  h.current(raw()); assert.equal(await h.controller.operate('launch', { interactionId: 'poll' }), true);
  assert.deepEqual(h.controller.emergencyActions().map(row => row.action), ['hide', 'close']);
  h.current(raw({ revision: 2, resultsVisible: false, results: raw().results })); await h.controller.operate('hide'); assert.equal(h.controller.getState().snapshot.results, null);
  assert.deepEqual(h.controller.emergencyActions().map(row => row.action), ['show', 'close']);
  h.current(idle(3)); await h.controller.operate('close'); assert.equal(h.controller.getState().snapshot.active, null);
  assert.equal(await h.controller.operate('finish'), false);
});
test('missing private preparation has no public fallback and finish removes the live-bound poll projection', async () => {
  const h = harness('STAGE', () => ({ ok: false, code: 'POLL_CONTENT_NOT_PREPARED' })); h.ready(); await settle();
  assert.equal(h.controller.getState().status, 'unavailable'); assert.equal(h.controller.getState().snapshot, null); assert.equal(await h.controller.operate('launch', { interactionId: 'poll' }), false);
  const other = harness(); other.ready(); await settle(); other.controller.updateLive({ status: 'finished', snapshot: null });
  assert.equal(other.controller.getState().snapshot, null);
});
