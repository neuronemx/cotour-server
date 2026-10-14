const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController, targetKey } = require('../../public/events-v2/live-console');
const { executionKey } = require('../../events-v2/live-runtime');

// Runs the shipped console modules against real HTTP, SQL authorization and
// Socket.IO. This is not a browser acceptance test or a production reader.
async function consoleControlsSuite(t, f) {
  const { request, sql, grants, runtime, preparations, base, a, o1 } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), paidStage = crypto.randomUUID();
  const free = crypto.randomUUID(), paid = crypto.randomUUID(), clients = new Set();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Console free', paidStage, a, 'Console paid']);
  for (const [id, stage, level] of [[free, stageId, 'FREE'], [paid, paidStage, 'PAID']]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level) VALUES (?,?,?,?,?,'DECK_CHECK',?)", [id, a, stage, 'Console ' + level, 'v2-private-deck', level]);
  }
  const originalReader = runtime.readPreparation;
  runtime.readPreparation = async (live, db) => {
    if (live.eventId !== a || ![free, paid].includes(live.activityId)) return originalReader(live, db);
    const record = { ...live, versionId: 'console-controls-v1', slideCount: 5, polls: [], knowledge: [], raffles: [], games: [], resources: [], playlists: [] };
    preparations.set(live.liveSessionId, record); return record;
  };
  const controlsReader = runtime.readPreparation;
  t.after(() => { for (const item of clients) item.access.close(); runtime.readPreparation = originalReader; });
  async function issue(view, kind, scope) {
    return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) };
  }
  async function register(publicId) {
    const result = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'Operational console fixture' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { view: 'audience', issued: { grantId: result.body.context.grantId }, cookie: result.headers.get('set-cookie').split(';')[0] };
  }
  async function waitUntil(predicate, label) {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Operational console timeout: ' + label);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  function open(item) {
    let cookie = item.cookie, controller;
    const sockets = [], states = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), retryDelayMs: 10, requestTimeoutMs: 8000,
      fetch: async (url, options) => {
        const result = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } });
        if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
        return result;
      }, io: (namespace, options) => {
        const socket = io(base + namespace, { ...options, extraHeaders: { origin: base }, transports: ['websocket'] });
        const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); };
        sockets.push(socket); return socket;
      }, onState: state => controller.updateAccess(state), onEvent: (name, value) => controller.receive(name, value) });
    controller = createController({ access, onState: state => states.push(state) });
    const record = { access, controller, sockets, commands, states, start: async () => { await access.start(link.token); await waitUntil(() => access.getState().status === 'ready', 'ready'); },
      live: () => waitUntil(() => controller.getState().status === 'live', 'live'), ready: () => access.getState(), state: () => controller.getState() };
    clients.add(record); return record;
  }
  const count = async (table, where = '', params = []) => Number((await sql('SELECT COUNT(*) n FROM ' + table + where, params))[0].n);
  const stage = open(await issue('stage', 'STAGE', { stageId }));
  const otherStage = open(await issue('stage', 'STAGE', { stageId: paidStage }));
  const speaker = open(await issue('speaker', 'SPEAKER', { activityId: free }));
  const attendee = open(await register(f.publicId));
  let liveId, paidLive, player, paidAttendee;

  await t.test('operational catalogs use fixed scopes; only Stage creates a run and FREE audience never discovers PAID activities', async () => {
    await stage.start(); await otherStage.start(); await speaker.start(); await attendee.start();
    assert.deepEqual(stage.ready().targets.map(row => row.activityId), [free]);
    assert.deepEqual(speaker.ready().targets.map(row => row.activityId), [free]);
    assert.equal(attendee.ready().targets.some(row => row.accessLevel === 'PAID'), false);
    for (const record of [stage, otherStage, speaker, attendee]) {
      assert.equal(JSON.stringify(record.ready().targets).includes('v2-private-deck'), false);
      assert.equal(await record.controller.operate('start'), false); // no selected Stage target
    }
    await stage.controller.select(targetKey(stage.ready().targets[0]));
    assert.equal(await stage.controller.operate('start'), true); await stage.live(); liveId = stage.state().target.liveSessionId;
    assert.equal(await count('event_live_sessions', ' WHERE event_stage_id=?', [stageId]), 1);
    await otherStage.controller.select(targetKey(otherStage.ready().targets[0]));
    assert.equal(await otherStage.controller.operate('start'), true); await otherStage.live(); paidLive = otherStage.state().target.liveSessionId;
    await speaker.access.resume(); await speaker.live();
    player = open(await issue('screen', 'PLAYER', { liveSessionId: liveId })); await player.start(); await player.live();
    assert.deepEqual(player.ready().targets.map(row => row.liveSessionId), [liveId]);
    await attendee.access.resume();
    await waitUntil(() => attendee.ready().status === 'ready', 'audience catalog after reconnect');
    assert.equal(attendee.ready().targets.some(row => row.liveSessionId === paidLive), false);
    await attendee.controller.select(targetKey(attendee.ready().targets.find(row => row.activityId === free))); await attendee.live();
    let qr = (await sql("SELECT public_id FROM event_public_qrs WHERE event_workspace_id=? AND audience_level='PAID'", [a]))[0];
    if (!qr) { qr = { public_id: 'controls-paid-' + crypto.randomUUID() }; await sql("INSERT INTO event_public_qrs (id,event_workspace_id,public_id,audience_level) VALUES (?,?,?,'PAID')", [crypto.randomUUID(), a, qr.public_id]); }
    paidAttendee = open(await register(qr.public_id)); await paidAttendee.start();
    assert.ok([free, paid].every(id => paidAttendee.ready().targets.some(row => row.activityId === id)));
    await paidAttendee.controller.select(targetKey(paidAttendee.ready().targets.find(row => row.activityId === paid))); await paidAttendee.live();
  });
  await t.test('shipped controllers share canonical navigation and pause state; viewer projections and commands stay restricted', async () => {
    assert.equal(await stage.controller.operate('next'), true);
    await waitUntil(() => attendee.state().snapshot?.slideIndex === 1 && player.state().snapshot?.slideIndex === 1, 'first slide fanout');
    assert.equal(await speaker.controller.operate('pause'), true);
    assert.equal(await speaker.controller.operate('go', { slideIndex: 3 }), true);
    await waitUntil(() => stage.state().snapshot?.presenterSlideIndex === 3, 'paused presenter fanout');
    assert.equal(attendee.state().snapshot.slideIndex, 1);
    for (const record of [player, attendee, paidAttendee]) {
      assert.equal(record.state().snapshot.presenterSlideIndex, undefined); assert.equal(record.state().snapshot.slideCount, undefined);
      assert.equal(await record.controller.operate('go', { slideIndex: 2 }), false);
      assert.equal(await record.controller.operate('finish'), false);
    }
    const revision = stage.state().snapshot.revision;
    const denied = await attendee.access.command('events:slide:next'); assert.equal(denied.ok, false); assert.equal(denied.code, 'LIVE_COMMAND_DENIED');
    assert.equal(runtime.states.get(executionKey(a, liveId)).revision, revision);
    assert.equal(await player.controller.operate('prev'), true); // emergency arrows retain existing core semantics
    assert.equal(await speaker.controller.operate('play'), true);
    await waitUntil(() => attendee.state().snapshot?.slideIndex === 2, 'resumed transmission');
    assert.equal(paidAttendee.state().snapshot.slideIndex, 0);
  });
  await t.test('a real navigation ack loss reconnects the same identity, reads the committed position and never replays the mutation', async () => {
    assert.equal(await stage.controller.operate('go', { slideIndex: 0 }), true);
    const actor = stage.ready().context.actorId, before = {};
    for (const table of ['event_participants', 'event_live_sessions', 'event_live_attendance', 'event_access_grants']) before[table] = await count(table);
    const socket = stage.sockets.at(-1), emit = socket.emit.bind(socket); let dropped = false;
    socket.emit = (name, ...args) => {
      if (name === 'events:slide:next' && !dropped) { dropped = true; const callback = args.pop(); assert.equal(typeof callback, 'function'); return emit(name, ...args, () => {}); }
      return emit(name, ...args);
    };
    const nexts = stage.commands.filter(name => name === 'events:slide:next').length;
    await stage.controller.operate('next');
    await waitUntil(() => stage.sockets.at(-1) !== socket && stage.state().status === 'live', 'read after lost ack');
    assert.equal(stage.ready().context.actorId, actor); assert.equal(stage.state().snapshot.slideIndex, 1);
    assert.equal(stage.commands.filter(name => name === 'events:slide:next').length, nexts + 1);
    assert.equal(runtime.states.get(executionKey(a, liveId)).presenterSlideIndex, 1);
    for (const table of Object.keys(before)) assert.equal(await count(table), before[table], table);
  });
  await t.test('Stage finish clears only its execution; missing private preparation rolls back a new start and revocation clears every control', async () => {
    await stage.controller.operate('finish');
    await waitUntil(() => !runtime.states.has(executionKey(a, liveId)), 'finished runtime');
    for (const record of [stage, speaker, player, attendee]) await waitUntil(() => record.state().snapshot === null, 'cleared finished projection');
    assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?', [liveId]))[0].status, 'FINISHED');
    assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?', [paidLive]))[0].status, 'LIVE');
    assert.equal(paidAttendee.state().snapshot.slideIndex, 0);
    for (const record of [stage, speaker, player, attendee]) record.access.close();
    const retry = open({ view: 'stage', issued: await grants.issue(admin, o1, a, { kind: 'STAGE', purpose: 'live', stageId }) });
    await retry.start(); await retry.controller.select(targetKey(retry.ready().targets[0]));
    // Only this finished Stage's candidate reader is unavailable; all unrelated
    // live readers stay valid during periodic authorization review.
    runtime.readPreparation = async (live, db) => live.eventId === a && live.activityId === free ? null : controlsReader(live, db);
    const before = await count('event_live_sessions', ' WHERE event_stage_id=?', [stageId]);
    try { assert.equal(await retry.controller.operate('start'), false); assert.equal(retry.state().snapshot, null); assert.equal(await count('event_live_sessions', ' WHERE event_stage_id=?', [stageId]), before); }
    finally { runtime.readPreparation = controlsReader; }
    await grants.revoke(admin, o1, a, retry.ready().context.grantId); await f.grantSockets.reviewAll();
    await waitUntil(() => retry.access.getState().status === 'denied', 'revoked controller');
    assert.equal(await retry.controller.operate('start'), false); assert.equal(retry.state().targets.length, 0);
    otherStage.access.close(); paidAttendee.access.close();
  });
}
module.exports = { consoleControlsSuite };
