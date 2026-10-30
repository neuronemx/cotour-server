const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { EventRehearsal } = require('../events-v2/rehearsal');
const { EventAccessError } = require('../events-v2/authorization');

function fixture() {
  const eventId = crypto.randomUUID(), activityId = crypto.randomUUID(), stageId = crypto.randomUUID();
  let enabled = true, denied = false, commitFailure = false, now = Date.now(), verifies = 0, imageReads = 0;
  const contexts = new Map();
  const credential = (kind = 'SPEAKER', purpose = 'rehearsal') => {
    const grantId = crypto.randomUUID(); contexts.set(grantId, { eventId, grantId, kind, purpose, activityId, stageId, expiresAt: new Date(now + 3600000).toISOString() });
    return { eventId, grantId, token: 'cookie' };
  };
  const ticket = { binding: { revision: 1 }, scope: { eventId, deckId: crypto.randomUUID(), versionId: crypto.randomUUID() },
    snapshot: { bundleDigest: 'a'.repeat(64) }, row: { approvalDigest: 'b'.repeat(64) } };
  const db = { execute: async () => [[{ id: activityId, title: 'Own rehearsal' }]] };
  const grants = { now: () => new Date(now), withBrowser: async (c, work) => {
    if (denied || c.eventId !== eventId || !contexts.has(c.grantId)) throw new EventAccessError('GRANT_ACCESS_DENIED', 401);
    const result = await work(contexts.get(c.grantId), db);
    if (commitFailure) throw new Error('SQL unavailable at commit');
    return result;
  } };
  const resource = { width: 16, height: 9 }, catalog = { digest: 'c'.repeat(64), englishEnabled: true, presenterLanguage: 'es',
    slides: [0, 1].map(n => Object.fromEntries(['es', 'en'].map(language => [language, { notes: language + ' private ' + n, full: resource, thumb: resource }]))) };
  const content = { checks: { acquire: () => () => {} }, candidate: async () => structuredClone(ticket),
    verify: async () => { verifies++; }, slides: async () => catalog,
    preparedImage: async () => { imageReads++; return { open: async () => Readable.from(['x']) }; } };
  const rehearsal = new EventRehearsal({ grants, content, enabled: () => enabled, maxStates: 2, idleMs: 1000 });
  return { rehearsal, content, credential, ticket, contexts, eventId, activityId, stageId,
    enable: v => { enabled = v; }, deny: v => { denied = v; }, commitFail: v => { commitFailure = v; },
    advance: n => { now += n; }, verifies: () => verifies, imageReads: () => imageReads };
}
test('private rehearsal state is independent per grant and absent from live state/metrics', async () => {
  const f = fixture(), a = f.credential(), b = f.credential();
  const first = await f.rehearsal.operate(a), second = await f.rehearsal.operate(b);
  assert.notEqual(first.runId, second.runId); assert.equal(first.notes, 'es private 0');
  assert.equal(first.liveSessionId, undefined); assert.equal(first.participants, undefined);
  assert.equal((await f.rehearsal.operate(a, 'next', { expectedRevision: 0 })).slideIndex, 1);
  assert.equal((await f.rehearsal.operate(b)).slideIndex, 0);
  assert.equal(f.verifies(), 2);
});
test('only current rehearsal Speaker grants authorize content; denials do not verify or install state', async () => {
  const f = fixture();
  for (const [kind, purpose] of [['STAGE', 'live'], ['SPEAKER', 'live'], ['PLAYER', 'player'], ['PARTICIPANT', 'public']])
    await assert.rejects(f.rehearsal.operate(f.credential(kind, purpose)), { code: 'REHEARSAL_ACCESS_DENIED' });
  f.deny(true); await assert.rejects(f.rehearsal.operate(f.credential()), { code: 'GRANT_ACCESS_DENIED' });
  f.deny(false); f.enable(false); await assert.rejects(f.rehearsal.operate(f.credential()), { code: 'EVENTS_V2_DISABLED' });
  assert.equal(f.verifies(), 0); assert.equal(f.rehearsal.states.size, 0);
});
test('revoke, kill switch or rebind during verification prevents installation after second authorization', async () => {
  for (const change of ['revoke', 'flag', 'rebind']) {
    const f = fixture(), c = f.credential();
    f.content.verify = async () => { if (change === 'revoke') f.deny(true); if (change === 'flag') f.enable(false); if (change === 'rebind') f.ticket.binding.revision++; };
    await assert.rejects(f.rehearsal.operate(c)); assert.equal(f.rehearsal.states.size, 0);
  }
});
test('concurrent navigation requires a fresh revision and commit failure preserves state', async () => {
  const f = fixture(), c = f.credential(); await f.rehearsal.operate(c);
  const results = await Promise.allSettled([f.rehearsal.operate(c, 'next', { expectedRevision: 0 }), f.rehearsal.operate(c, 'prev', { expectedRevision: 0 })]);
  assert.deepEqual(results.map(x => x.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'REHEARSAL_REVISION_CONFLICT'); assert.equal(results[1].reason.currentRevision, 1);
  f.commitFail(true); await assert.rejects(f.rehearsal.operate(c, 'prev', { expectedRevision: 1 }));
  f.commitFail(false); assert.equal((await f.rehearsal.operate(c)).slideIndex, 1);
});
test('version changes require explicit reset and invalidate previous image URLs', async () => {
  const f = fixture(), c = f.credential(), first = await f.rehearsal.operate(c);
  f.ticket.binding.revision++;
  await assert.rejects(f.rehearsal.operate(c), { code: 'REHEARSAL_VERSION_CHANGED', currentRevision: 0 });
  const reset = await f.rehearsal.operate(c, 'reset', { expectedRevision: 0 });
  assert.notEqual(first.runId, reset.runId); assert.equal(reset.revision, 1);
  await assert.rejects(f.rehearsal.image(c, { runId: first.runId }), { code: 'REHEARSAL_EXPIRED' });
});
test('images reauthorize, enforce catalog language/index/digest and reread verified private bytes', async () => {
  const f = fixture(), c = f.credential(), first = await f.rehearsal.operate(c);
  const input = { runId: first.runId, digest: 'c'.repeat(64), language: 'es', index: 0, variant: 'full' };
  await f.rehearsal.image(c, input); await f.rehearsal.image(c, input); assert.equal(f.imageReads(), 2);
  for (const bad of [{ index: 2 }, { digest: 'd'.repeat(64) }, { language: 'fr' }, { variant: 'source' }])
    await assert.rejects(f.rehearsal.image(c, { ...input, ...bad }), { code: 'REHEARSAL_IMAGE_DENIED' });
  f.deny(true); await assert.rejects(f.rehearsal.image(c, input), { code: 'GRANT_ACCESS_DENIED' }); assert.equal(f.imageReads(), 2);
});
test('idle state expires, resets get a new run, and capacity remains bounded', async () => {
  const f = fixture(), a = f.credential(), first = await f.rehearsal.operate(a); await f.rehearsal.operate(f.credential());
  await assert.rejects(f.rehearsal.operate(f.credential()), { code: 'REHEARSAL_BUSY' });
  f.advance(1001); const next = await f.rehearsal.operate(a); assert.notEqual(next.runId, first.runId); assert.equal(next.slideIndex, 0);
});
test('language switch preserves private navigation and rejects invalid positions', async () => {
  const f = fixture(), c = f.credential(); await f.rehearsal.operate(c);
  const english = await f.rehearsal.operate(c, 'language', { expectedRevision: 0, language: 'en' }); assert.equal(english.notes, 'en private 0');
  for (const slideIndex of [-1, 2, 0.5, '1']) await assert.rejects(f.rehearsal.operate(c, 'go', { expectedRevision: 1, slideIndex }), { code: 'INVALID_INPUT' });
  assert.equal((await f.rehearsal.operate(c)).revision, 1);
});
const poll = { id: 'poll-own', type: 'poll', title: 'Own poll', prompt: 'Choose', options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }] };
test('private sample poll uses the existing engine, isolates grants and clears results on close/reset without history', async () => {
  const f = fixture(); f.ticket.configuration = { polls: [poll] };
  const a = f.credential(), b = f.credential(); let v = await f.rehearsal.operate(a);
  const command = async input => { v = await f.rehearsal.operate(a, 'poll', { expectedRevision: v.revision, runId: v.runId, pollRunId: v.tools.polls.runId, ...input }); return v; };
  await command({ command: 'launch', interactionId: poll.id });
  assert.equal(v.tools.polls.resultsVisible, false); assert.equal(v.tools.polls.active.prompt, 'Choose');
  assert.equal((await f.rehearsal.operate(b)).tools.polls.active, null);
  await command({ command: 'respond', optionId: 'a' }); assert.equal(v.tools.polls.responded, true);
  await command({ command: 'show' }); assert.equal(v.tools.polls.results.totalResponses, 1); assert.equal(v.tools.polls.results.options[0].count, 1);
  assert.equal(JSON.stringify(v).includes('private-sample'), false);
  await assert.rejects(command({ command: 'respond', optionId: 'b' }), { code: 'REHEARSAL_SAMPLE_ALREADY_USED' });
  await command({ command: 'close' }); assert.equal(v.tools.polls.active, null);
  assert.equal(f.rehearsal.states.get(f.eventId + ':' + a.grantId).poll.sessions.size, 0);
  await command({ command: 'launch', interactionId: poll.id });
  v = await f.rehearsal.operate(a, 'reset', { expectedRevision: v.revision }); assert.equal(v.tools.polls.active, null);
});
test('sample commands fence stale runs and failed commits never mutate private answers', async () => {
  const f = fixture(); f.ticket.configuration = { polls: [poll] }; const a = f.credential();
  let v = await f.rehearsal.operate(a);
  await assert.rejects(f.rehearsal.operate(a, 'poll', { runId: crypto.randomUUID(), expectedRevision: 0, command: 'launch', interactionId: poll.id }), { code: 'REHEARSAL_EXPIRED' });
  v = await f.rehearsal.operate(a, 'poll', { runId: v.runId, expectedRevision: 0, command: 'launch', interactionId: poll.id });
  f.commitFail(true); await assert.rejects(f.rehearsal.operate(a, 'poll', { runId: v.runId, expectedRevision: 1, command: 'respond', pollRunId: v.tools.polls.runId, optionId: 'a' }));
  f.commitFail(false); v = await f.rehearsal.operate(a); assert.equal(v.tools.polls.responded, false); assert.equal(v.revision, 1);
  await assert.rejects(f.rehearsal.operate(a, 'poll', { runId: v.runId, expectedRevision: 1, command: 'respond', pollRunId: crypto.randomUUID(), optionId: 'a' }), { code: 'REHEARSAL_POLL_NOT_ACTIVE' });
});
test('media admission exposes only selected approved assets and fences expiry, reset, revocation and binding changes', async () => {
  const f = fixture(), a = f.credential(), assetId = crypto.randomUUID();
  const r = { id: assetId, assetId, name: 'Selected', type: 'video', duration: 1, size: 5, sha256: 'f'.repeat(64), contentType: 'video/webm' };
  f.ticket.configuration = { av: { resources: [r], playlists: [], publicId: null } };
  let reads = 0; f.content.preparedAsset = async () => { reads++; return { verified: true, ...r, open: async () => Readable.from(['own']) }; };
  const v = await f.rehearsal.operate(a), input = { runId: v.runId, digest: 'a'.repeat(64), assetId };
  assert.equal(v.tools.media.length, 1); assert.equal(v.tools.media[0].sha256, undefined);
  await f.rehearsal.media(a, input); assert.equal(reads, 1);
  for (const wrong of [{ assetId: crypto.randomUUID() }, { digest: 'b'.repeat(64) }]) await assert.rejects(f.rehearsal.media(a, { ...input, ...wrong }), { code: 'REHEARSAL_MEDIA_DENIED' });
  f.deny(true); await assert.rejects(f.rehearsal.media(a, input), { code: 'GRANT_ACCESS_DENIED' }); f.deny(false);
  f.ticket.binding.revision++; await assert.rejects(f.rehearsal.media(a, input), { code: 'REHEARSAL_VERSION_CHANGED' });
  await f.rehearsal.operate(a, 'reset', { expectedRevision: 0 }); await assert.rejects(f.rehearsal.media(a, input), { code: 'REHEARSAL_EXPIRED' });
  f.advance(1001); const current = f.rehearsal.states.get(f.eventId + ':' + a.grantId); await assert.rejects(f.rehearsal.media(a, { ...input, runId: current.runId }), { code: 'REHEARSAL_EXPIRED' });
  assert.equal(reads, 1);
});
test('private Q&A remains separate across grants, coexists with a poll and discards all questions on reset', async () => {
  const f = fixture(); f.ticket.configuration = { polls: [poll] }; const a = f.credential(), b = f.credential();
  let v = await f.rehearsal.operate(a);
  const qna = async input => { v = await f.rehearsal.operate(a, 'qna', { expectedRevision: v.revision, runId: v.runId, roundId: v.tools.qna.roundId, ...input }); return v.tools.qna; };
  await qna({ command: 'open' }); await qna({ command: 'submit', question: 'Own sample', name: 'Private name', allowNameOnScreen: false });
  const id = v.tools.qna.questions[0].id; await qna({ command: 'project', questionId: id });
  assert.equal(v.tools.qna.screen.question.name, ''); assert.equal((await f.rehearsal.operate(b)).tools.qna.roundId, null);
  v = await f.rehearsal.operate(a, 'poll', { expectedRevision: v.revision, runId: v.runId, command: 'launch', interactionId: poll.id });
  await qna({ command: 'panel_close' }); assert.equal(v.tools.polls.active.id, poll.id);
  v = await f.rehearsal.operate(a, 'reset', { expectedRevision: v.revision }); assert.equal(v.tools.qna.roundId, null); assert.equal(v.tools.qna.questions.length, 0);
});
test('Q&A authorization, revision, run and commit fences apply before publishing questions', async () => {
  const f = fixture(), a = f.credential(); let v = await f.rehearsal.operate(a);
  await assert.rejects(f.rehearsal.operate(a, 'qna', { expectedRevision: 0, runId: crypto.randomUUID(), command: 'open' }), { code: 'REHEARSAL_EXPIRED' });
  v = await f.rehearsal.operate(a, 'qna', { expectedRevision: 0, runId: v.runId, command: 'open' });
  const input = { expectedRevision: v.revision, runId: v.runId, roundId: v.tools.qna.roundId, command: 'submit', question: 'Should not commit', name: '', allowNameOnScreen: false };
  f.commitFail(true); await assert.rejects(f.rehearsal.operate(a, 'qna', input)); f.commitFail(false);
  assert.equal((await f.rehearsal.operate(a)).tools.qna.questions.length, 0);
  f.deny(true); await assert.rejects(f.rehearsal.operate(a, 'qna', input), { code: 'GRANT_ACCESS_DENIED' }); f.deny(false);
  f.ticket.binding.revision++; await assert.rejects(f.rehearsal.operate(a, 'qna', input), { code: 'REHEARSAL_VERSION_CHANGED' });
});
const knowledgeDefinition = category => ({ id: category, category, title: 'Practice', identificationMode: 'anonymous', questionDurationSeconds: 5, durationSeconds: 30,
  questions: [{ id: 'own-question', prompt: 'Pick', options: [{ id: 'a', label: 'A', correct: true }, { id: 'b', label: 'B' }] }] });
