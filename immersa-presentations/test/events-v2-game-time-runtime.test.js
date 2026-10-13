const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventLiveRuntime } = require('../events-v2/live-runtime');
const { EventGameRuntime, normalizeGames } = require('../events-v2/game-runtime');
const { EventTimeRuntime } = require('../events-v2/time-runtime');
const { BreakoutStore } = require('../breakout-store');
const { PongStore } = require('../pong-store');
const { GameQueueStore } = require('../game-queue-store');
function fixtures() {
  const eventId = crypto.randomUUID(), liveId = crypto.randomUUID(), stageId = crypto.randomUUID(), participantId = crypto.randomUUID();
  let fail = false, enabled = true, now = 100000, reads = 0, versionId = 'v1';
  const context = kind => ({ eventId, kind, stageId: kind === 'PARTICIPANT' ? null : stageId, purpose: 'live', participantId, audienceLevel: 'FREE' });
  const db = { execute: async () => [[{ id: liveId, deck_id: 'private', event_activity_id: 'activity', event_stage_id: stageId, access_level: 'FREE' }]] };
  const grants = { withSession: async (credential, operation) => { const result = await operation(context(credential.kind), db); if (fail) throw new Error('commit failed'); return result; } };
  const live = new EventLiveRuntime({ enabled: () => enabled, readPreparation: async resolved => ({ ...resolved, versionId, slideCount: 3 }) });
  const games = new EventGameRuntime({ liveRuntime: live, now: () => now, readGames: async prepared => { reads++; return { ...prepared, games: [{ id: 'breakout', durationMs: 1000 }, { id: 'pong', durationMs: 1000 }] }; }, setTimeoutFn: () => ({}), clearTimeoutFn: () => {} });
  const time = new EventTimeRuntime({ liveRuntime: live, now: () => now });
  games.connected = async () => [participantId];
  return { games, time, live, context, db, grants, liveId, credentials: kind => ({ eventId, kind, grantId: kind }), reads: () => reads,
    fail: value => { fail = value; }, enabled: value => { enabled = value; }, clock: value => { now = value; }, version: value => { versionId = value; } };
}
test('game catalog rejects unknown/duplicate/malformed definitions and never retains private extras', () => {
  assert.deepEqual(normalizeGames([]), []);
  for (const games of [[{ id: 'unknown', durationMs: 1000 }], [{ id: 'pong', durationMs: 999 }], [{ id: 'pong', durationMs: 1000 }, { id: 'pong', durationMs: 1000 }]]) assert.throws(() => normalizeGames(games), { code: 'GAME_CONTENT_NOT_PREPARED' });
  assert.equal(normalizeGames([{ id: 'pong', durationMs: 1000, private: 'secret' }])[0].private, undefined);
});
test('real game engines accept configured typed controls; legacy defaults keep the original role boundary', () => {
  for (const Store of [BreakoutStore, PongStore]) {
    assert.equal(new Store().prepare('x', 'PLAYER').ok, false);
    assert.equal(new Store({ controlRoles: ['STAGE', 'SPEAKER', 'PLAYER'] }).prepare('x', 'PLAYER').ok, true);
  }
  assert.equal(new GameQueueStore().configure('x', 'PLAYER', ['pong'], ['pong']).ok, false);
  assert.equal(new GameQueueStore({ controlRoles: ['PLAYER'] }).configure('x', 'PLAYER', ['pong'], ['pong']).ok, true);
});
test('failed commits cannot publish game configuration/start/input/physics or Time; denied roles do not read game content', async () => {
  const f = fixtures(), player = f.credentials('PLAYER'), publicActor = f.credentials('PARTICIPANT');
  await f.live.operate(f.grants, player, f.liveId);
  f.fail(true); await assert.rejects(f.games.operate(f.grants, player, f.liveId, 'configure', { expectedRevision: 0, selected: ['breakout'] }), /commit failed/); assert.equal(f.games.states.size, 0);
  await assert.rejects(f.time.operate(f.grants, player, f.liveId, { target: 'screen', action: 'start', mode: 'clock', expectedRevision: 0 }), /commit failed/); assert.equal(f.time.states.size, 0);
  f.fail(false); const key = await f.games.operate(f.grants, player, f.liveId, 'configure', { expectedRevision: 0, selected: ['breakout'] });
  const configured = f.games.states.get(key); f.fail(true);
  await assert.rejects(f.games.operate(f.grants, player, f.liveId, 'start_queue', { expectedRevision: 1 }), /commit failed/); assert.equal(f.games.states.get(key), configured);
  f.fail(false); await f.games.operate(f.grants, player, f.liveId, 'start_queue', { expectedRevision: 1 });
  const previous = f.games.states.get(key), id = previous.breakout.sessions.get(key).id;
  f.fail(true);
  for (const [cred, command, payload] of [[publicActor, 'input', { gameRunId: id, direction: 'right' }], [player, 'start', { gameRunId: id }], [player, 'tick', {}]]) {
    await assert.rejects(f.games.operate(f.grants, cred, f.liveId, command, payload), /commit failed/); assert.equal(f.games.states.get(key), previous);
  }
  f.fail(false); const reads = f.reads(); await assert.rejects(f.games.operate(f.grants, publicActor, f.liveId, 'configure', { expectedRevision: 2, selected: [] }), { code: 'GAME_COMMAND_DENIED' }); assert.equal(f.reads(), reads);
  f.enabled(false); await assert.rejects(f.games.operate(f.grants, player, f.liveId, 'tick'), { code: 'LIVE_ACCESS_DENIED' }); assert.equal(f.games.states.get(key), previous);
  f.enabled(true); f.version('v2'); await assert.rejects(f.games.operate(f.grants, player, f.liveId, 'tick'), { code: 'CONTENT_VERSION_CHANGED' });
});
test('Time projects server-clock expiry and freezes/reset/resumes without exposing the Speaker clock to Screen or Público', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'); await f.live.operate(f.grants, stage, f.liveId);
  await f.time.operate(f.grants, stage, f.liveId, { target: 'speaker', action: 'start', expectedRevision: 0 });
  await f.time.operate(f.grants, stage, f.liveId, { target: 'screen', action: 'start', mode: 'countdown', hours: 0, minutes: 0, seconds: 1, expectedRevision: 1 });
  f.clock(101001);
  const projection = await f.time.projection(f.context('PLAYER'), f.db, f.liveId); assert.equal(projection.screen.remainingMs, 0); assert.equal(projection.screen.running, false); assert.equal(projection.speaker, undefined);
  assert.equal((await f.time.projection(f.context('PARTICIPANT'), f.db, f.liveId)).screen, null);
  await assert.rejects(f.time.operate(f.grants, stage, f.liveId, { target: 'screen', action: 'resume', expectedRevision: 2 }), { code: 'TIME_INVALID_STATE' });
  await f.time.operate(f.grants, stage, f.liveId, { target: 'screen', action: 'reset', expectedRevision: 2 });
  const reset = await f.time.projection(f.context('STAGE'), f.db, f.liveId); assert.equal(reset.screen.remainingMs, 1000); assert.equal(reset.speaker.elapsedMs, 1001);
  await assert.rejects(f.time.operate(f.grants, stage, f.liveId, { target: 'speaker', action: 'stop', expectedRevision: 0 }), { code: 'TIME_STALE_REVISION' });
  await assert.rejects(f.time.operate(f.grants, stage, f.liveId, { target: 'speaker', action: 'stop', expectedRevision: reset.revision, now: 1 }), { code: 'TIME_INVALID_COMMAND' });
});
test('automatic game frames reauthorize controller witnesses, fall back after revocation, and stop without a valid grant', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'), player = f.credentials('PLAYER'), callbacks = [];
  const revoked = new Set(), calls = [];
  const witnessed = { withSession: (credential, operation) => { calls.push(credential.kind); if (revoked.has(credential.kind)) throw new Error('revoked'); return f.grants.withSession(credential, operation); } };
  f.games.setTimeoutFn = callback => { callbacks.push(callback); return {}; };
  await f.live.operate(witnessed, stage, f.liveId);
  await f.games.operate(witnessed, stage, f.liveId, 'configure', { expectedRevision: 0, selected: ['breakout'] });
  const key = await f.games.operate(witnessed, stage, f.liveId, 'start_queue', { expectedRevision: 1 });
  const id = f.games.states.get(key).breakout.sessions.get(key).id;
  await f.games.operate(witnessed, player, f.liveId, 'start', { gameRunId: id });
  let notifications = 0; f.games.notify = async () => { notifications++; }; revoked.add('PLAYER'); calls.length = 0;
  f.clock(104001); await callbacks[0](); assert.deepEqual(calls, ['PLAYER', 'STAGE']); assert.equal(notifications, 1);
  const before = f.games.states.get(key); revoked.add('STAGE'); await callbacks[1](); assert.equal(f.games.states.get(key), before); assert.equal(notifications, 1); assert.equal(f.games.timers.size, 0);
});
