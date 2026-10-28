const test = require('node:test');
const assert = require('node:assert/strict');
const { createNonRecordingLifecycle } = require('../non-recording-lifecycle');
const { featureAccessForPlan, canUseFeature, CAPABILITIES, requiredCapabilityForControllerEvent } = require('../auth/plan-features');

function fixture() {
  const rooms = new Map(), events = [], finishes = [];
  const context = (deck = 'deck-a', source = 'source-a', role = 'presenter') => ({ deckId: deck, sessionId: source, roomKey: source + ':' + deck, role });
  for (const [deck, source] of [['deck-a', 'source-a'], ['deck-b', 'source-a'], ['deck-a', 'source-b']]) rooms.set(source + ':' + deck, {});
  const runtime = createNonRecordingLifecycle({
    io: { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) },
    getRoleRoomKey: (room, role) => room + ':' + role,
    getSession: ({ deckId, sourceSessionId }) => rooms.get(sourceSessionId + ':' + deckId),
    onFinish: ctx => finishes.push(ctx), logger: { error() {} }
  });
  return { runtime, rooms, events, finishes, context };
}

test('FREE has session control without gaining metrics, history, exports or interactions', () => {
  const free = featureAccessForPlan('FREE');
  assert.equal(canUseFeature(free, CAPABILITIES.PRESENTATION_LIFECYCLE), true);
  for (const cap of [CAPABILITIES.METRICS_BASIC, CAPABILITIES.METRICS_EXPORT, CAPABILITIES.QNA_RUN, CAPABILITIES.POLLS_RUN, CAPABILITIES.ACCESS_BACKSTAGE]) assert.equal(canUseFeature(free, cap), false);
  assert.equal(free.features.metrics, false);
  for (const event of ['start', 'finish', 'request']) assert.equal(requiredCapabilityForControllerEvent('presentation:lifecycle:' + event), CAPABILITIES.PRESENTATION_LIFECYCLE);
  assert.equal(canUseFeature(featureAccessForPlan('SPEAKER'), CAPABILITIES.METRICS_BASIC), true);
});

test('FREE start is synchronized, idempotent, isolated by source and Deck, and produces no recording identifier', async () => {
  const f = fixture(), ctx = f.context();
  const states = await Promise.all([f.runtime.start(ctx), f.runtime.start(ctx)]);
  assert.deepEqual(states[0], states[1]);
  assert.equal(states[0].mode, 'live'); assert.equal(states[0].recorded, false);
  assert.equal(states[0].presentationSessionId, null);
  assert.equal(f.rooms.get('source-a:deck-b').nonRecordingLifecycle, undefined);
  assert.equal(f.rooms.get('source-b:deck-a').nonRecordingLifecycle, undefined);
  const reconnected = [];
  await f.runtime.sendCurrentState({ emit: (event, state) => reconnected.push(state) }, ctx);
  assert.deepEqual(reconnected, [states[0]]);
});

test('FREE finish broadcasts only its own room, contains no summary and discards transient state', async () => {
  const f = fixture(), ctx = f.context();
  await f.runtime.start(ctx); await f.runtime.start(f.context('deck-b'));
  const result = await f.runtime.finish(ctx);
  assert.equal(result.state.mode, 'test'); assert.equal(result.state.startedAt, null);
  assert.deepEqual(result.completion, { reason: 'FINISHED', deckId: 'deck-a', presentationSessionId: null, recorded: false });
  assert.equal(f.rooms.get(ctx.roomKey).nonRecordingLifecycle, undefined);
  assert.equal(f.rooms.get('source-a:deck-b').nonRecordingLifecycle.mode, 'live');
  const closed = f.events.filter(e => e.event === 'presentation:closed');
  assert.deepEqual(closed.map(e => e.room), ['presenter', 'stage', 'screen', 'audience'].map(role => ctx.roomKey + ':' + role));
  assert.ok(closed.every(e => !('summary' in e.payload)));
  await assert.rejects(f.runtime.finish(ctx), { code: 'NOT_LIVE' });
});

test('Público cannot start or finish the FREE session and null routed contexts are ignored', async () => {
  for (const ctx of [null, fixture().context('deck-a', 'source-a', 'audience')]) {
    const f = fixture(), handlers = new Map();
    f.runtime.attach({ on: (event, handler) => handlers.set(event, handler), emit() {} }, () => ctx);
    await handlers.get('presentation:lifecycle:start')(); await handlers.get('presentation:lifecycle:finish')();
    assert.equal(f.events.length, 0);
  }
});

test('FREE inactivity finishes without a recording and can be started again afterward', async () => {
  const f = fixture(), ctx = { ...f.context(), finishReason: 'INACTIVITY' };
  assert.equal(await f.runtime.finishInactive(ctx), null);
  await f.runtime.start(ctx);
  const closed = await f.runtime.finishInactive(ctx);
  assert.equal(closed.completion.recorded, false); assert.equal(closed.completion.reason, 'INACTIVITY');
  const restarted = await f.runtime.start(ctx); assert.equal(restarted.mode, 'live');
});
