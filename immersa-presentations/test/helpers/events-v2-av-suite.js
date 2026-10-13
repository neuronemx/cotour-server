const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { runMigrations } = require('../../db/migrate');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { EventAVRuntime } = require('../../events-v2/av-runtime');
const { executionKey } = require('../../events-v2/live-runtime');
async function avSuite(t, f) {
  const { request, sql, grants, domain, base, o1, a, b, stageA, activityA, activityB, publicId, avRuntime, preparations } = f;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID(), key = executionKey(a, live);
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  const audio = Buffer.from('PRIVATE_AUDIO_BYTES_01'), audio2 = Buffer.from('PRIVATE_AUDIO_BYTES_02'), video = Buffer.from('PRIVATE_VIDEO_BYTES_01'), video2 = Buffer.from('PRIVATE_VIDEO_BYTES_02');
  const resource = (id, type, bytes) => ({ id, name: id, type, assetId: 'asset-' + id, duration: 6, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), contentType: type === 'audio' ? 'audio/mpeg' : 'video/mp4' });
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'av-version', slideCount: 5,
      resources: [resource('song', 'audio', audio), resource('song2', 'audio', audio2), resource('film', 'video', video), resource('film2', 'video', video2)],
      playlists: [{ id: 'music', name: 'Music', type: 'audio', resourceIds: ['song', 'song2'] }, { id: 'films', name: 'Films', type: 'video', resourceIds: ['film', 'film2'] }],
      ...(event === a ? { publicId } : {}),
      polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }], games: [], knowledge: [], raffles: [] });
    f.avAssets.set(id, new Map([['asset-song', audio], ['asset-song2', audio2], ['asset-film', video], ['asset-film2', video2]]));
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  let clock = 0; const setClock = value => { clock = value; f.setAVClockOffset(clock); }; setClock(0);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, event, payload = {}) => { const diagnostic = new Error(`AV ack failed: ${event}`); return new Promise((resolve, reject) => {
    if (!client.connected) return reject(Object.assign(diagnostic, { cause: new Error('already disconnected') }));
    client.timeout(10000).emit(event, payload, (error, reply) => error ? reject(Object.assign(diagnostic, { cause: error })) : resolve(reply));
  }); };
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  const cookie = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function issue(kind, fields, event = a) {
    const created = await request('admin1', 'POST', `/api/events-v2/organizations/${o1}/events/${event}/grants`, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(created.status, 201);
    const result = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: created.body.token }); assert.equal(result.status, 200); return { ...result.body, cookie: cookie(result) };
  }
  async function register(name) { const result = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(result.status, 201); return { ...result.body, cookie: cookie(result) }; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE', participantId: 'forged', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], reconnection: false, forceNew: true }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('AV context timeout')), 10000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); });
    assert.equal((await ack(client, 'events:live:join', { liveSessionId: liveId })).ok, true); return client;
  }
  const command = (client, action, payload = {}) => ack(client, `events:av:${action}`, payload);
  const control = (client, action, payload = {}) => command(client, 'control', { action, ...payload });
  async function snap(client) { const result = await command(client, 'snapshot'); assert.equal(result.ok, true, JSON.stringify(result)); return result.snapshot; }
  const counts = async (id = live) => (await sql('SELECT * FROM event_v2_reaction_counts WHERE id = ?', [id]))[0] || null;
  function faultyGrants() {
    const broken = new EventDomainRepository(domain.pool);
    broken.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('AV_TEST_COMMIT_FAILURE'); } finally { await db.rollback(); db.release(); } };
    return new EventGrantRepository(broken, { now: f.now });
  }
  async function asset(session, assetId = 'asset-song', options = {}) {
    const path = `/api/events-v2/live/${options.event || session.context.eventId}/${options.live || live}/${session.context.grantId}/assets/${assetId}`;
    const result = await fetch(base + path, { method: options.method || 'GET', headers: { ...(options.noCookie ? {} : { cookie: session.cookie }), ...options.headers } });
    return { status: result.status, headers: result.headers, bytes: Buffer.from(await result.arrayBuffer()) };
  }
  const gone = client => !client.connected ? Promise.resolve() : new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('AV disconnect timeout')), 10000); client.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  let stageSession, playerSession, publicSession, stage, speaker, player, attendee, other, secondPlayer, foreignPlayer;
  const legacyRows = (await sql('SELECT COUNT(*) n FROM presentation_reaction_counts'))[0].n;
  await t.test('AV migration recovers partial DDL; idle reads and denied roles create neither counters nor media', async () => {
    await sql("DELETE FROM schema_migrations WHERE id='042_event_reactions.sql'"); assert.deepEqual((await runMigrations(domain.pool)).executed, ['042_event_reactions.sql']); assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession); speaker = await connect(await issue('SPEAKER', { activityId: activityA })); playerSession = await issue('PLAYER', { liveSessionId: live }); player = await connect(playerSession);
    publicSession = await register('AV Alice'); attendee = await connect(publicSession); other = await connect(await register('AV Other'));
    assert.equal((await snap(player)).channels.audio.resource, null); assert.equal((await snap(attendee)).channels, undefined); assert.equal(await counts(), null); assert.equal(avRuntime.states.has(key), false);
    assert.equal((await control(attendee, 'select', { resourceId: 'song', loop: false })).code, 'AV_COMMAND_DENIED'); assert.equal(avRuntime.states.has(key), false);
  });
  await t.test('media, drawing and reaction counters roll back before commit; private resources cannot be selected from a public URL', async () => {
    for (const [session, action, payload] of [[stageSession, 'control', { action: 'select', resourceId: 'song', loop: false }], [publicSession, 'react', { emoji: '❤️' }], [stageSession, 'draw', { slideIndex: 0, points: [{ x: .1, y: .2 }, { x: .8, y: .9 }], width: .01, ttl: 4200 }]]) await assert.rejects(avRuntime.operate(faultyGrants(), credentials(session), live, action, payload), /AV_TEST_COMMIT_FAILURE/);
    assert.equal(avRuntime.states.has(key), false); assert.equal(await counts(), null); assert.equal((await control(player, 'select', { resourceId: 'not-prepared', loop: false })).code, 'AV_RESOURCE_NOT_FOUND');
    const replies = await Promise.all([control(stage, 'select', { resourceId: 'song', loop: false }), control(player, 'select', { resourceId: 'film', loop: false })]); assert.ok(replies.every(reply => reply.ok));
    const current = await snap(player); assert.equal(current.channels.audio.resource.id, 'song'); assert.equal(current.channels.video.resource.id, 'film'); assert.match(current.channels.audio.resource.assetUrl, /^\/api\/events-v2\/live\//);
    assert.equal(JSON.stringify(current).includes('media.immersalive.com'), false); assert.equal((await snap(attendee)).available, undefined);
  });
  await t.test('Speaker/Player run independent AV channels, shared volume, pause/seek/play/loop and reauthorized one-second fades without stale callbacks', async () => {
    let current = await snap(player); const audioId = current.channels.audio.playbackId, videoId = current.channels.video.playbackId;
    setClock(1000); assert.equal((await control(speaker, 'pause', { type: 'audio', playbackId: audioId })).ok, true); assert.equal((await snap(player)).channels.audio.position, 1); assert.equal((await snap(player)).channels.video.status, 'playing');
    await control(player, 'seek', { type: 'audio', playbackId: audioId, position: 3 }); await control(stage, 'play', { type: 'audio', playbackId: audioId }); await control(player, 'loop', { type: 'audio', playbackId: audioId, loop: true }); await control(speaker, 'volume', { volume: .4 });
    current = await snap(player); assert.equal(current.channels.audio.volume, .4); assert.equal(current.channels.video.volume, .4);
    assert.equal((await control(player, 'seek', { type: 'audio', playbackId: audioId, position: 999 })).code, 'AV_INVALID_COMMAND');
    const fading = await control(stage, 'select', { resourceId: 'song2', loop: false }); assert.equal(fading.snapshot.channels.audio.status, 'fading'); assert.equal(fading.snapshot.channels.audio.resource.id, 'song');
    setClock(2001); const timer = [...f.avTimers].at(-1); assert.ok(timer); f.avTimers.delete(timer[0]); await timer[1](); current = await snap(player); assert.equal(current.channels.audio.resource.id, 'song2'); assert.notEqual(current.channels.audio.playbackId, audioId);
    assert.equal((await command(player, 'ended', { type: 'audio', playbackId: audioId })).code, 'AV_STALE_PLAYBACK');
    const replacement = current.channels.audio.playbackId; await control(player, 'fade-stop', { type: 'audio', playbackId: replacement }); const obsolete = [...f.avTimers].at(-1)[1]; await control(player, 'stop', { type: 'audio', playbackId: replacement }); setClock(3002); await obsolete(); assert.equal((await snap(player)).channels.audio.status, 'stopped');
    assert.equal((await command(stage, 'ended', { type: 'video', playbackId: videoId })).code, 'AV_COMMAND_DENIED'); assert.equal((await command(player, 'ended', { type: 'video', playbackId: videoId })).ok, true);
  });
  await t.test('server-prepared playlists advance only current Player playback, loop and stop on last item', async () => {
    let reply = await control(player, 'select_playlist', { playlistId: 'music', loop: false }); assert.equal(reply.ok, true); assert.equal(reply.snapshot.channels.audio.resource.id, 'song');
    reply = await command(player, 'ended', { type: 'audio', playbackId: reply.snapshot.channels.audio.playbackId }); assert.equal(reply.snapshot.channels.audio.resource.id, 'song2');
    reply = await command(player, 'ended', { type: 'audio', playbackId: reply.snapshot.channels.audio.playbackId }); assert.equal(reply.snapshot.channels.audio.status, 'stopped');
    reply = await control(player, 'select_playlist', { playlistId: 'films', loop: true }); const old = reply.snapshot.channels.video.playbackId;
    reply = await command(player, 'playlist_advance', { type: 'video', playbackId: old }); assert.equal(reply.snapshot.channels.video.resource.id, 'film2');
    reply = await command(player, 'ended', { type: 'video', playbackId: reply.snapshot.channels.video.playbackId }); assert.equal(reply.snapshot.channels.video.resource.id, 'film'); assert.notEqual(reply.snapshot.channels.video.playbackId, old);
    await control(player, 'stop', { type: 'video', playbackId: reply.snapshot.channels.video.playbackId });
  });
  await t.test('live text, prepared QR, transient slide-bound drawing and twelve Audio React modes coexist with polls/Time', async () => {
    const poll = await ack(stage, 'events:poll:launch', { interactionId: 'poll' }); assert.equal(poll.ok, true);
    assert.equal((await command(player, 'overlay', { messageVisible: true, messageText: 'Visita https://immersalive.com', qrVisible: true })).ok, true); assert.equal((await snap(attendee)).overlays.messageText, 'Visita https://immersalive.com'); assert.equal((await snap(attendee)).overlays.publicId, undefined); assert.equal((await snap(player)).overlays.publicId, publicId);
    assert.equal((await command(player, 'audio_react', { action: 'set', reaction: 11, enabled: true })).ok, true); const next = await command(stage, 'audio_react', { action: 'next', enabled: true }); assert.equal(next.snapshot.audioReact.reaction, 0); assert.equal((await snap(attendee)).audioReact, undefined);
    setClock(4000); const stroke = { slideIndex: 0, points: [{ x: .1, y: .1 }, { x: .8, y: .8 }], width: .01, ttl: 4200 }; assert.equal((await command(player, 'draw', stroke)).ok, true); assert.equal((await snap(attendee)).strokes.length, 1);
    assert.equal((await command(speaker, 'draw', { ...stroke, slideIndex: 1 })).code, 'AV_INVALID_COMMAND'); assert.equal((await command(player, 'draw', stroke)).code, 'AV_DRAW_RATE_LIMITED');
    await ack(stage, 'events:slide:next'); assert.equal((await snap(attendee)).strokes.length, 0); setClock(8300); assert.equal((await snap(player)).strokes.length, 0);
    assert.equal((await command(player, 'clear_message')).ok, true); assert.equal((await snap(attendee)).overlays.messageText, ''); await command(player, 'clear_screen'); assert.equal((await snap(player)).overlays.qrVisible, false);
    await ack(stage, 'events:poll:close', { pollRunId: poll.snapshot.pollRunId });
    assert.equal((await ack(player, 'events:time:control', { expectedRevision: 0, target: 'screen', action: 'start', mode: 'clock' })).ok, true);
  });
  await t.test('reactions are own-window only, persist in separate SQL, deduplicate rate across reconnect and roll back rejected echoes', async () => {
    let own = 0, leaked = 0; attendee.on('events:av:reaction', () => own++); other.on('events:av:reaction', () => leaked++);
    for (let i = 0; i < 4; i++) assert.equal((await command(attendee, 'react', { emoji: '❤️' })).ok, true);
    assert.equal(own, 4); assert.equal(leaked, 0); assert.equal((await counts()).heart_count, 4); assert.equal((await snap(player)).reactions.length, 4); assert.equal((await snap(attendee)).reactions, undefined); assert.equal((await snap(player)).reactionCounts, undefined); assert.equal((await snap(stage)).reactionCounts['❤️'], 4);
    const twin = await connect(publicSession); assert.equal((await command(twin, 'react', { emoji: '❤️' })).code, 'AV_REACTION_RATE_LIMITED'); twin.close();
    attendee.close(); attendee = await connect(publicSession); assert.equal((await command(attendee, 'react', { emoji: '❤️' })).code, 'AV_REACTION_RATE_LIMITED'); setClock(8801);
    const previous = avRuntime.states.get(key); await assert.rejects(avRuntime.operate(faultyGrants(), credentials(publicSession), live, 'react', { emoji: '🔥' }), /AV_TEST_COMMIT_FAILURE/); assert.equal((await counts()).fire_count, 0); assert.equal(avRuntime.states.get(key), previous);
    await command(player, 'overlay', { showReactions: false }); assert.equal((await command(attendee, 'react', { emoji: '🔥' })).ok, true); assert.equal((await counts()).fire_count, 1); assert.equal((await snap(player)).reactions, undefined); assert.equal(leaked, 0);
    assert.equal((await sql('SELECT COUNT(*) n FROM presentation_reaction_counts'))[0].n, legacyRows);
  });
  await t.test('private HTTP assets authorize cookies/current live before opening bytes; ranges, HEAD and If-Range never fall back to public files', async () => {
    const opened = f.assetOpens(); const full = await asset(playerSession); assert.equal(full.status, 200); assert.deepEqual(full.bytes, audio); assert.equal(full.headers.get('cache-control'), 'no-store'); assert.equal(full.headers.get('cross-origin-resource-policy'), 'same-origin'); const etag = full.headers.get('etag');
    const part = await asset(stageSession, 'asset-song', { headers: { range: 'bytes=2-5' } }); assert.equal(part.status, 206); assert.deepEqual(part.bytes, audio.subarray(2, 6)); assert.equal(part.headers.get('content-range'), `bytes 2-5/${audio.length}`);
    assert.deepEqual((await asset(playerSession, 'asset-song', { headers: { range: 'bytes=-3' } })).bytes, audio.subarray(-3));
    const head = await asset(playerSession, 'asset-song', { method: 'HEAD', headers: { range: 'bytes=2-5' } }); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
    assert.equal((await asset(playerSession, 'asset-song', { headers: { range: 'bytes=999-' } })).status, 416);
    assert.equal((await asset(playerSession, 'asset-song', { headers: { range: 'bytes=2-5', 'if-range': '"old"' } })).status, 200);
    const beforeDeny = f.assetOpens(); assert.equal(beforeDeny, opened + 4);
    assert.equal((await asset(publicSession)).status, 403); assert.equal((await asset(playerSession, 'asset-song', { noCookie: true })).status, 401);
    assert.equal((await asset(playerSession, 'asset-song', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403); assert.equal((await asset(playerSession, 'asset-song', { event: b })).status, 401); assert.equal((await asset(playerSession, 'asset-song', { live: second })).status, 403); assert.equal((await asset(playerSession, 'not-prepared')).status, 403);
    assert.equal((await asset(playerSession, 'asset-song', { headers: { 'if-none-match': etag } })).status, 304); assert.equal(f.assetOpens(), beforeDeny);
    const isolated = new EventAVRuntime({ liveRuntime: f.runtime, readAV: async prepared => ({ ...preparations.get(prepared.liveSessionId), versionId: 'changed' }) });
    await assert.rejects(grants.withSession(credentials(stageSession), (context, db) => isolated.projection(context, db, live)), { code: 'AV_CONTENT_NOT_PREPARED' });
  });
  await t.test('other live/event projections stay isolated; forged/legacy media, revoke, PAID, kill/outage and finish deny writes/pushes/bytes', async () => {
    secondPlayer = await connect(await issue('PLAYER', { liveSessionId: second }), second); foreignPlayer = await connect(await issue('PLAYER', { liveSessionId: foreign }, b), foreign);
    let cross = 0; secondPlayer.on('events:av:state', () => cross++); foreignPlayer.on('events:av:state', () => cross++);
    await command(stage, 'overlay', { messageVisible: true, messageText: 'Only one live' }); assert.equal(cross, 0); assert.equal((await snap(secondPlayer)).overlays.messageText, ''); assert.equal(await counts(second), null);
    const forged = await connect(publicSession); const before = avRuntime.states.get(key); assert.equal((await command(forged, 'control', { action: 'select', resourceId: 'song', loop: false, media_url: 'https://public' })).code, 'AV_COMMAND_DENIED'); assert.equal(avRuntime.states.get(key), before);
    const raw = await connect(publicSession); for (const event of ['audiovisual:control', 'local-library:publish', 'audio-react:control', 'drawing_stroke', 'overlay_update', 'reaction', 'media:status_update', 'audiovisual:metadata']) await new Promise((resolve, reject) => { const handle = setTimeout(() => reject(new Error('AV legacy denial timeout')), 10000); raw.once('events:command_denied', result => { clearTimeout(handle); assert.equal(result.code, 'COMMAND_NOT_ENABLED'); resolve(); }); raw.emit(event, {}); });
    await assert.rejects(avRuntime.operate({ withSession: async () => { throw new Error('SQL unavailable'); } }, credentials(stageSession), live, 'tick'), /SQL unavailable/); assert.equal(avRuntime.states.get(key), before);
    const openBefore = f.assetOpens(); f.setEnabled(false); assert.equal((await asset(playerSession)).status, 404); assert.equal(f.assetOpens(), openBefore);
    await assert.rejects(avRuntime.operate(grants, credentials(stageSession), live, 'overlay', { messageVisible: false }), { code: 'LIVE_ACCESS_DENIED' }); const disconnects = [...clients].filter(client => client.connected).map(gone); await f.grantSockets.reviewAll(); await Promise.all(disconnects); f.setEnabled(true);
    player = await connect(playerSession); attendee = await connect(publicSession); stage = await connect(stageSession);
    let publicPushes = 0; attendee.on('events:av:state', () => publicPushes++); const publicGone = gone(attendee); await sql('UPDATE event_activities SET access_level=? WHERE id=?', ['PAID', activityA]); await command(player, 'overlay', { messageVisible: false }); await publicGone; assert.equal(publicPushes, 0);
    await sql('UPDATE event_activities SET access_level=? WHERE id=?', ['FREE', activityA]); const playerGone = gone(player); await sql('UPDATE event_access_grants SET revoked_at=? WHERE id=?', [f.now(), playerSession.context.grantId]); assert.equal((await asset(playerSession)).status, 401); assert.equal(f.assetOpens(), openBefore); await f.grantSockets.reviewAll(); await playerGone;
    await sql("UPDATE event_live_sessions SET status='FINISHED', ended_at=? WHERE id=?", [f.now(), live]); const finished = avRuntime.states.get(key); await assert.rejects(avRuntime.operate(grants, credentials(stageSession), live, 'tick'), { code: 'LIVE_ACCESS_DENIED' }); assert.equal(avRuntime.states.get(key), finished); assert.equal((await asset(stageSession)).status, 403); assert.equal(f.assetOpens(), openBefore);
  });
}
module.exports = { avSuite };
