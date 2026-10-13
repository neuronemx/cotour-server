const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventLiveRuntime } = require('../events-v2/live-runtime');
const { EventPollRuntime, normalizePolls } = require('../events-v2/poll-runtime');
const definition = { id: 'poll', type: 'poll', title: 'Internal title', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], script: 'PRIVATE', correct_option_ids: ['yes'] };
function fixtures() {
  const eventId = crypto.randomUUID(), liveId = crypto.randomUUID(), stageId = crypto.randomUUID(), participantId = crypto.randomUUID();
  let failCommit = false, enabled = true, reads = 0;
  const db = { execute: async () => [[{ id: liveId, deck_id: 'private', event_activity_id: 'activity', event_stage_id: stageId, access_level: 'FREE' }]] };
  const context = kind => ({ eventId, kind, stageId: kind === 'PARTICIPANT' ? null : stageId, purpose: 'live', participantId, audienceLevel: 'FREE' });
  const grants = { withSession: async (credentials, callback) => { const value = await callback(context(credentials.kind), db); if (failCommit) throw new Error('commit failed'); return value; } };
  const live = new EventLiveRuntime({ enabled: () => enabled, readPreparation: async resolved => ({ ...resolved, versionId: 'v1', slideCount: 3 }) });
  const polls = new EventPollRuntime({ liveRuntime: live, readPolls: async prepared => { reads++; return { ...prepared, polls: [definition] }; } });
  const credentials = kind => ({ eventId, kind });
  return { live, polls, grants, credentials, liveId, db, context, reads: () => reads, fail: value => { failCommit = value; }, enabled: value => { enabled = value; } };
}
test('poll definitions use the existing normalization allowlist and reject malformed/multiple choices', () => {
  const normalized = normalizePolls([definition])[0];
  assert.equal(normalized.script, undefined); assert.equal(normalized.correct_option_ids, undefined);
  for (const item of [{ ...definition, type: 'trivia' }, { ...definition, allowMultiple: true }, { ...definition, settings: { allow_multiple: true } }, { ...definition, options: [definition.options[0], definition.options[0]] }]) assert.throws(() => normalizePolls([item]), { code: 'POLL_CONTENT_NOT_PREPARED' });
});
test('failed commit cannot publish poll launch, vote or close; denied roles do not load content', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'), publicActor = f.credentials('PARTICIPANT');
  await f.live.operate(f.grants, stage, f.liveId);
  f.fail(true); await assert.rejects(f.polls.operate(f.grants, stage, f.liveId, 'launch', { interactionId: 'poll' }), /commit failed/); assert.equal(f.polls.states.size, 0);
  f.fail(false); const key = await f.polls.operate(f.grants, stage, f.liveId, 'launch', { interactionId: 'poll' });
  const previous = f.polls.states.get(key), run = previous.runId;
  f.fail(true);
  for (const [credential, command, payload] of [[publicActor, 'submit', { pollRunId: run, optionId: 'yes' }], [stage, 'close', { pollRunId: run }]]) {
    await assert.rejects(f.polls.operate(f.grants, credential, f.liveId, command, payload), /commit failed/); assert.equal(f.polls.states.get(key), previous); assert.equal(previous.store.getSession(key).responses.size, 0);
  }
  f.fail(false); const reads = f.reads();
  await assert.rejects(f.polls.operate(f.grants, publicActor, f.liveId, 'launch', { interactionId: 'poll' }), { code: 'POLL_COMMAND_DENIED' }); assert.equal(f.reads(), reads);
  f.enabled(false); await assert.rejects(f.polls.operate(f.grants, stage, f.liveId, 'close', { pollRunId: run }), { code: 'LIVE_ACCESS_DENIED' }); assert.equal(f.polls.states.get(key), previous);
});
