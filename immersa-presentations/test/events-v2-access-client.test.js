const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { consumeLink, createClient } = require('../public/events-v2/access-client');

const eventId = '00000000-0000-4000-8000-000000000001';
const grantId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const token = 'L'.repeat(43), short = 'S'.repeat(43);
const binding = { view: 'stage', eventId, grantId };
const path = `/events-v2/console/stage/${eventId}/${grantId}`;
const context = { eventId, grantId, organizationId: otherId, actorId: grantId, kind: 'STAGE', purpose: 'live',
  stageId: otherId, activityId: null, liveSessionId: null, participantId: null, expiresAt: new Date(10000000).toISOString() };

test('Q&A transport accepts exact payloads, explicit consent and optional own name, rejecting actor overrides and retired events', async () => {
  const sent = [], events = [], h = harness({ onEvent: name => events.push(name), commandHandler: (name, payload, ack) => { sent.push({ name, payload }); ack({ ok: true }); } });
  await h.client.start(token);
  for (const [action, payload] of [['snapshot', {}], ['open', {}], ['set_open', { roundId: otherId, open: false }],
    ['submit', { roundId: otherId, question: 'Q?', allowNameOnScreen: false }], ['submit', { roundId: otherId, question: 'Q?', allowNameOnScreen: true, name: '' }],
    ...['select','project','delete'].map(action => [action, { roundId: otherId, questionId: grantId }]), ...['new_round','panel_close'].map(action => [action, { roundId: otherId }])]) assert.equal((await h.client.command('events:qna:' + action, payload)).ok, true);
  for (const extra of [{ participantId: grantId }, { name: 'x'.repeat(121) }, { question: ' ' }, { question: 'x'.repeat(1001) }, { allowNameOnScreen: 'yes' }, { roundId: 'bad' }]) await assert.rejects(h.client.command('events:qna:submit', { roundId: otherId, question: 'Q?', allowNameOnScreen: false, ...extra }), { code: 'INVALID_COMMAND' });
  const old = h.sockets[0]; old.deliver('events:qna:state', {}); h.client.close(); old.deliver('events:qna:state', {});
  assert.deepEqual(events, ['events:qna:state']); assert.equal(sent.length, 10);
});

test('poll transport admits exact canonical IDs only and fences poll events from retired sockets', async () => {
  const events = [], sent = [], h = harness({ onEvent: (name, value) => events.push({ name, value }), commandHandler: (name, payload, ack) => { sent.push({ name, payload }); ack({ ok: true, snapshot: null }); } });
  await h.client.start(token);
  for (const [name, payload] of [['launch', { interactionId: 'own' }], ['submit', { pollRunId: otherId, optionId: 'one' }], ['snapshot', {}], ['show', { pollRunId: otherId }], ['hide', { pollRunId: otherId }], ['close', { pollRunId: otherId }]]) assert.equal((await h.client.command('events:poll:' + name, payload)).ok, true);
  for (const payload of [{ interactionId: 'own', participantId: grantId }, { interactionId: '' }, { interactionId: 'x'.repeat(121) }]) await assert.rejects(h.client.command('events:poll:launch', payload), { code: 'INVALID_COMMAND' });
  await assert.rejects(h.client.command('events:poll:submit', { pollRunId: 'invalid', optionId: 'one' }), { code: 'INVALID_COMMAND' });
  const old = h.sockets[0]; old.deliver('events:poll:state', { liveSessionId: otherId }); assert.equal(events.length, 1); h.client.close(); old.deliver('events:poll:state', {}); assert.equal(events.length, 1); assert.equal(sent.length, 6);
});

