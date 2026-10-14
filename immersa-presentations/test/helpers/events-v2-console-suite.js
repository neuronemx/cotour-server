const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');

async function consoleSuite(t, f) {
  const { request, sql, grants, base, a, b, o1, stageA, activityA, liveA, publicId } = f;
  const admin = f.ids.get('admin1');
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  const sessions = [];
  for (const [view, kind, purpose, scope] of [['stage', 'STAGE', 'live', { stageId: stageA }],
    ['speaker', 'SPEAKER', 'live', { activityId: activityA }], ['screen', 'PLAYER', 'player', { liveSessionId: liveA }]]) {
    const issued = await grants.issue(admin, o1, a, { kind, purpose, ...scope }); sessions.push({ view, issued });
  }
  const registered = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name: 'Console fixture' });
  assert.equal(registered.status, 201); const publicCookie = registered.headers.get('set-cookie').split(';')[0];
  sessions.push({ view: 'audience', issued: { eventId: a, grantId: registered.body.context.grantId }, cookie: publicCookie });
  const counts = async () => {
    const result = {};
    for (const table of ['event_participants', 'event_live_sessions', 'event_live_attendance', 'event_access_grants']) result[table] = (await sql('SELECT COUNT(*) n FROM ' + table))[0].n;
    return result;
  };
  const active = new Set(); t.after(() => { for (const item of active) item.client.close(); });
  function open(item, { eventId = a, view = item.view, cookie = item.cookie, token = item.issued.token } = {}) {
    const history = [], calls = [], states = [], clientSockets = [];
    const location = new URL(`${base}/events-v2/console/${view}/${eventId}/${item.issued.grantId}` + (token ? '#token=' + token : ''));
    const link = consumeLink(location, { replaceState: (...args) => history.push(args) });
    const waiting = new Set(), leases = new Map();
    function waitFor(status, next = false) {
      if (!next && client.getState().status === status) return Promise.resolve(client.getState());
      return new Promise((resolve, reject) => {
        const entry = { status, resolve, timer: setTimeout(() => { waiting.delete(entry); reject(new Error('Console status timeout: ' + status)); }, 10000) };
        waiting.add(entry);
      });
    }
    const client = createClient({ binding: link.binding, now: () => f.now().getTime(), retryDelayMs: 10, requestTimeoutMs: 8000,
      // Drive the scheduled long lease explicitly against the fixture's SQL
      // clock. HTTP/connect/ack deadlines remain real timers.
      setTimeoutFn: (callback, delay) => { if (delay < 60000) return setTimeout(callback, delay);
        const handle = {}; leases.set(handle, callback); return handle; },
      clearTimeoutFn: handle => { if (!leases.delete(handle)) clearTimeout(handle); },
      fetch: async (url, options) => {
        calls.push({ url, body: options.body });
        const result = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } });
        const setCookie = result.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
        return result;
      }, io: (namespace, options) => {
        assert.equal(namespace, '/events-v2');
        const clientSocket = io(base + namespace, { ...options, extraHeaders: { origin: base }, transports: ['websocket'] });
        clientSockets.push(clientSocket); return clientSocket;
      }, onState: state => {
        states.push(state);
        for (const entry of [...waiting]) if (entry.status === state.status) { waiting.delete(entry); clearTimeout(entry.timer); entry.resolve(state); }
      } });
    const record = { client, waitFor, calls, states, history, sockets: clientSockets, start: () => client.start(link.token), cookie: () => cookie,
      renewLease: () => { const [handle, callback] = [...leases][0]; leases.delete(handle); callback(); } };
    active.add(record); return record;
  }
  let stage;
  await t.test('real access client binds all four console functions without loading legacy state, content or attendance', async () => {
    const before = await counts(), reads = f.preparationReads(), states = f.runtime.states.size;
    const title = (await sql('SELECT title FROM event_hubs WHERE workspace_id=?', [a]))[0].title;
    for (const item of sessions) {
      const client = open(item); await client.start(); const ready = await client.waitFor('ready');
      assert.equal(ready.context.eventId, a); assert.equal(ready.context.grantId, item.issued.grantId); assert.equal(ready.eventName, title);
      assert.equal(ready.context.kind, { stage: 'STAGE', speaker: 'SPEAKER', screen: 'PLAYER', audience: 'PARTICIPANT' }[item.view]);
      assert.equal(JSON.stringify(client.history).includes(item.issued.token || 'TOKEN_NEVER_AVAILABLE'), false);
      assert.equal(JSON.stringify(client.states).includes(item.issued.token || 'TOKEN_NEVER_AVAILABLE'), false);
      const serverSocket = [...f.grantSockets.namespace.sockets.values()].find(socket => socket.id === client.sockets[0].id);
      assert.ok(serverSocket); assert.equal(f.sockets.of('/').sockets.has(serverSocket.id), false);
      assert.ok([...serverSocket.rooms].every(room => room === serverSocket.id || room.startsWith(`evt:${a}:`)));
      if (item.view === 'stage') stage = client; else client.client.close();
    }
    assert.deepEqual(await counts(), before); assert.equal(f.preparationReads(), reads); assert.equal(f.runtime.states.size, states);
  });
  await t.test('scheduled socket renewal, cookie reload and expired-short-session reconnect keep identity without registration or LiveSession', async () => {
    const before = await counts(), actor = stage.client.getState().context.actorId;
    const oldExpiry = stage.client.getState().context.sessionExpiresAt;
    const sessionCount = (await sql('SELECT COUNT(*) n FROM event_grant_sessions WHERE grant_id=?', [sessions[0].issued.grantId]))[0].n;
    f.setNow(new Date(f.now().getTime() + 14 * 60000));
    const lease = stage.waitFor('ready', true); stage.renewLease(); await lease;
    assert.equal(stage.sockets.length, 1); assert.ok(Date.parse(stage.client.getState().context.sessionExpiresAt) > Date.parse(oldExpiry));
    assert.equal((await sql('SELECT COUNT(*) n FROM event_grant_sessions WHERE grant_id=?', [sessions[0].issued.grantId]))[0].n, sessionCount);
    f.setNow(new Date(f.now().getTime() + 16 * 60000));
    await stage.client.resume(); const ready = await stage.waitFor('ready'); assert.equal(ready.context.actorId, actor);
    assert.ok(stage.calls.at(-2).url.endsWith('/renew')); assert.equal(stage.calls.filter(call => call.url.endsWith('/exchange')).length, 1);
    const item = sessions[3], reload = open(item, { token: null }); await reload.start(); const restored = await reload.waitFor('ready');
    assert.equal(restored.context.grantId, item.issued.grantId); assert.equal(restored.context.participantId, registered.body.context.participantId);
    assert.equal(reload.calls[0].body, '{}'); assert.ok(reload.calls[0].url.endsWith('/renew'));
    assert.deepEqual(await counts(), before); reload.client.close();
  });
  await t.test('wrong console function, cross-event cookie and revocation deny before event names or sockets', async () => {
    const item = sessions[0], before = await counts();
    const wrong = open(item, { view: 'speaker' }); await wrong.start(); await wrong.waitFor('denied'); assert.equal(wrong.sockets.length, 0);
    const cross = open(item, { eventId: b, token: null, cookie: stage.cookie() }); await cross.start(); await cross.waitFor('denied'); assert.equal(cross.sockets.length, 0);
    const view = `/api/events-v2/access/${a}/${item.issued.grantId}/console/speaker`;
    assert.equal((await request(null, 'GET', view, undefined, { cookie: stage.cookie() })).status, 403);
    await grants.revoke(admin, o1, a, item.issued.grantId); await f.grantSockets.reviewAll(); await stage.waitFor('denied');
    const revoked = open(item, { token: null, cookie: stage.cookie() }); await revoked.start(); await revoked.waitFor('denied');
    assert.equal(revoked.sockets.length, 0); assert.equal(JSON.stringify([...wrong.states, ...cross.states, ...revoked.states]).includes('eventName":"'), false);
    assert.deepEqual(await counts(), before);
  });
  await t.test('console metadata and page flag fail closed; SQL outage is sanitized; generic shell exposes no event identity', async () => {
    const item = sessions[1], client = open(item); await client.start(); await client.waitFor('ready'); const cookie = client.cookie(); client.client.close();
    const url = `/api/events-v2/access/${a}/${item.issued.grantId}/console/speaker`, page = `/events-v2/console/speaker/${a}/${item.issued.grantId}`;
    assert.equal((await request(null, 'GET', url + '?role=STAGE', undefined, { cookie })).status, 400);
    assert.equal((await request(null, 'GET', url, undefined, { cookie, 'sec-fetch-site': 'cross-site' })).status, 403);
    const pool = grants.pool; grants.pool = { execute: async () => { throw new Error('PRIVATE_CONSOLE_SQL_SECRET'); } };
    try { const reply = await request(null, 'GET', url, undefined, { cookie }); assert.equal(reply.status, 503); assert.deepEqual(reply.body, { code: 'AUTHORIZATION_UNAVAILABLE' }); }
    finally { grants.pool = pool; }
    f.setEnabled(false);
    try { assert.equal((await request(null, 'GET', url, undefined, { cookie })).status, 404); assert.equal((await fetch(base + page)).status, 404); }
    finally { f.setEnabled(true); }
    const shell = await fetch(base + page); assert.equal(shell.status, 200); const html = await shell.text(); assert.equal(html.includes(a), false); assert.equal(html.includes(item.issued.grantId), false);
  });
}
module.exports = { consoleSuite };
