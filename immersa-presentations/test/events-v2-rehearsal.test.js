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
  f.ticket.configuration = { av: { resources: [r], playlists: [] } };
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