function clock() {
  let time = 0, seq = 0; const timers = new Map();
  return { now: () => time, timers,
    setTimeoutFn: (callback, delay) => { const key = ++seq; timers.set(key, { callback, at: time + delay }); return key; },
    clearTimeoutFn: key => timers.delete(key),
    async tick(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
        for (let i = 0; i < 15; i++) await Promise.resolve();
      }
      time = end;
    }
  };
}
function harness({ fetchImpl, autoContext = true, renewal, commandHandler, onEvent } = {}) {
  const time = clock(), calls = [], sockets = [], states = [];
  const packet = () => ({ context, sessionToken: short, sessionExpiresAt: new Date(time.now() + 100000).toISOString() });
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const response = fetchImpl && await fetchImpl(url, options, calls.length);
    if (response) return response;
    const data = url.includes('/console/') ? { context, event: { eventId, title: '<Evento privado>' }, view: 'stage' } : packet();
    return { ok: true, status: 200, json: async () => structuredClone(data) };
  };
  class Socket extends EventEmitter {
    constructor(options) { super(); this.auth = options.auth; this.connected = false; this.renewals = 0; }
    connect() { this.connected = true; if (autoContext) this.deliver('events:context', { ...context, sessionExpiresAt: packet().sessionExpiresAt }); }
    disconnect() { this.connected = false; this.deliver('disconnect'); }
    deliver(name, payload) { super.emit(name, payload); }
    emit(name, payload, ack) {
      if (name !== 'events:session:renew' && commandHandler) return commandHandler(name, payload, ack, this);
      assert.equal(name, 'events:session:renew'); assert.deepEqual(payload, {}); this.renewals++;
      if (renewal) renewal(ack, this);
      else ack({ ok: true, context: { ...context, sessionExpiresAt: new Date(time.now() + 100000).toISOString() } });
    }
  }
  const client = createClient({ binding, fetch, io: (namespace, options) => {
    assert.equal(namespace, '/events-v2'); assert.equal(options.reconnection, false); assert.equal(options.autoConnect, false);
    assert.equal(options.forceNew, true); assert.deepEqual(Object.keys(options.auth).sort(), ['eventId', 'grantId', 'sessionToken']);
    const socket = new Socket(options); sockets.push(socket); return socket;
  }, ...time, onState: state => states.push(state), onEvent, retryDelayMs: 1000 });
  return { client, calls, sockets, states, time, packet };
}

test('fragment is erased before validation; ambiguous, query and insecure links never enter exchange', () => {
  for (const suffix of [`#token=${token}`, '#token=bad', `#token=${token}&token=${token}`, `#role=STAGE`, `?token=${token}`]) {
    const location = new URL('https://show.example' + path + suffix), history = [];
    const clean = { replaceState: (...args) => history.push(args) };
    if (suffix === `#token=${token}`) {
      const link = consumeLink(location, clean); assert.deepEqual(link.binding, binding); assert.equal(link.token, token);
    } else assert.throws(() => consumeLink(location, clean));
    assert.deepEqual(history, [[null, '', path]]); assert.equal(JSON.stringify(history).includes(token), false);
  }
  assert.throws(() => consumeLink(new URL('http://show.example' + path), { replaceState() {} }));
  assert.equal(consumeLink(new URL('https://show.example' + path), { replaceState() {} }).token, null);
});

test('only server context makes access ready; socket carries a short credential and state exposes no secrets', async () => {
  const h = harness({ autoContext: false }); await h.client.start(token);
  assert.equal(h.client.getState().status, 'connecting'); assert.equal(h.client.getState().context, null);
  assert.equal(h.sockets[0].auth.sessionToken, short);
  h.sockets[0].deliver('events:context', { ...context, sessionExpiresAt: h.packet().sessionExpiresAt });
  assert.equal(h.client.getState().status, 'ready'); assert.equal(h.client.getState().eventName, '<Evento privado>');
  for (const call of h.calls) {
    assert.equal(call.options.credentials, 'same-origin'); assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(call.options.cache, 'no-store'); assert.equal(call.url.includes(token), false);
  }
  assert.equal(JSON.stringify(h.states).includes(token), false); assert.equal(JSON.stringify(h.states).includes(short), false);
  h.client.close(); assert.deepEqual(h.sockets[0].auth, {}); assert.equal(h.time.timers.size, 0);
});

