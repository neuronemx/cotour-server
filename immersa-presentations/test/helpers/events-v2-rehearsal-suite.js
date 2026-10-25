const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventRehearsal } = require('../../events-v2/rehearsal');
const { createEventRehearsalRouter } = require('../../events-v2/rehearsal-http');

async function rehearsalSuite(t, f) {
  const { grants, content, request, sql, ids, o1, a, b, activity, stage, liveId, runtime, deck, prep, media, pollRuntime } = f;
  let enabled = true;
  const rehearsal = new EventRehearsal({ grants, content, enabled: () => enabled });
  const app = express(); app.use(express.json()); app.use('/api/events-v2', createEventRehearsalRouter({ rehearsal, enabled: () => enabled }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, own = [];
  async function issue(purpose = 'rehearsal') {
    const g = await grants.issue(ids.get('admin1'), o1, a, { kind: 'SPEAKER', purpose, activityId: activity }); own.push(g.grantId);
    const exchanged = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: a, token: g.token });
    assert.equal(exchanged.status, 200);
    return { ...exchanged.body, cookie: exchanged.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
  }
  const root = s => '/api/events-v2/rehearsal/' + a + '/' + s.context.grantId;
  async function json(s, method = 'GET', body, extra = {}, target = root(s)) {
    const response = await fetch(base + target, { method, headers: { origin: base, cookie: s?.cookie || '',
      'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function image(s, url, method = 'GET', headers = {}) {
    const response = await fetch(base + url, { method, headers: { cookie: s?.cookie || '', ...headers } });
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  }
  const counts = async () => {
    const out = {};
    for (const table of ['event_live_sessions', 'event_live_content', 'event_participants', 'event_v2_reaction_counts', 'presentation_reaction_counts'])
      out[table] = Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n);
    return out;
  };
  let first, second, snapshot;
  try {
    first = await issue(); second = await issue();
    await t.test('real SQL rehearsal uses approved private ES/EN content without changing a simultaneous live or metrics', async () => {
      const before = await counts(), state = structuredClone(runtime.states.get('evt:' + a + ':live:' + liveId));
      const response = await json(first); assert.equal(response.status, 200, JSON.stringify(response.body)); snapshot = response.body;
      assert.equal(snapshot.versionId, deck.version.id); assert.equal(snapshot.mode, 'rehearsal'); assert.equal(snapshot.liveSessionId, undefined);
      assert.equal((await json(first, 'POST', { action: 'next', expectedRevision: 0 })).body.slideIndex, 1);
      assert.equal((await json(second)).body.slideIndex, 0);
      const english = await json(second, 'POST', { action: 'language', expectedRevision: 0, language: 'en' });
      assert.equal(english.body.notes, 'Private English notes'); assert.equal(english.body.language, 'en');
      assert.deepEqual(await counts(), before); assert.deepEqual(runtime.states.get('evt:' + a + ':live:' + liveId), state);
      assert.equal((await sql('SELECT status FROM event_activities WHERE id=?', [activity]))[0].status, 'LIVE');
      await assert.rejects(runtime.operate(grants, { eventId: a, grantId: first.context.grantId, sessionToken: first.sessionToken }, liveId), { code: 'LIVE_ACCESS_DENIED' });
    });
    await t.test('real cookies, grant purpose, event scope, origin and strict command fields protect rehearsal', async () => {
      const liveSpeaker = await issue('live');
      assert.equal((await json(liveSpeaker)).status, 403); assert.equal((await json(stage)).status, 403);
      assert.equal((await json({ context: first.context, cookie: '' })).status, 401);
      assert.equal((await json(first, 'GET', undefined, {}, root(first).replace(a, b))).status, 401);
      assert.equal((await json(first, 'POST', { action: 'next', expectedRevision: 1 }, { origin: 'https://other.example' })).status, 403);
      assert.equal((await json(first, 'POST', { action: 'next', expectedRevision: 1, liveSessionId: liveId })).status, 400);
      assert.equal((await json(first, 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
      assert.equal((await json(first, 'POST', { action: 'start', expectedRevision: 1 })).status, 400);
      assert.equal((await json(first)).body.revision, 1);
    });
    await t.test('private rehearsal images use verified bytes for GET, HEAD, ranges and 304; wrong grants and corruption fail', async () => {
      const current = (await json(first)).body, url = current.image.url;
      const bytes = await image(first, url); assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('cache-control'), 'no-store');
      const hash = crypto.createHash('sha256').update(bytes.bytes).digest('hex'); assert.equal(bytes.headers.get('etag'), '"' + hash + '"');
      assert.equal((await image(first, url, 'HEAD')).status, 200);
      const range = await image(first, url, 'GET', { range: 'bytes=0-9' }); assert.equal(range.status, 206); assert.equal(range.bytes.length, 10);
      assert.equal((await image(first, url, 'GET', { 'if-none-match': '"' + hash + '"' })).status, 304);
      assert.equal((await image(second, url)).status, 401);
      assert.equal((await image(second, url.replace(first.context.grantId, second.context.grantId))).status, 409);
      assert.equal((await image(first, url.replace('/1/full', '/999/full'))).status, 403);
      const row = await prep.row(grants.pool, { eventId: a, deckId: deck.id, versionId: deck.version.id });
      const manifest = JSON.parse(await fs.readFile(path.join(prep.store.directory(row), 'manifest.json'), 'utf8'));
      // Use the store's canonical verified image location rather than a URL/path supplied by a request.
      const entry = manifest.slides?.[1];
      assert.ok(entry, 'Converted manifest has the second slide');
      const file = path.join(prep.store.directory(row), entry.full.file), original = await fs.readFile(file);
      await fs.chmod(file, 384); await fs.writeFile(file, Buffer.alloc(original.length));
      try {
        assert.equal((await image(first, url, 'HEAD')).status, 409);
        const rejected = await image(first, url, 'GET', { 'if-none-match': '"' + hash + '"' });
        assert.equal(rejected.status, 409); assert.equal(JSON.parse(rejected.bytes).code, 'PREPARATION_INTEGRITY_FAILED');
      } finally { await fs.writeFile(file, original); await fs.chmod(file, 256); }
      assert.equal((await image(first, url)).status, 200);
    });
    await t.test('reset and optimistic revisions fence concurrent tabs and retire old image URLs', async () => {
      const stale = (await json(first)).body;
      const responses = await Promise.all([json(first, 'POST', { action: 'prev', expectedRevision: stale.revision }), json(first, 'POST', { action: 'next', expectedRevision: stale.revision })]);
      assert.deepEqual(responses.map(x => x.status).sort(), [200, 409]);
      const conflict = responses.find(x => x.status === 409); assert.equal(conflict.body.currentRevision, stale.revision + 1);
      const reset = await json(first, 'POST', { action: 'reset', expectedRevision: conflict.body.currentRevision });
      assert.equal(reset.status, 200); assert.notEqual(reset.body.runId, stale.runId); assert.equal(reset.body.slideIndex, 0);
      assert.equal((await image(first, stale.image.url)).status, 409);
    });
    await t.test('sample poll exercises the established engine without altering the live engine, participants or metrics', async () => {
      const before = await counts(), liveState = structuredClone(pollRuntime.states.get('evt:' + a + ':live:' + liveId));
      let current = (await json(first)).body;
      const command = async input => {
        const response = await json(first, 'POST', { action: 'poll', expectedRevision: current.revision, runId: current.runId, ...input });
        assert.equal(response.status, 200, JSON.stringify(response.body)); current = response.body; return current;
      };
      await command({ command: 'launch', interactionId: 'poll-a' }); const pollRunId = current.tools.polls.runId;
      assert.equal(current.tools.polls.active.prompt, '¿Una o dos?'); assert.equal(current.tools.polls.results, null);
      assert.equal((await json(second)).body.tools.polls.active, null);
      const extraIdentity = await json(first, 'POST', { action: 'poll', expectedRevision: current.revision, runId: current.runId,
        command: 'respond', pollRunId, optionId: 'a', participantId: crypto.randomUUID() }); assert.equal(extraIdentity.status, 400);
      await command({ command: 'respond', pollRunId, optionId: 'a' }); await command({ command: 'show', pollRunId });
      assert.equal(current.tools.polls.results.totalResponses, 1); assert.equal(current.tools.polls.results.options[0].count, 1);
      const duplicate = await json(first, 'POST', { action: 'poll', expectedRevision: current.revision, runId: current.runId, command: 'respond', pollRunId, optionId: 'b' });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'REHEARSAL_SAMPLE_ALREADY_USED');
      await command({ command: 'hide', pollRunId }); assert.equal(current.tools.polls.results, null);
      await command({ command: 'close', pollRunId }); assert.equal(current.tools.polls.active, null);
      assert.deepEqual(await counts(), before); assert.deepEqual(pollRuntime.states.get('evt:' + a + ':live:' + liveId), liveState);
      assert.equal((await sql('SELECT status FROM event_activities WHERE id=?', [activity]))[0].status, 'LIVE');
    });
    await t.test('private media verifies real selected bytes before HEAD/304 and denies other runs, grants, events and stale URLs', async () => {
      const current = (await json(first)).body, resource = current.tools.media[0], url = resource.url;
      assert.equal(current.tools.media.length, 1); assert.equal(resource.id, deck.audio.id);
      const full = await image(first, url); assert.equal(full.status, 200); assert.deepEqual(full.bytes, require('./events-v2-media-fixture').wavFixture());
      assert.equal(full.headers.get('content-type'), 'audio/wav'); assert.equal(full.headers.get('cache-control'), 'no-store');
      assert.equal((await image(first, url, 'HEAD')).status, 200);
      const range = await image(first, url, 'GET', { range: 'bytes=2-9' }); assert.equal(range.status, 206); assert.deepEqual(range.bytes, full.bytes.subarray(2, 10));
      assert.equal((await image(first, url, 'GET', { range: 'bytes=999999-' })).status, 416);
      assert.equal((await image(first, url, 'GET', { 'if-none-match': full.headers.get('etag') })).status, 304);
      assert.equal((await image(second, url)).status, 401);
      assert.equal((await image(second, url.replace(first.context.grantId, second.context.grantId))).status, 409);
      assert.equal((await image(first, url.replace(a, b))).status, 401);
      assert.equal((await image(first, url.replace(deck.audio.id, crypto.randomUUID()))).status, 403);
      const file = path.join(media.store.directory({ eventId: a, deckId: deck.id, versionId: deck.version.id, id: deck.audio.id }), 'media.bin');
      const original = await fs.readFile(file); await fs.chmod(file, 384); await fs.writeFile(file, Buffer.alloc(original.length));
      try {
        assert.equal((await image(first, url, 'HEAD')).status, 409);
        const rejected = await image(first, url, 'GET', { 'if-none-match': full.headers.get('etag') });
        assert.equal(rejected.status, 409); assert.equal(JSON.parse(rejected.bytes).code, 'MEDIA_INTEGRITY_FAILED');
      } finally { await fs.writeFile(file, original); await fs.chmod(file, 256); }
      const reset = await json(first, 'POST', { action: 'reset', expectedRevision: current.revision }); assert.equal(reset.status, 200);
      assert.equal((await image(first, url)).status, 409);
      assert.equal((await image(first, reset.body.tools.media[0].url)).status, 200);
      await grants.revoke(ids.get('admin1'), o1, a, second.context.grantId);
      assert.equal((await image(second, (await json(first)).body.tools.media[0].url.replace(first.context.grantId, second.context.grantId))).status, 401);
    });
    await t.test('revocation during verification and flag disable never expose prepared private content', async () => {
      const revoked = await issue(), original = content.verify.bind(content);
      content.verify = async ticket => { await original(ticket); await grants.revoke(ids.get('admin1'), o1, a, revoked.context.grantId); };
      try { assert.equal((await json(revoked)).status, 401); assert.equal(rehearsal.states.has(a + ':' + revoked.context.grantId), false); }
      finally { content.verify = original; }
      enabled = false;
      assert.equal((await json(first)).status, 404); assert.equal((await image(first, snapshot.image.url, 'HEAD')).status, 404);
      enabled = true;
      await grants.revoke(ids.get('admin1'), o1, a, first.context.grantId);
      assert.equal((await json(first)).status, 401); assert.equal((await image(first, snapshot.image.url, 'HEAD')).status, 401);
    });
  } finally {
    enabled = true; server.closeAllConnections(); await new Promise(r => server.close(r));
    for (const id of own) { await sql('DELETE FROM event_grant_sessions WHERE grant_id=?', [id]); await sql('DELETE FROM event_access_grants WHERE id=?', [id]); }
  }
}
module.exports = { rehearsalSuite };
