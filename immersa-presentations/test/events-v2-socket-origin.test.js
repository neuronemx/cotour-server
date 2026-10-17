const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { createEventGrantSockets } = require('../events-v2/grant-sockets');

test('browser polling without Origin requires exact same-origin Fetch Metadata; credentials stay mandatory', async t => {
  const server = http.createServer();
  const io = new Server(server);
  const context = { eventId: 'event-a', grantId: 'grant-a', actorId: 'actor-a' };
  let authorizedReads = 0;
  const grants = { async withSession(credential, action) {
    authorizedReads++;
    if (credential?.eventId !== context.eventId || credential?.grantId !== context.grantId || credential?.sessionToken !== 'short-session') throw new Error('denied');
    return action ? action(context) : context;
  } };
  const guard = createEventGrantSockets({ io, grants, enabled: () => true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { guard.close(); await new Promise(resolve => io.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const metadata = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
  async function attempt(headers, allowed, auth = { ...context, sessionToken: 'short-session' }, transport = 'polling') {
    const before = authorizedReads;
    const client = connect(base + '/events-v2', { transports: [transport], upgrade: false, forceNew: true, reconnection: false, extraHeaders: headers, auth });
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket origin test timeout')), 3000);
        client.once('events:context', value => { clearTimeout(timer); resolve({ allowed: true, value }); });
        client.once('connect_error', error => { clearTimeout(timer); resolve({ allowed: false, error }); });
      });
      assert.equal(result.allowed, allowed, JSON.stringify(headers));
      if (allowed) assert.deepEqual(result.value, context);
      else assert.equal(result.error.message, 'EVENT_ACCESS_DENIED');
      return authorizedReads - before;
    } finally { client.close(); }
  }
  assert.ok(await attempt(metadata, true) >= 2);
  await attempt({ origin: base }, true, undefined, 'websocket');
  await attempt({ ...metadata, origin: base }, true);
  for (const headers of [
    {}, { 'sec-fetch-site': 'same-origin' }, { ...metadata, 'sec-fetch-site': 'same-site' },
    { ...metadata, 'sec-fetch-site': 'cross-site' }, { ...metadata, 'sec-fetch-site': 'none' },
    { ...metadata, 'sec-fetch-mode': 'navigate' }, { ...metadata, 'sec-fetch-dest': 'document' },
    { ...metadata, origin: 'null' }, { ...metadata, origin: 'https://attacker.test' },
    { ...metadata, origin: base, 'sec-fetch-site': 'cross-site' }
  ]) assert.equal(await attempt(headers, false), 0, 'origin denial must precede credential lookup');
  await attempt(metadata, false, { ...context, sessionToken: 'wrong-session' });
  await attempt(metadata, false, { ...context, eventId: 'event-b', sessionToken: 'short-session' });
  await attempt(metadata, false, undefined, 'websocket');
});