test('reload and reconnect renew the cookie-bound grant without replaying the link secret or changing identity', async () => {
  const h = harness(); await h.client.start(); assert.ok(h.calls[0].url.endsWith('/renew'));
  const old = h.sockets[0]; old.deliver('disconnect');
  assert.equal(h.client.getState().context, null); assert.equal(h.client.getState().eventName, null);
  await h.time.tick(1000); assert.equal(h.sockets.length, 2); assert.equal(h.client.getState().status, 'ready');
  assert.equal(h.client.getState().context.actorId, grantId); assert.deepEqual(old.auth, {});
  assert.equal(h.calls.filter(call => call.url.endsWith('/exchange')).length, 0);
  h.client.close();
});

test('short sessions renew on the same connection; link expiry remains server-controlled', async () => {
  const h = harness(); await h.client.start(token); const socket = h.sockets[0];
  await h.time.tick(50000); assert.equal(socket.renewals, 1); assert.equal(h.sockets.length, 1);
  await h.time.tick(50000); assert.equal(socket.renewals, 2); assert.equal(h.sockets.length, 1);
  assert.equal(h.client.getState().context.expiresAt, context.expiresAt);
  assert.equal(h.calls.filter(call => call.url.endsWith('/exchange')).length, 1);
  h.client.close(); assert.equal(h.time.timers.size, 0);
});

test('close during HTTP ignores late success and cannot expose context or create a socket', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const h = harness({ fetchImpl: async () => waiting });
  const started = h.client.start(token); h.client.close();
  release({ ok: true, status: 200, json: async () => h.packet() }); await started;
  assert.equal(h.client.getState().status, 'closed'); assert.equal(h.sockets.length, 0); assert.equal(h.calls.length, 1);
  assert.equal(h.time.timers.size, 0); assert.equal(h.states.some(state => state.context), false);
});

test('a transient initial exchange retries only in memory; success discards the long credential before reconnect', async () => {
  const h = harness({ fetchImpl: async (_url, _options, call) => call === 1 ? { ok: false, status: 503 } : undefined });
  await h.client.start(token); assert.equal(h.client.getState().status, 'retrying'); assert.equal(h.sockets.length, 0);
  await h.time.tick(1000); assert.equal(h.client.getState().status, 'ready');
  assert.deepEqual(h.calls.slice(0, 2).map(call => call.url), ['/api/events-v2/access/exchange', '/api/events-v2/access/exchange']);
  h.sockets[0].deliver('disconnect'); await h.time.tick(1000);
  assert.equal(h.calls[3].url.endsWith('/renew'), true); assert.equal(h.calls[3].options.body, '{}');
  h.client.close();
});

test('wrong event, grant, function or metadata cannot create a socket or reveal an event name', async () => {
  for (const change of [{ eventId: otherId }, { grantId: otherId }, { kind: 'PLAYER', purpose: 'player' }]) {
    const h = harness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...h.packet(), context: { ...context, ...change } }) }) });
    await h.client.start(token); assert.equal(h.client.getState().status, 'denied'); assert.equal(h.sockets.length, 0); assert.equal(h.calls.length, 1);
    h.client.close();
  }
  const h = harness({ fetchImpl: async url => url.includes('/console/') ? { ok: true, status: 200,
    json: async () => ({ context, view: 'stage', event: { eventId: otherId, title: 'FOREIGN_PRIVATE_NAME' } }) } : undefined });
  await h.client.start(token); assert.equal(h.client.getState().status, 'denied'); assert.equal(h.sockets.length, 0);
  assert.equal(JSON.stringify(h.states).includes('FOREIGN_PRIVATE_NAME'), false);
});

test('authorization failure is terminal; availability retry hides context and never reconnects through legacy', async () => {
  let blocked = false;
  const h = harness({ fetchImpl: async () => blocked ? { ok: false, status: 401 } : undefined });
  await h.client.start(token); blocked = true; h.sockets[0].deliver('events:access_denied');
  assert.equal(h.client.getState().context, null); await h.time.tick(1000);
  assert.equal(h.client.getState().status, 'denied'); const calls = h.calls.length;
  await h.client.resume(); await h.time.tick(100000); assert.equal(h.calls.length, calls); assert.equal(h.sockets.length, 1);
  assert.equal(h.time.timers.size, 0);
});

