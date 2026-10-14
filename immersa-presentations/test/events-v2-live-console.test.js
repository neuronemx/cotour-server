const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, targetKey } = require('../public/events-v2/live-console');
const event = '00000000-0000-4000-8000-000000000001', activity = '00000000-0000-4000-8000-000000000002';
const stage = '00000000-0000-4000-8000-000000000003', run = '00000000-0000-4000-8000-000000000004';
const other = '00000000-0000-4000-8000-000000000005';
const target = { eventId: event, activityId: activity, stageId: stage, liveSessionId: run, title: 'Own', stageTitle: 'Stage', status: 'LIVE', canStart: false };
const snapshot = (revision = 1, slideIndex = 0) => ({ eventId: event, liveSessionId: run, revision, slideIndex,
  presenterSlideIndex: slideIndex, liveSlideIndex: slideIndex, slideCount: 5, transmissionPaused: false, transmissionPausedBy: null });
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function harness(kind = 'STAGE', command) {
  const sent = [], states = []; let resumes = 0, controller;
  const access = { command: async (name, payload) => { sent.push({ name, payload }); return command ? command(name, payload) : { ok: true, snapshot: snapshot() }; },
    resume: async () => { resumes++; controller.updateAccess({ status: 'connecting' }); } };
  controller = createController({ access, onState: value => states.push(value) });
  const ready = (generation = 1, targets = [target]) => controller.updateAccess({ status: 'ready', generation, targets,
    context: { eventId: event, kind, purpose: kind === 'PLAYER' ? 'player' : kind === 'PARTICIPANT' ? 'public' : 'live', stageId: stage } });
  return { controller, sent, states, ready, resumes: () => resumes };
}

test('Stage/Speaker operate canonical navigation; read-only projections omit control fields', async () => {
  for (const kind of ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT']) {
    const h = harness(kind); h.ready(); if (kind === 'STAGE' || kind === 'PARTICIPANT') await h.controller.select(targetKey(target));
    await settle(); assert.equal(h.controller.getState().status, 'live');
    const canNavigate = kind !== 'PARTICIPANT'; assert.equal(await h.controller.operate('next'), canNavigate);
    assert.equal(await h.controller.operate('pause'), ['STAGE', 'SPEAKER'].includes(kind));
    assert.equal(await h.controller.operate('go', { slideIndex: 3 }), ['STAGE', 'SPEAKER'].includes(kind));
    if (['PLAYER', 'PARTICIPANT'].includes(kind)) {
      assert.equal(h.controller.getState().snapshot.slideCount, undefined); assert.equal(h.controller.getState().snapshot.presenterSlideIndex, undefined);
    }
  }
});

test('cross-run and older revisions cannot replace current snapshots; disconnect clears projections', async () => {
  const h = harness(); h.ready(); await h.controller.select(targetKey(target));
  h.controller.receive('events:live:state', snapshot(3, 2));
  h.controller.receive('events:live:state', { ...snapshot(99, 4), eventId: other });
  h.controller.receive('events:live:state', { ...snapshot(99, 4), liveSessionId: other });
  h.controller.receive('events:live:state', snapshot(2, 1));
  assert.equal(h.controller.getState().snapshot.slideIndex, 2);
  h.controller.updateAccess({ status: 'retrying' }); assert.equal(h.controller.getState().snapshot, null); assert.equal(await h.controller.operate('next'), false);
});

test('late command completion cannot restore disconnected state; reconnect joins only, never replays navigation', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = harness('STAGE', name => name === 'events:slide:next' ? pending : { ok: true, snapshot: snapshot(2, 1) });
  h.ready(); await h.controller.select(targetKey(target)); const action = h.controller.operate('next');
  h.controller.updateAccess({ status: 'retrying' }); release({ ok: true, snapshot: snapshot(100, 4) }); await action;
  assert.equal(h.controller.getState().snapshot, null);
  h.ready(2); await settle(); assert.equal(h.controller.getState().snapshot.slideIndex, 1);
  assert.equal(h.sent.filter(item => item.name === 'events:slide:next').length, 1);
});

test('switching executions requires a fresh connection even if the first join was denied', async () => {
  const second = { ...target, activityId: other, liveSessionId: other };
  const h = harness('STAGE', () => ({ ok: false, code: 'CONTENT_NOT_PREPARED' }));
  h.ready(1, [target, second]); await h.controller.select(targetKey(target));
  assert.equal(h.controller.getState().status, 'unavailable'); await h.controller.select(targetKey(second));
  assert.equal(h.resumes(), 1); assert.equal(h.sent.length, 1);
});

test('only Stage starts/finishes; start obtains the new target from refreshed metadata', async () => {
  const scheduled = { ...target, liveSessionId: null, status: 'SCHEDULED', canStart: true };
  for (const kind of ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT']) {
    const h = harness(kind, () => ({ ok: true, liveSession: { eventId: event, stageId: stage, activityId: activity, liveSessionId: run, status: 'LIVE' } }));
    h.ready(1, [scheduled]); await h.controller.select(targetKey(scheduled));
    assert.equal(await h.controller.operate('start'), kind === 'STAGE'); assert.equal(h.resumes(), kind === 'STAGE' ? 1 : 0);
  }
  const h = harness('STAGE', name => name === 'events:lifecycle:finish'
    ? { ok: true, liveSession: { eventId: event, liveSessionId: run, status: 'FINISHED' } } : { ok: true, snapshot: snapshot() });
  h.ready(); await h.controller.select(targetKey(target)); assert.equal(await h.controller.operate('finish'), true); assert.equal(h.controller.getState().status, 'finished');
});

test('missing preparation creates no usable live projection or command fallback; unknown actions are ignored', async () => {
  const h = harness('SPEAKER', () => ({ ok: false, code: 'CONTENT_NOT_PREPARED' })); h.ready(); await settle();
  assert.equal(h.controller.getState().status, 'unavailable'); assert.equal(h.controller.getState().snapshot, null);
  assert.equal(await h.controller.operate('next'), false); assert.equal(await h.controller.operate('legacy_join'), false);
  assert.deepEqual(h.sent.map(item => item.name), ['events:live:join']);
});
