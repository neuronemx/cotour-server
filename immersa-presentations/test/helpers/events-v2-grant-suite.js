const assert = require('node:assert/strict');
const { io: clientSocket } = require('socket.io-client');
const { EventGrantRepository, hash } = require('../../events-v2/grant-repository');
const { runMigrations } = require('../../db/migrate');

async function grantSuite(t, f) {
  const { request, sql, grants, domain, grantSockets, sockets, base, ids, o1, a, b, stageA, stageB, activityA, activityB, liveA, publicId } = f;
  const adminPath = `/api/events-v2/organizations/${o1}/events/${a}`;
  const access = '/api/events-v2/access';
  const activeClients = new Set();
  t.after(() => { for (const client of activeClients) client.close(); });
  const issue = (kind = 'STAGE', fields = { stageId: stageA }, actor = 'admin1', purpose = 'live') =>
    request(actor, 'POST', adminPath + '/grants', { kind, purpose, ...fields });
  const exchange = token => request(null, 'POST', access + '/exchange', { eventId: a, token });
  const window = async date => { assert.equal((await request('admin1', 'PUT', adminPath + '/operational-window', { endsAt: date.toISOString() })).status, 200); };
  function socket(auth, errorExpected = false) {
    return new Promise((resolve, reject) => {
      const client = clientSocket(base + '/events-v2', { auth, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false });
      activeClients.add(client);
      const timer = setTimeout(() => { client.close(); reject(new Error('grant socket timeout')); }, 3000);
      client.once('connect_error', () => { clearTimeout(timer); client.close(); errorExpected ? resolve(client) : reject(new Error('unexpected denial')); });
      client.once('events:context', context => { clearTimeout(timer); errorExpected ? reject(new Error('unauthorized snapshot')) : resolve({ client, context }); });
    });
  }
  const auth = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  const disconnected = client => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('revocation did not disconnect idle socket')), 1500);
    client.once('disconnect', () => { clearTimeout(timer); resolve(); });
  });
  const ack = (client, name, payload = {}) => new Promise(resolve => client.emit(name, payload, resolve));
  await request('admin1', 'PUT', `${adminPath}/members/${ids.get('producer')}`, { roles: ['PRODUCER'] });
  let grant, session, cookie;

  await t.test('grants require event end; role/resource/body scope is validated before insert', async () => {
    // Recovery with some 038 tables present and its session table still absent.
    await sql('DROP TABLE event_grant_sessions');
    await sql("DELETE FROM schema_migrations WHERE id = '038_event_access_grants.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['038_event_access_grants.sql']);
    assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    assert.equal((await issue()).status, 409);
    assert.equal((await request('admin1', 'PUT', adminPath + '/operational-window', { endsAt: '2026-10-12T12:00:00' })).status, 400);
    await window(new Date(f.now().getTime() + 12 * 24 * 3600 * 1000));
    const before = (await sql('SELECT COUNT(*) n FROM event_access_grants'))[0].n;
    assert.equal((await issue('STAGE', { stageId: stageB })).status, 404);
    assert.equal((await issue('SPEAKER', { activityId: activityB })).status, 404);
    assert.equal((await issue('STAGE', { stageId: stageA }, 'producer')).status, 403);
    assert.equal((await issue('ADMIN', {})).status, 400);
    assert.equal((await issue('VENUE', { stageId: stageA })).status, 400);
    assert.equal((await issue('STAGE', { stageId: stageA, eventId: b })).status, 400);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_access_grants'))[0].n, before);
    const speaker = await issue('SPEAKER', { activityId: activityA }, 'producer', 'rehearsal');
    assert.equal(speaker.status, 201);
    assert.equal(speaker.body.purpose, 'rehearsal');
    grant = (await issue()).body;
    assert.ok(new Date(grant.expiresAt).getTime() - f.now().getTime() > 11 * 24 * 3600 * 1000, 'no 12h cap');
    const persisted = (await sql('SELECT * FROM event_access_grants WHERE id = ?', [grant.grantId]))[0];
    assert.equal(persisted.token_hash, hash(grant.token));
    assert.ok(!JSON.stringify(persisted).includes(grant.token));
    assert.equal((await issue('PLAYER', { liveSessionId: liveA }, 'admin1', 'player')).status, 201);
    for (const kind of ['VENUE', 'MODERATOR']) assert.equal((await issue(kind, {})).status, 201);
  });

  await t.test('HTTP exchange protects origins and cookies; socket uses short identity from DB', async () => {
    assert.equal((await exchange('bad')).status, 401);
    assert.equal((await request(null, 'POST', access + '/exchange', { eventId: b, token: grant.token })).status, 401);
    assert.equal((await request(null, 'POST', access + '/exchange', { eventId: a, token: grant.token }, { origin: 'https://attacker.test' })).status, 403);
    const response = await exchange(grant.token);
    assert.equal(response.status, 200);
    session = response.body;
    assert.ok(new Date(session.sessionExpiresAt).getTime() - f.now().getTime() <= 15 * 60 * 1000);
    const setCookie = response.headers.get('set-cookie');
    for (const attr of ['__Host-', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(attr), attr);
    assert.ok(!setCookie.includes('Domain='));
    assert.ok(new Date(setCookie.match(/Expires=([^;]+)/)[1]) > new Date(grant.expiresAt), 'cookie retention does not cap an extended event');
    cookie = setCookie.split(';')[0];
    assert.equal((await request(null, 'GET', `${access}/${a}/${grant.grantId}/context`, undefined, { cookie })).status, 200);
    assert.notEqual((await request(null, 'GET', `${access}/${b}/${grant.grantId}/context`, undefined, { cookie })).status, 200);
    await socket({ eventId: a, grantId: grant.grantId, sessionToken: grant.token }, true);
    await socket({ ...auth(session), eventId: b }, true);
    const connected = await socket({ ...auth(session), role: 'ADMIN', participantId: 'foreign', rooms: ['B'] });
    assert.equal(connected.context.kind, 'STAGE');
    assert.equal(connected.context.eventId, a);
    const result = await ack(connected.client, 'events:context:get');
    assert.equal(result.context.actorId, grant.grantId);
    assert.ok(!JSON.stringify(result).includes(grant.token));
    const serverSocket = [...grantSockets.namespace.sockets.values()].find(s => s.id === connected.client.id);
    assert.deepEqual([...serverSocket.rooms].sort(), [serverSocket.id, `evt:${a}:actor:${grant.grantId}`].sort());
    assert.equal([...sockets.of('/').sockets.values()].some(s => s.id === serverSocket.id), false);
    const denied = new Promise(resolve => connected.client.once('events:command_denied', resolve));
    connected.client.emit('slide_next', { eventId: b });
    assert.equal((await denied).code, 'COMMAND_NOT_ENABLED');
    const disconnect = disconnected(connected.client);
    assert.equal((await ack(connected.client, 'events:context:get', { eventId: b })).ok, false);
    await disconnect;
  });

  await t.test('reconnect and browser renewal preserve actor and expiry; no extra participant or live state', async () => {
    const before = (await sql('SELECT COUNT(*) n FROM event_participants'))[0].n;
    for (let i = 0; i < 2; i++) {
      const connection = await socket(auth(session));
      assert.equal(connection.context.actorId, grant.grantId);
      assert.equal(connection.context.expiresAt, grant.expiresAt);
      connection.client.close();
    }
    assert.equal((await sql('SELECT COUNT(*) n FROM event_participants'))[0].n, before);
    f.setNow(new Date(f.now().getTime() + 16 * 60 * 1000));
    await socket(auth(session), true);
    // Sleep past short credential TTL still renews via the valid HttpOnly cookie.
    const renewal = await request(null, 'POST', `${access}/${a}/${grant.grantId}/renew`, {}, { cookie });
    assert.equal(renewal.status, 200);
    assert.equal(renewal.body.context.actorId, grant.grantId);
    assert.equal(renewal.body.context.expiresAt, grant.expiresAt);
    session = renewal.body;
    const renewed = await socket(auth(session));
    assert.equal((await ack(renewed.client, 'events:session:renew')).ok, true);
    renewed.client.close();
    const newEnd = new Date(f.now().getTime() + 30 * 86400000);
    await window(newEnd);
    // The original cookie works even with an updated event end; it is neither
    // a new actor nor a client-chosen grant extension.
    const extended = await request(null, 'POST', `${access}/${a}/${grant.grantId}/renew`, {}, { cookie });
    assert.equal(extended.status, 200);
    assert.equal(extended.body.context.expiresAt, newEnd.toISOString());
    assert.equal(extended.body.context.actorId, grant.grantId);
    session = extended.body;
  });

  await t.test('revocation disconnects active socket immediately and survives process reconstruction', async () => {
    const connection = await socket(auth(session)), disconnect = disconnected(connection.client);
    assert.equal((await request('admin1', 'DELETE', `${adminPath}/grants/${grant.grantId}`)).status, 200);
    await disconnect;
    assert.equal((await request('admin1', 'DELETE', `${adminPath}/grants/${grant.grantId}`)).status, 200);
    assert.equal((await exchange(grant.token)).status, 401);
    await socket(auth(session), true);
    const restarted = new EventGrantRepository(domain, { now: f.now });
    await assert.rejects(restarted.withSession(auth(session)));
    const revokedAt = (await sql('SELECT revoked_at FROM event_access_grants WHERE id = ?', [grant.grantId]))[0].revoked_at;
    await window(new Date(f.now().getTime() + 20 * 24 * 3600 * 1000));
    assert.equal((await sql('SELECT revoked_at FROM event_access_grants WHERE id = ?', [grant.grantId]))[0].revoked_at.getTime(), revokedAt.getTime());
    assert.equal((await exchange(grant.token)).status, 401);
  });

  await t.test('issuer loses permission: derived grant stops on command and idle connection; no restoration revival', async () => {
    const g = (await issue('SPEAKER', { activityId: activityA }, 'producer')).body;
    const s = (await exchange(g.token)).body, connection = await socket(auth(s));
    const disconnect = disconnected(connection.client);
    await request('admin1', 'DELETE', `${adminPath}/members/${ids.get('producer')}`);
    await disconnect;
    assert.notEqual((await exchange(g.token)).status, 200);
    await request('admin1', 'PUT', `${adminPath}/members/${ids.get('producer')}`, { roles: ['PRODUCER'] });
    assert.equal((await exchange(g.token)).status, 401);
    const active = (await issue('SPEAKER', { activityId: activityA }, 'producer')).body;
    const activeSession = (await exchange(active.token)).body;
    await request('admin1', 'DELETE', `/api/events-v2/organizations/${o1}/members/${ids.get('producer')}`);
    await assert.rejects(grants.withSession(auth(activeSession)));
  });

  await t.test('Público identity and level derive from QR; reconnect never registers or attends twice', async () => {
    const publicPath = `/api/events-v2/public/${publicId}/participants`;
    assert.equal((await request(null, 'POST', publicPath, { name: 'Attendee', participantId: 'foreign', audienceLevel: 'PAID' })).status, 400);
    const before = (await sql('SELECT COUNT(*) n FROM event_participants'))[0].n;
    const registered = await request(null, 'POST', publicPath, { name: 'Attendee' });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.context.kind, 'PARTICIPANT');
    assert.equal(registered.body.context.audienceLevel, 'FREE');
    assert.equal(registered.body.token, undefined);
    assert.equal(registered.body.context.participantId, registered.body.context.actorId);
    for (let i = 0; i < 2; i++) {
      const client = await socket({ ...auth(registered.body), participantId: 'foreign', audienceLevel: 'PAID' });
      assert.equal(client.context.participantId, registered.body.context.participantId);
      assert.equal(client.context.audienceLevel, 'FREE');
      client.client.close();
    }
    assert.equal((await sql('SELECT COUNT(*) n FROM event_participants'))[0].n, before + 1);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_live_attendance'))[0].n, 0);
  });

  await t.test('idle expiry, not-before, scope tampering and event-end changes deny rather than revive', async () => {
    const g = (await issue()).body;
    await sql('UPDATE event_access_grants SET not_before = ? WHERE id = ?', [new Date(f.now().getTime() + 1000), g.grantId]);
    assert.equal((await exchange(g.token)).status, 401);
    await sql('UPDATE event_access_grants SET not_before = ?, stage_id = ? WHERE id = ?', [f.now(), stageB, g.grantId]);
    assert.notEqual((await exchange(g.token)).status, 200);
    await sql('UPDATE event_access_grants SET stage_id = ? WHERE id = ?', [stageA, g.grantId]);
    const s = (await exchange(g.token)).body, connected = await socket(auth(s));
    const disconnect = disconnected(connected.client);
    f.setNow(new Date(f.now().getTime() + 16 * 60 * 1000));
    await disconnect; // session TTL, without a client command
    const shortEnd = new Date(f.now().getTime() + 10000);
    await window(shortEnd);
    const refreshed = (await exchange(g.token)).body;
    const active = await socket(auth(refreshed)), endDisconnect = disconnected(active.client);
    f.setNow(new Date(shortEnd.getTime() + 1));
    await endDisconnect;
    assert.equal((await exchange(g.token)).status, 401);
    await window(new Date(f.now().getTime() + 86400000));
    assert.equal((await exchange(g.token)).status, 401, 'expired link never revived');
  });

  await t.test('database outage and kill switch fail closed before rooms, reads or snapshots', async () => {
    const g = (await issue()).body, s = (await exchange(g.token)).body;
    const connection = await socket(auth(s)), disconnect = disconnected(connection.client);
    const pool = grants.pool;
    grants.pool = { execute: async () => { throw Object.assign(new Error('unavailable'), { code: 'TEST_UNAVAILABLE' }); } };
    try {
      await grantSockets.reviewAll();
      await disconnect;
      assert.equal((await exchange(g.token)).status, 503);
      await socket(auth(s), true);
    } finally { grants.pool = pool; }
    const next = await socket(auth(s)), killed = disconnected(next.client);
    f.setEnabled(false);
    await grantSockets.reviewAll(); await killed;
    assert.equal((await exchange(g.token)).status, 404);
    await socket(auth(s), true);
    f.setEnabled(true);
    assert.equal(grantSockets.namespace.sockets.size, 0);
  });
}
module.exports = { grantSuite };