test('late renewal or stale socket context cannot revive a closed client or replace its fixed scope', async () => {
  let acknowledge; const h = harness({ renewal: ack => { acknowledge = ack; } });
  await h.client.start(token); await h.time.tick(50000); h.client.close();
  acknowledge({ ok: true, context: { ...context, sessionExpiresAt: h.packet().sessionExpiresAt } });
  assert.equal(h.client.getState().status, 'closed'); assert.equal(h.time.timers.size, 0);
  const next = harness(); await next.client.start(token); next.sockets[0].deliver('events:context', { ...context, stageId: eventId });
  assert.equal(next.client.getState().status, 'denied'); assert.equal(next.client.getState().context, null);
});

test('closing an unavailable initial exchange cancels retries and drops its in-memory bootstrap secret', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await h.client.start(token); h.client.close(); const calls = h.calls.length;
  await h.time.tick(100000); await h.client.resume();
  assert.equal(h.calls.length, calls); assert.equal(h.time.timers.size, 0); assert.equal(h.sockets.length, 0);
});

test('commands use only the Events allowlist and exact payload; closed connections cancel pending acks', async () => {
  let acknowledge; const sent = [];
  const h = harness({ commandHandler: (name, payload, ack) => { sent.push({ name, payload }); acknowledge = ack; } });
  await assert.rejects(h.client.command('events:slide:next'), { code: 'COMMAND_NOT_READY' });
  await h.client.start(token);
  await assert.rejects(h.client.command('slide_next'), { code: 'COMMAND_NOT_ENABLED' });
  await assert.rejects(h.client.command('events:slide:next', { role: 'STAGE' }), { code: 'INVALID_COMMAND' });
  const payload = { slideIndex: 1 }, result = h.client.command('events:slide:go', payload); payload.slideIndex = 99;
  assert.deepEqual(sent, [{ name: 'events:slide:go', payload: { slideIndex: 1 } }]);
  h.client.close(); await assert.rejects(result, { code: 'COMMAND_INTERRUPTED' });
  acknowledge({ ok: true, snapshot: { PRIVATE_STALE: true } }); assert.equal(h.client.getState().status, 'closed'); assert.equal(h.time.timers.size, 0);
});

test('lost command ack recovers a fresh connection without replaying the mutation', async () => {
  const sent = []; let acknowledge;
  const h = harness({ commandHandler: (name, payload, ack) => { sent.push(name); acknowledge = ack; } });
  await h.client.start(token); const failed = assert.rejects(h.client.command('events:slide:next'), { code: 'COMMAND_ACK_TIMEOUT' });
  await h.time.tick(10000); await failed; assert.equal(h.client.getState().status, 'retrying');
  await h.time.tick(1000); assert.equal(h.client.getState().status, 'ready'); assert.equal(h.sockets.length, 2);
  acknowledge({ ok: true }); assert.deepEqual(sent, ['events:slide:next']); assert.equal(h.client.getState().status, 'ready'); h.client.close();
});

test('foreign activity metadata is rejected before socket creation or event callbacks', async () => {
  const h = harness({ fetchImpl: async url => url.includes('/console/') ? { ok: true, status: 200, json: async () => ({
    context, view: 'stage', event: { eventId, title: 'Own' }, targets: [{ eventId: otherId, activityId: otherId,
      stageId: otherId, liveSessionId: null, title: 'FOREIGN_ACTIVITY', stageTitle: 'Other', accessLevel: 'FREE', status: 'SCHEDULED', canStart: true }]
  }) } : undefined });
  await h.client.start(token); assert.equal(h.client.getState().status, 'denied'); assert.equal(h.sockets.length, 0);
  assert.equal(JSON.stringify(h.states).includes('FOREIGN_ACTIVITY'), false);
});

test('stale socket state cannot reach a controller after reconnect or close', async () => {
  const delivered = []; const h = harness({ onEvent: (name, value) => delivered.push({ name, value }) });
  await h.client.start(token); const old = h.sockets[0]; old.deliver('events:live:state', { revision: 1 });
  old.deliver('disconnect'); await h.time.tick(1000); old.deliver('events:live:state', { revision: 999 });
  h.client.close(); h.sockets[1].deliver('events:live:state', { revision: 999 });
  assert.deepEqual(delivered, [{ name: 'events:live:state', value: { revision: 1 } }]);
});