test('knowledge rehearsal excludes polls, keeps Q&A independent and publishes automatic transitions only after authorization commit', async () => {
  const f = fixture(), a = f.credential(), b = f.credential(); f.rehearsal.idleMs = 60000;
  f.ticket.configuration = { polls: [poll], knowledge: [knowledgeDefinition('contest'), knowledgeDefinition('assessment')] };
  let v = await f.rehearsal.operate(a);
  const op = async (action, input) => { v = await f.rehearsal.operate(a, action, { expectedRevision: v.revision, runId: v.runId, executionId: v.tools.knowledge.executionId, ...input }); return v; };
  await op('knowledge', { command: 'open', definitionId: 'contest' });
  assert.equal((await f.rehearsal.operate(b)).tools.knowledge.screen, null);
  await assert.rejects(op('poll', { command: 'launch', interactionId: poll.id }), { code: 'REHEARSAL_INTERACTION_BUSY' });
  await op('qna', { command: 'open' }); assert.ok(v.tools.qna.roundId);
  await op('knowledge', { command: 'start' }); const before = v.revision; f.advance(4700);
  f.commitFail(true); await assert.rejects(f.rehearsal.operate(a)); f.commitFail(false);
  assert.equal(f.rehearsal.states.get(f.eventId + ':' + a.grantId).knowledge.state, 'COUNTDOWN');
  v = await f.rehearsal.operate(a); assert.equal(v.tools.knowledge.screen.state, 'ACTIVE'); assert.equal(v.revision, before + 1);
  await op('knowledge', { command: 'answer', questionId: 'own-question', optionId: 'a' });
  await op('knowledge', { command: 'cancel' }); assert.equal(v.tools.knowledge.screen, null); assert.ok(v.tools.qna.roundId);
  await op('poll', { command: 'launch', interactionId: poll.id });
  await assert.rejects(op('knowledge', { command: 'open', definitionId: 'assessment' }), { code: 'REHEARSAL_INTERACTION_BUSY' });
  await op('poll', { command: 'close', pollRunId: v.tools.polls.runId });
  await op('knowledge', { command: 'open', definitionId: 'assessment' }); const executionId = v.tools.knowledge.executionId, runId = v.runId;
  await op('reset', {}); assert.equal(v.tools.knowledge.screen, null);
  await assert.rejects(op('knowledge', { command: 'start', executionId, runId }), { code: 'REHEARSAL_EXPIRED' });
});
test('question images reauthorize, verify bytes and deny old executions, hidden questions and tampered bundles', async () => {
  const f = fixture(), a = f.credential(), assetId = crypto.randomUUID(); f.rehearsal.idleMs = 60000;
  const def = knowledgeDefinition('assessment'); def.questions[0].imageAssetId = assetId;
  f.ticket.configuration = { knowledge: [def] }; f.ticket.snapshot.images = [{ id: assetId }];
  f.content.interactionImageMetadata = () => [{ id: assetId, width: 64, height: 32 }];
  let reads = 0; f.content.preparedInteractionImage = async () => { reads++; return { verified: true, open() {} }; };
  let v = await f.rehearsal.operate(a);
  const op = async input => { v = await f.rehearsal.operate(a, 'knowledge', { expectedRevision: v.revision, runId: v.runId, executionId: v.tools.knowledge.executionId, ...input }); };
  await op({ command: 'open', definitionId: 'assessment' });
  const input = { runId: v.runId, executionId: v.tools.knowledge.executionId, digest: 'a'.repeat(64), assetId };
  await assert.rejects(f.rehearsal.questionImage(a, input), { code: 'REHEARSAL_IMAGE_DENIED' });
  await op({ command: 'start' }); f.advance(4700); v = await f.rehearsal.operate(a);
  await f.rehearsal.questionImage(a, input); assert.equal(reads, 1);
  for (const wrong of [{ executionId: crypto.randomUUID() }, { digest: 'f'.repeat(64) }, { assetId: crypto.randomUUID() }])
    await assert.rejects(f.rehearsal.questionImage(a, { ...input, ...wrong }), { code: 'REHEARSAL_IMAGE_DENIED' });
  f.deny(true); await assert.rejects(f.rehearsal.questionImage(a, input), { code: 'GRANT_ACCESS_DENIED' }); f.deny(false);
  await op({ command: 'answer', questionId: 'own-question', optionId: 'a' }); await op({ command: 'submit' });
  await assert.rejects(f.rehearsal.questionImage(a, input), { code: 'REHEARSAL_IMAGE_DENIED' }); assert.equal(reads, 1);
});
const raffleDefinition = { id: 'practice-raffle', mode: 'free', title: 'Practice raffle', prompt: 'Participa', options: [] };
test('raffle practice excludes polls/knowledge, isolates samples by grant and reconciles winners only after authorization commit', async () => {
  const f = fixture(), a = f.credential(), b = f.credential(); f.rehearsal.idleMs = 60000;
  f.ticket.configuration = { polls: [poll], knowledge: [knowledgeDefinition('contest')], raffles: [raffleDefinition] };
  let v = await f.rehearsal.operate(a);
  const op = async (action, input) => { v = await f.rehearsal.operate(a, action, { expectedRevision: v.revision, runId: v.runId, raffleRunId: v.tools.raffle.raffleRunId, ...input }); return v; };
  await op('raffle', { command: 'open', definitionId: raffleDefinition.id });
  await assert.rejects(op('poll', { command: 'launch', interactionId: poll.id }), { code: 'REHEARSAL_INTERACTION_BUSY' });
  await assert.rejects(op('knowledge', { command: 'open', definitionId: 'contest' }), { code: 'REHEARSAL_INTERACTION_BUSY' });
  await op('qna', { command: 'open' }); assert.ok(v.tools.qna.roundId);
  f.commitFail(true); await assert.rejects(op('raffle', { command: 'enter', sampleId: null, name: 'Uncommitted' })); f.commitFail(false);
  assert.equal((await f.rehearsal.operate(a)).tools.raffle.samples.length, 0);
  await op('raffle', { command: 'enter', sampleId: null, name: 'One sample' });
  const other = await f.rehearsal.operate(b); assert.equal(other.tools.raffle.samples.length, 0); assert.equal(other.tools.raffle.controller, null);
  await op('raffle', { command: 'close_entries' }); await op('raffle', { command: 'draw' });
  const revision = v.revision; f.advance(5000); f.commitFail(true); await assert.rejects(f.rehearsal.operate(a)); f.commitFail(false);
  assert.equal(f.rehearsal.states.get(f.eventId + ':' + a.grantId).revision, revision);
  v = await f.rehearsal.operate(a); assert.equal(v.tools.raffle.screen.winner.name, 'One sample'); assert.equal(v.revision, revision + 1);
  const oldRun = v.runId, raffleRunId = v.tools.raffle.raffleRunId;
  await op('reset', {}); assert.equal(v.tools.raffle.samples.length, 0); assert.equal(v.tools.raffle.winners.length, 0); assert.equal(v.tools.qna.roundId, null);
  await assert.rejects(op('raffle', { command: 'draw', runId: oldRun, raffleRunId }), { code: 'REHEARSAL_EXPIRED' });
  await op('poll', { command: 'launch', interactionId: poll.id });
  await assert.rejects(op('raffle', { command: 'open', definitionId: raffleDefinition.id }), { code: 'REHEARSAL_INTERACTION_BUSY' });
});
test('deferred raffle images fail closed while still rechecking run, version and authorization', async () => {
  const f = fixture(), a = f.credential(), assetId = crypto.randomUUID();
  f.ticket.configuration = { raffles: [{ ...raffleDefinition, mode: 'visual_key', entryKey: 'a', options: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, ...(id === 'a' ? { imageAssetId: assetId } : {}) })) }] };
  f.ticket.snapshot.images = [{ id: assetId }]; f.content.interactionImageMetadata = () => [{ id: assetId, width: 64, height: 32 }];
  let reads = 0; f.content.preparedInteractionImage = async () => { reads++; return { verified: true, open() {} }; };
  let v = await f.rehearsal.operate(a); const input = { runId: v.runId, digest: 'a'.repeat(64), executionId: 'catalog', assetId };
  await assert.rejects(f.rehearsal.raffleImage(a, input), { code: 'REHEARSAL_IMAGE_DENIED' }); assert.equal(reads, 0);
  for (const wrong of [{ assetId: crypto.randomUUID() }, { executionId: crypto.randomUUID() }, { digest: 'f'.repeat(64) }])
    await assert.rejects(f.rehearsal.raffleImage(a, { ...input, ...wrong }), { code: 'REHEARSAL_IMAGE_DENIED' });
  f.deny(true); await assert.rejects(f.rehearsal.raffleImage(a, input), { code: 'GRANT_ACCESS_DENIED' }); f.deny(false);
  v = await f.rehearsal.operate(a, 'reset', { expectedRevision: v.revision });
  await assert.rejects(f.rehearsal.raffleImage(a, input), { code: 'REHEARSAL_EXPIRED' });
  f.ticket.binding.revision++; await assert.rejects(f.rehearsal.raffleImage(a, { ...input, runId: v.runId }), { code: 'REHEARSAL_VERSION_CHANGED' }); assert.equal(reads, 0);
});
