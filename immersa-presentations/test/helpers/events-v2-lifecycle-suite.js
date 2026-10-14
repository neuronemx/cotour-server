const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { executionKey } = require('../../events-v2/live-runtime');

async function lifecycleSuite(t, f) {
  const { request, sql, grants, domain, lifecycle, base, o1, a, b, publicId, runtime, preparations, grantSockets } = f;
  const stageId = crypto.randomUUID(), otherStage = crypto.randomUUID(), activity = crypto.randomUUID(), nextActivity = crypto.randomUUID(), otherActivity = crypto.randomUUID();
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Lifecycle A', otherStage, b, 'Lifecycle B']);
  for (const [id, event, stage] of [[activity, a, stageId], [nextActivity, a, stageId], [otherActivity, b, otherStage]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level) VALUES (?,?,?,?,?,'DECK_CHECK','FREE')", [id, event, stage, 'Lifecycle', 'v2-private-deck']);
  }
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const credentials = s => ({ eventId: s.context.eventId, grantId: s.context.grantId, sessionToken: s.sessionToken });
  const root = s => `/api/events-v2/access/${s.context.eventId}/${s.context.grantId}`;
  const start = (s, id = activity, extra = {}) => request(null, 'POST', root(s) + `/activities/${id}/start`, {}, { cookie: s.cookie, ...extra });
  const finish = (s, id, extra = {}) => request(null, 'POST', root(s) + `/live-sessions/${id}/finish`, {}, { cookie: s.cookie, ...extra });
  async function issue(kind, fields, event = a) {
    const result = await request('admin1', 'POST', `/api/events-v2/organizations/${o1}/events/${event}/grants`, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(result.status, 201, JSON.stringify(result.body));
    const exchanged = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: result.body.token }); assert.equal(exchanged.status, 200);
    return { ...exchanged.body, cookie: exchanged.headers.getSetCookie().map(s => s.split(';')[0]).join('; ') };
  }
  const ack = (client, event, payload = {}) => new Promise((resolve, reject) => client.timeout(10000).emit(event, payload, (error, result) => error ? reject(new Error(`lifecycle ack: ${event}`, { cause: error })) : resolve(result)));
  async function connect(session, liveId) {
    const client = io(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE' }, extraHeaders: { origin: base }, transports: ['websocket'], reconnection: false, forceNew: true }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Lifecycle context timeout')), 10000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', e => { clearTimeout(timer); reject(e); }); });
    if (liveId) assert.equal((await ack(client, 'events:live:join', { liveSessionId: liveId })).ok, true);
    return client;
  }
  const gone = client => new Promise((resolve, reject) => { if (!client.connected) return resolve(); const timer = setTimeout(() => reject(new Error('Lifecycle disconnect timeout')), 10000); client.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  const count = async stage => Number((await sql('SELECT COUNT(*) AS n FROM event_live_sessions WHERE event_stage_id=?', [stage]))[0].n);
  const originalReader = runtime.readPreparation; let prepared = false;
  runtime.readPreparation = async (live, db) => {
    if (![stageId, otherStage].includes(live.stageId)) return originalReader(live, db);
    if (!prepared) return null;
    const record = { ...live, versionId: 'lifecycle-approved-v1', slideCount: 4, polls: [], knowledge: [], raffles: [], games: [], resources: [], playlists: [] };
    preparations.set(live.liveSessionId, record); return record;
  };
  t.after(() => { runtime.readPreparation = originalReader; });
  const stage = await issue('STAGE', { stageId }), foreignStage = await issue('STAGE', { stageId: otherStage }, b), speaker = await issue('SPEAKER', { activityId: activity });
  const registration = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'Lifecycle attendee' }); assert.equal(registration.status, 201);
  const publicSession = { ...registration.body, cookie: registration.headers.getSetCookie().map(s => s.split(';')[0]).join('; ') };
  let stageClient, liveId, foreignId, playerSession, player, speakerClient, attendee, foreignClient;

  await t.test('lifecycle HTTP requires the fixed Stage cookie and same origin; account/role/scope substitutions never initialize a run', async () => {
    const before = await count(stageId), stateCount = runtime.states.size;
    for (const session of [speaker, publicSession]) assert.equal((await start(session)).status, 403);
    assert.equal((await start(stage, otherActivity)).status, 404);
    assert.equal((await start(foreignStage, activity)).status, 404);
    assert.equal((await start(stage, activity, { cookie: '', authorization: 'Bearer ' + stage.sessionToken })).status, 401);
    assert.equal((await start(stage, activity, { cookie: f.cookies.get('admin1') })).status, 401);
    assert.equal((await start(stage, activity, { origin: 'https://foreign.test' })).status, 403);
    assert.equal((await start(stage, activity, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await request(null, 'POST', root(stage) + `/activities/${activity}/start`, { role: 'STAGE', eventId: b }, { cookie: stage.cookie })).status, 400);
    const current = await request(null, 'GET', root(stage) + '/live-session', undefined, { cookie: stage.cookie }); assert.equal(current.status, 200); assert.equal(current.body.liveSession, null);
    assert.equal(await count(stageId), before); assert.equal(runtime.states.size, stateCount);
  });
  await t.test('only approved private preparation starts a session; pending deck and unavailable reader roll back all operational writes', async () => {
    const before = await count(stageId), states = runtime.states.size;
    await sql("UPDATE event_activities SET deck_check_status='PENDING' WHERE id=?", [activity]); assert.equal((await start(stage)).status, 403);
    await sql("UPDATE event_activities SET deck_check_status='DECK_CHECK' WHERE id=?", [activity]); assert.equal((await start(stage)).status, 403);
    assert.equal(await count(stageId), before); assert.equal(runtime.states.size, states);
    assert.equal((await sql('SELECT status FROM event_activities WHERE id=?', [activity]))[0].status, 'SCHEDULED');
    prepared = true;
  });
  await t.test('concurrent HTTP and socket starts create exactly one committed session; a second Stage can run the same deck in another event', async () => {
    stageClient = await connect(stage);
    const replies = await Promise.all([start(stage), ack(stageClient, 'events:lifecycle:start', { activityId: activity })]);
    const winners = replies.filter(r => r.status === 201 || r.ok === true); assert.equal(winners.length, 1);
    const loser = replies.find(r => r.status !== 201 && r.ok !== true); assert.equal(loser.body?.code || loser.code, 'STAGE_ALREADY_LIVE');
    liveId = (winners[0].body || winners[0].liveSession).liveSessionId; assert.equal(await count(stageId), 1);
    const current = await ack(stageClient, 'events:lifecycle:current'); assert.equal(current.liveSession.liveSessionId, liveId);
    assert.equal(current.liveSession.deckId, undefined); assert.equal(current.liveSession.versionId, undefined);
    const foreign = await start(foreignStage, otherActivity); assert.equal(foreign.status, 201); foreignId = foreign.body.liveSessionId;
    assert.equal((await finish(stage, foreignId)).status, 404); assert.equal((await finish(foreignStage, liveId)).status, 404);
  });
  await t.test('Stage and Speaker continue one session; Speaker/Player/Public cannot finish it or inherit Stage lifecycle from client roles', async () => {
    assert.equal((await ack(stageClient, 'events:live:join', { liveSessionId: liveId })).ok, true);
    speakerClient = await connect(speaker, liveId); playerSession = await issue('PLAYER', { liveSessionId: liveId }); player = await connect(playerSession, liveId); attendee = await connect(publicSession, liveId);
    foreignClient = await connect(foreignStage, foreignId);
    assert.equal((await ack(speakerClient, 'events:slide:next')).ok, true); assert.equal((await ack(stageClient, 'events:slide:next')).snapshot.slideIndex, 2);
    for (const client of [speakerClient, player, attendee]) assert.equal((await ack(client, 'events:lifecycle:finish')).code, 'LIFECYCLE_COMMAND_DENIED');
    assert.equal((await finish(playerSession, liveId)).status, 403);
    assert.equal((await ack(stageClient, 'events:lifecycle:start', { activityId: nextActivity })).code, 'LIFECYCLE_COMMAND_DENIED');
    assert.equal((await ack(player, 'events:live:snapshot')).snapshot.slideIndex, 2);
    await f.qnaRuntime.operate(grants, credentials(stage), liveId, 'open', {});
    await f.qnaRuntime.operate(grants, credentials(publicSession), liveId, 'submit', { roundId: (await sql('SELECT id FROM event_v2_qna_rounds WHERE presentation_session_id=? AND archived_at IS NULL', [liveId]))[0].id, question: 'Preserved after finish', allowNameOnScreen: false });
    await f.avRuntime.operate(grants, credentials(publicSession), liveId, 'react', { emoji: '❤️' });
  });
  await t.test('failed commit preserves live status, engines and private history; unavailable DB and disabled flag cannot start or finish', async () => {
    const faulty = new EventDomainRepository(domain.pool);
    faulty.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('PRIVATE_COMMIT_DIAGNOSTIC'); } finally { await db.rollback(); db.release(); } };
    const original = lifecycle.grants, key = executionKey(a, liveId), state = runtime.states.get(key), av = f.avRuntime.states.get(key);
    lifecycle.grants = new EventGrantRepository(faulty, { now: f.now });
    try { const reply = await finish(stage, liveId); assert.equal(reply.status, 503); assert.deepEqual(reply.body, { code: 'AUTHORIZATION_UNAVAILABLE' }); }
    finally { lifecycle.grants = original; }
    assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?', [liveId]))[0].status, 'LIVE'); assert.equal(runtime.states.get(key), state); assert.equal(f.avRuntime.states.get(key), av);
    f.setEnabled(false); try { assert.equal((await finish(stage, liveId)).status, 404); assert.equal((await start(stage, nextActivity)).status, 404); } finally { f.setEnabled(true); }
    assert.equal(runtime.states.get(key), state);
    const saved = grants.pool; grants.pool = { execute: async () => { throw new Error('PRIVATE_DB_DIAGNOSTIC'); } };
    try { assert.equal((await finish(stage, liveId)).status, 503); } finally { grants.pool = saved; }
    assert.equal(runtime.states.get(key), state);
  });
  await t.test('committed finish clears its runtime, disconnects its recipients, preserves SQL reports and leaves the other event live', async () => {
    // Reconnect if the explicit feature-off review closed any test socket.
    if (!stageClient.connected) stageClient = await connect(stage, liveId);
    for (const client of [player, speakerClient, attendee]) if (!client.connected) clients.delete(client);
    let terminal = 0; stageClient.on('events:lifecycle:finished', data => { assert.equal(data.liveSessionId, liveId); terminal++; });
    const targetClients = [...clients].filter(client => client.connected && client !== foreignClient), disconnected = targetClients.map(gone);
    const reply = await ack(stageClient, 'events:lifecycle:finish'); assert.equal(reply.ok, true); assert.equal(reply.liveSession.status, 'FINISHED'); await Promise.all(disconnected); assert.equal(terminal, 1);
    const key = executionKey(a, liveId); assert.equal(runtime.states.has(key), false); assert.equal(f.avRuntime.states.has(key), false);
    assert.equal((await sql('SELECT status FROM event_activities WHERE id=?', [activity]))[0].status, 'SCHEDULED');
    const history = await request('admin1', 'GET', `/api/events-v2/organizations/${o1}/events/${a}/live-sessions/${liveId}/qna/history`); assert.equal(history.status, 200); assert.equal(JSON.stringify(history.body).includes('Preserved after finish'), true);
    assert.equal((await sql('SELECT heart_count FROM event_v2_reaction_counts WHERE id=?', [liveId]))[0].heart_count, 1);
    if (!foreignClient.connected) foreignClient = await connect(foreignStage, foreignId);
    assert.equal((await ack(foreignClient, 'events:live:snapshot')).ok, true);
    const repeated = await finish(stage, liveId); assert.equal(repeated.status, 200); assert.deepEqual(repeated.body, reply.liveSession);
    const old = await connect(speaker); const joined = await ack(old, 'events:live:join', { liveSessionId: liveId }); assert.equal(joined.ok, false); assert.equal(runtime.states.has(key), false); old.close();
  });
  await t.test('next run gets a new execution; repeated old finish cannot stop it; revoked Stage and legacy lifecycle routes cannot operate v2', async () => {
    const newRun = await start(stage, nextActivity); assert.equal(newRun.status, 201); assert.notEqual(newRun.body.liveSessionId, liveId);
    assert.equal((await finish(stage, liveId)).status, 200); assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?', [newRun.body.liveSessionId]))[0].status, 'LIVE');
    assert.equal((await request(null, 'POST', '/api/event/live-sessions/start', { eventActivityId: nextActivity })).status, 404);
    assert.equal((await request(null, 'POST', `/api/event/live-sessions/${newRun.body.liveSessionId}/finish`, {})).status, 404);
    f.setEnabled(false); try { assert.equal((await request(null, 'POST', `/api/event/live-sessions/${newRun.body.liveSessionId}/finish`, {})).status, 404); } finally { f.setEnabled(true); }
    const revoked = await issue('STAGE', { stageId }); await grants.revoke(f.ids.get('admin1'), o1, a, revoked.context.grantId);
    assert.equal((await finish(revoked, newRun.body.liveSessionId)).status, 401);
    assert.equal((await finish(stage, newRun.body.liveSessionId)).status, 200); assert.equal((await finish(foreignStage, foreignId)).status, 200);
    await grantSockets.reviewAll();
  });
}
module.exports = { lifecycleSuite };
