const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPresenterSlide, clampSlide } = require('../presentation-navigation');
const { EventLiveRuntime } = require('../events-v2/live-runtime');
const crypto = require('node:crypto');
test('shared navigation preserves live/presenter indices, clamping and paused transmission', () => {
  const state = { slideCount: 4, transmissionPaused: false, liveSlideIndex: 0 };
  applyPresenterSlide(state, 99);
  assert.deepEqual([state.slideIndex, state.presenterSlideIndex, state.liveSlideIndex], [3, 3, 3]);
  state.transmissionPaused = true; applyPresenterSlide(state, 1);
  assert.deepEqual([state.slideIndex, state.presenterSlideIndex, state.liveSlideIndex], [1, 1, 3]);
  for (const value of [-2, NaN, undefined]) assert.equal(clampSlide(state, value), 0);
  assert.equal(clampSlide({ slideCount: 0 }, 3), 0);
});
test('a DB commit failure cannot create or advance an Events engine', async () => {
  const eventId = crypto.randomUUID(), liveId = crypto.randomUUID(), stageId = crypto.randomUUID();
  const runtime = new EventLiveRuntime({ readPreparation: async live => ({ ...live, versionId: 'v1', slideCount: 4 }) });
  let failCommit = true;
  const db = { execute: async () => [[{ id: liveId, deck_id: 'private', event_activity_id: 'activity', event_stage_id: stageId, access_level: 'FREE' }]] };
  const context = { eventId, kind: 'STAGE', stageId, purpose: 'live' };
  const grants = { withSession: async (_credential, callback) => { const result = await callback(context, db); if (failCommit) throw new Error('commit failed'); return result; } };
  const credential = { eventId };
  await assert.rejects(runtime.operate(grants, credential, liveId), /commit failed/); assert.equal(runtime.states.size, 0);
  failCommit = false; const key = await runtime.operate(grants, credential, liveId), previous = runtime.states.get(key);
  failCommit = true;
  await assert.rejects(runtime.operate(grants, credential, liveId, 'next'), /commit failed/);
  assert.equal(runtime.states.get(key), previous); assert.equal(runtime.queues.size, 0);
});
test('the server default never loads a legacy/public deck into Events', async () => {
  const runtime = new EventLiveRuntime(), eventId = crypto.randomUUID(), liveId = crypto.randomUUID();
  const context = { eventId, kind: 'PLAYER', liveSessionId: liveId };
  const db = { execute: async () => [[{ id: liveId, deck_id: 'demo', event_activity_id: 'activity', event_stage_id: 'stage', access_level: 'FREE' }]] };
  const grants = { withSession: async (_credential, callback) => callback(context, db) };
  await assert.rejects(runtime.operate(grants, { eventId }, liveId), { code: 'CONTENT_NOT_PREPARED' }); assert.equal(runtime.states.size, 0);
});
