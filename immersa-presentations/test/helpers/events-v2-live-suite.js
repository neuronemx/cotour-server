const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { executionKey, EventLiveRuntime } = require('../../events-v2/live-runtime');
async function liveSuite(t, f) {
  const { request, sql, grants, grantSockets, base, o1, a, b, stageA, activityA, activityB, liveA, publicId, runtime, preparations } = f;
  const path = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const active = new Set(); t.after(() => { for (const client of active) client.close(); });
  const ack = (client, event, payload = {}) => new Promise((resolve, reject) => client.timeout(3000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
  async function connect(session) {
    const auth = { eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken, role: 'STAGE', audienceLevel: 'PAID' };
    const client = clientSocket(base + '/events-v2', { auth, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); active.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('context timeout')), 3000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); }); return client;
  }
  async function issue(kind, fields, purpose = kind === 'PLAYER' ? 'player' : 'live', event = a) {
    const issued = await request('admin1', 'POST', path(event) + '/grants', { kind, purpose, ...fields }); assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const exchanged = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: issued.body.token }); assert.equal(exchanged.status, 200); return exchanged.body;
  }
  const join = (client, liveId = liveA) => ack(client, 'events:live:join', { liveSessionId: liveId });
  const snapshot = client => ack(client, 'events:live:snapshot');
  const prepare = (eventId, liveSessionId) => preparations.set(liveSessionId, Object.freeze({ eventId, liveSessionId, deckId: 'v2-private-deck', versionId: 'immutable-test-version', slideCount: 5, polls: [] }));
  const liveA2 = crypto.randomUUID(), liveB = crypto.randomUUID(), otherStage = crypto.randomUUID(), otherActivity = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['FREE', activityA]);
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  for (const [id, event, stage, activity] of [[liveA2, a, stageA, activityA], [liveB, b, stageB, activityB]]) await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?)', [otherStage, a, 'Other scope']);
  await sql('INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id) VALUES (?,?,?,?,?)', [otherActivity, a, otherStage, 'Other scope', 'v2-private-deck']);
  await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [otherLive, a, otherStage, otherActivity, 'v2-private-deck']);
  await request('admin1', 'PUT', path(b) + '/operational-window', { endsAt: new Date(f.now().getTime() + 86400000).toISOString() });
  let stage, speaker, player, publicClient, stageSession;
  await t.test('live scope checked before preparation/engine creation; rehearsal never joins live', async () => {
    const before = f.preparationReads(), states = runtime.states.size;
    for (const [kind, fields, purpose, target] of [ ['STAGE', { stageId: stageA }, 'live', liveB], ['STAGE', { stageId: stageA }, 'live', otherLive], ['SPEAKER', { activityId: activityA }, 'rehearsal', liveA], ['PLAYER', { liveSessionId: liveA }, 'player', liveA2], ['VENUE', {}, 'live', liveA], ['MODERATOR', {}, 'live', liveA] ]) {
      const client = await connect(await issue(kind, fields, purpose)); assert.equal((await join(client, target)).ok, false); client.close();
    }
    assert.equal(f.preparationReads(), before); assert.equal(runtime.states.size, states);
  });
  await t.test('private preparation is mandatory; live binding is fixed across commands', async () => {
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    assert.equal((await join(stage)).code, 'CONTENT_NOT_PREPARED'); assert.equal(runtime.states.size, 0);
    prepare(a, liveA); prepare(a, liveA2); prepare(b, liveB);
    assert.equal((await join(stage)).snapshot.slideIndex, 0); assert.equal((await join(stage, liveA2)).ok, false);
    stage.close(); stage = await connect(stageSession); assert.equal((await join(stage)).ok, true);
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); player = await connect(await issue('PLAYER', { liveSessionId: liveA }));
    const registration = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'Live attendee' }); assert.equal(registration.status, 201); publicClient = await connect(registration.body);
    for (const client of [speaker, player, publicClient]) assert.equal((await join(client)).ok, true);
  });
  await t.test('Stage/Speaker navigation, Player steps only, Público control denied without mutation', async () => {
    assert.equal((await ack(speaker, 'events:slide:next')).snapshot.presenterSlideIndex, 1);
    assert.equal((await ack(stage, 'events:slide:go', { slideIndex: 3 })).snapshot.presenterSlideIndex, 3);
    assert.equal((await ack(player, 'events:slide:prev')).snapshot.slideIndex, 2);
    const previous = runtime.states.get(executionKey(a, liveA));
    for (const [client, name, payload] of [[player, 'events:slide:go', { slideIndex: 4 }], [player, 'events:presentation:pause', {}], [publicClient, 'events:slide:next', {}]]) {
      assert.equal((await ack(client, name, payload)).code, 'LIVE_COMMAND_DENIED'); assert.equal(runtime.states.get(executionKey(a, liveA)), previous);
    }
    assert.equal((await ack(stage, 'events:slide:go', { slideIndex: 1.5 })).code, 'INVALID_COMMAND'); assert.equal(runtime.states.get(executionKey(a, liveA)), previous);
    assert.deepEqual(Object.keys((await snapshot(publicClient)).snapshot).sort(), ['eventId', 'liveSessionId', 'revision', 'slideIndex', 'transmissionPaused'].sort());
  });
  await t.test('paused preview stays private; resume and clamping preserve navigation semantics', async () => {
    await ack(speaker, 'events:presentation:pause'); await ack(speaker, 'events:slide:go', { slideIndex: 99 });
    assert.equal((await snapshot(speaker)).snapshot.presenterSlideIndex, 4); assert.equal((await snapshot(publicClient)).snapshot.slideIndex, 2); assert.equal((await snapshot(player)).snapshot.presenterSlideIndex, undefined);
    assert.equal((await ack(stage, 'events:slide:next')).code, 'LIVE_COMMAND_DENIED');
    await ack(stage, 'events:presentation:play'); assert.equal((await snapshot(publicClient)).snapshot.slideIndex, 4); await ack(stage, 'events:slide:go', { slideIndex: 0 });
  });
  await t.test('same deck across runs/events has independent state and broadcasts; commands serialize', async () => {
    const second = await connect(await issue('STAGE', { stageId: stageA })), foreign = await connect(await issue('STAGE', { stageId: stageB }, 'live', b));
    assert.equal((await join(second, liveA2)).ok, true); assert.equal((await join(foreign, liveB)).ok, true);
    let secondEmits = 0, foreignEmits = 0; second.on('events:live:state', () => secondEmits++); foreign.on('events:live:state', () => foreignEmits++);
    const results = await Promise.all([ack(stage, 'events:slide:next'), ack(speaker, 'events:slide:next'), ack(stage, 'events:slide:next')]); assert.ok(results.every(result => result.ok));
    assert.equal((await snapshot(stage)).snapshot.presenterSlideIndex, 3); assert.equal(runtime.states.get(executionKey(a, liveA2)).presenterSlideIndex, 0); assert.equal(runtime.states.get(executionKey(b, liveB)).presenterSlideIndex, 0); assert.equal(secondEmits, 0); assert.equal(foreignEmits, 0);
    await ack(second, 'events:slide:next'); assert.equal((await snapshot(stage)).snapshot.presenterSlideIndex, 3); second.close(); foreign.close();
  });
  await t.test('FREE cannot enter PAID or receive after level changes; forged PAID ignored', async () => {
    const publicDisconnected = publicClient.connected ? new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('public client disconnect timeout')), 3000); publicClient.once('disconnect', () => { clearTimeout(timer); resolve(); }); }) : Promise.resolve();
    await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['PAID', activityA]);
    let leaked = 0; publicClient.on('events:live:state', () => leaked++); await ack(stage, 'events:slide:prev'); await grantSockets.reviewAll(); await publicDisconnected;
    assert.equal(leaked, 0); assert.equal(publicClient.connected, false);
    const registered = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'FREE' }), client = await connect(registered.body);
    let deniedReads = 0; const isolated = new EventLiveRuntime({ readPreparation: async () => { deniedReads++; return null; } });
    await assert.rejects(isolated.operate(grants, { eventId: registered.body.context.eventId, grantId: registered.body.context.grantId, sessionToken: registered.body.sessionToken }, liveA), { code: 'LIVE_ACCESS_DENIED' });
    assert.equal(deniedReads, 0); assert.equal((await join(client)).ok, false); client.close(); await sql('UPDATE event_activities SET access_level = ? WHERE id = ?', ['FREE', activityA]);
  });
  await t.test('reconnect restores same execution; forged command context cannot mutate', async () => {
    const before = runtime.states.get(executionKey(a, liveA)), count = (await sql('SELECT COUNT(*) n FROM event_live_attendance'))[0].n;
    stage.close(); stage = await connect(stageSession); assert.equal((await join(stage)).snapshot.presenterSlideIndex, before.presenterSlideIndex); assert.equal(runtime.states.size, 3); assert.equal((await sql('SELECT COUNT(*) n FROM event_live_attendance'))[0].n, count);
    assert.equal((await ack(stage, 'events:slide:next', { liveSessionId: liveA2 })).ok, false); assert.equal(runtime.states.get(executionKey(a, liveA)), before);
    stage.close(); stage = await connect(stageSession); await join(stage);
  });
  await t.test('revoke, finish, changed version and outage prevent mutation and emission', async () => {
    const revoked = await issue('SPEAKER', { activityId: activityA }), client = await connect(revoked); await join(client);
    let leaked = 0; client.on('events:live:state', () => leaked++); await request('admin1', 'DELETE', path(a) + '/grants/' + revoked.context.grantId); await ack(stage, 'events:slide:prev'); assert.equal(client.connected, false); assert.equal(leaked, 0);
    const previous = runtime.states.get(executionKey(a, liveA));
    // Existing bound sockets may be disconnected by the idle review as soon
    // as preparation changes. Use an unbound connection for an exact denial
    // ack, and test idle disconnection separately for finished resources.
    for (const connected of [stage, speaker, player]) connected.close();
    preparations.set(liveA, { ...preparations.get(liveA), versionId: 'changed' });
    const changed = await connect(stageSession);
    assert.equal((await join(changed)).code, 'CONTENT_VERSION_CHANGED');
    assert.equal(runtime.states.get(executionKey(a, liveA)), previous); changed.close(); prepare(a, liveA);
    stage = await connect(stageSession); await join(stage);
    let denied = false, outageEmits = 0;
    stage.on('events:access_denied', () => { denied = true; });
    stage.on('events:live:state', () => outageEmits++);
    const disconnected = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('outage did not disconnect')), 3000); stage.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
    const saved = grants.pool; grants.pool = { execute: async () => { throw new Error('DB unavailable'); } };
    try {
      stage.emit('events:slide:next', {}); await disconnected;
      assert.equal(denied, true); assert.equal(outageEmits, 0); assert.equal(runtime.states.get(executionKey(a, liveA)), previous);
    } finally { grants.pool = saved; }
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); await join(speaker);
    const finishedDisconnect = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('finished run did not disconnect')), 3000); speaker.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
    await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = ? WHERE id = ?", [f.now(), liveA]);
    await grantSockets.reviewAll(); await finishedDisconnect; assert.equal(speaker.connected, false);
    const next = await connect(stageSession), reads = f.preparationReads();
    assert.equal((await join(next)).ok, false); assert.equal(f.preparationReads(), reads);
    assert.equal(runtime.states.get(executionKey(a, liveA)), previous); next.close();
  });
}
module.exports = { liveSuite };
