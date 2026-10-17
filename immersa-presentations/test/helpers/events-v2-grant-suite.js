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
  function socket(auth, errorExpected = false, options = {}) {
    return new Promise((resolve, reject) => {
      const client = clientSocket(base + '/events-v2', { auth, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false, ...options });
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

  await t.test('same-origin browser polling without Origin authorizes the real SQL session and reconnects to the same actor', async () => {
    const options = { transports: ['polling'], upgrade: false, extraHeaders: {
      'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty'
    } };
    const before = (await sql('SELECT COUNT(*) n FROM event_participants'))[0].n;
    for (let i = 0; i < 2; i++) {
      const connected = await socket(auth(session), false, options);
      assert.equal(connected.context.actorId, grant.grantId);
      assert.equal(connected.context.eventId, a);
      connected.client.close();
    }
    await socket({ ...auth(session), eventId: b }, true, options);
    await socket(auth(session), true, { ...options, extraHeaders: {} });
    await socket(auth(session), true, { ...options, extraHeaders: { ...options.extraHeaders, 'sec-fetch-site': 'same-site' } });
    assert.equal((await sql('SELECT COUNT(*) n FROM event_participants'))[0].n, before);
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

  await t.test('emergency access changes require current Event Admin, strict origin and exact input; denials leave credentials untouched', async () => {
    // Earlier revocation coverage deliberately removed this event membership.
    // Restore an explicit Producer so the 403 exercises capability denial.
    assert.equal((await request('admin1', 'PUT', `${adminPath}/members/${ids.get('dual')}`, { roles: ['PRODUCER'] })).status, 200);
    const state = async () => ({
      event: await sql('SELECT enabled, authz_version FROM event_v2_contexts WHERE event_id=?', [a]),
      grants: await sql('SELECT id, revoked_at, authz_version FROM event_access_grants WHERE event_id=? ORDER BY id', [a]),
      sessions: await sql('SELECT s.* FROM event_grant_sessions s JOIN event_access_grants g ON g.id=s.grant_id WHERE g.event_id=? ORDER BY s.token_hash', [a])
    });
    const before = await state(), endpoint = adminPath + '/access-state';
    for (const [actor, path, body, headers, expected] of [
      [null, endpoint, { enabled: false }, {}, 401],
      ['platform', endpoint, { enabled: false }, {}, 404],
      ['dual', endpoint, { enabled: false }, {}, 403],
      ['admin2', endpoint, { enabled: false }, {}, 404],
      ['admin1', endpoint.replace('/events/' + a, '/events/' + b).replace(o1, f.o2), { enabled: false }, {}, 404],
      ['admin1', endpoint, { enabled: false }, { origin: 'https://attacker.test' }, 403],
      ['admin1', endpoint, { enabled: false }, { origin: '' }, 403],
      ['admin1', endpoint, { enabled: 'false' }, {}, 400],
      ['admin1', endpoint, { enabled: false, eventId: b }, {}, 400],
      ['admin1', endpoint + '?eventId=' + b, { enabled: false }, {}, 400],
      ['admin1', endpoint, {}, {}, 400]
    ]) assert.equal((await request(actor, 'PUT', path, body, headers)).status, expected, actor + ' ' + path);
    assert.deepEqual(await state(), before);
  });

  await t.test('failed emergency suspension rolls back event, grants and sessions and does not disconnect valid sockets', async () => {
    const g = (await issue()).body, session = (await exchange(g.token)).body;
    const connected = await socket(auth(session)), audit = domain.audit;
    domain.audit = async function(db, actor, action, ...rest) {
      if (action === 'event.access.suspend') throw new Error('TEST_SUSPENSION_AUDIT_FAILURE');
      return audit.call(this, db, actor, action, ...rest);
    };
    try { assert.equal((await request('admin1', 'PUT', adminPath + '/access-state', { enabled: false })).status, 503); }
    finally { domain.audit = audit; }
    assert.equal((await sql('SELECT enabled FROM event_v2_contexts WHERE event_id=?', [a]))[0].enabled, 1);
    assert.equal((await sql('SELECT revoked_at FROM event_access_grants WHERE id=?', [g.grantId]))[0].revoked_at, null);
    assert.equal((await exchange(g.token)).status, 200);
    assert.equal((await ack(connected.client, 'events:context:get')).ok, true);
    connected.client.close();
  });

  await t.test('persistent emergency suspension revokes every actor and short session only in its event; resume and restart cannot revive old credentials', async () => {
    const issued = [];
    for (const [kind, scope, purpose] of [['STAGE', { stageId: stageA }, 'live'], ['SPEAKER', { activityId: activityA }, 'live'],
      ['PLAYER', { liveSessionId: liveA }, 'player'], ['VENUE', {}, 'live'], ['MODERATOR', {}, 'live']]) {
      const response = await issue(kind, scope, 'admin1', purpose); assert.equal(response.status, 201); issued.push(response.body);
    }
    const registration = await request(null, 'POST', '/api/events-v2/public/' + publicId + '/participants', { name: 'Emergency fixture' });
    assert.equal(registration.status, 201);
    const oldSessions = [registration.body];
    for (const g of issued) { const response = await exchange(g.token); assert.equal(response.status, 200); oldSessions.push(response.body); }
    const oldSession = (await exchange(issued[0].token)).body, connected = await socket(auth(oldSession));
    const bPath = `/api/events-v2/organizations/${o1}/events/${b}`;
    assert.equal((await request('admin1', 'PUT', bPath + '/operational-window', { endsAt: new Date(f.now().getTime() + 86400000).toISOString() })).status, 200);
    const other = await request('admin1', 'POST', bPath + '/grants', { kind: 'STAGE', purpose: 'live', stageId: stageB }); assert.equal(other.status, 201);
    const otherSession = await request(null, 'POST', access + '/exchange', { eventId: b, token: other.body.token }); assert.equal(otherSession.status, 200);
    const otherConnected = await socket(auth(otherSession.body));
    const disconnectedA = disconnected(connected.client);
    assert.deepEqual((await request('admin1', 'PUT', adminPath + '/access-state', { enabled: false })).body, { eventId: a, enabled: false });
    await disconnectedA;
    assert.equal((await sql('SELECT COUNT(*) n FROM event_access_grants WHERE event_id=? AND revoked_at IS NULL', [a]))[0].n, 0);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_grant_sessions s JOIN event_access_grants g ON g.id=s.grant_id WHERE g.event_id=?', [a]))[0].n, 0);
    assert.equal((await issue()).status, 404);
    assert.notEqual((await request(null, 'POST', '/api/events-v2/public/' + publicId + '/participants', { name: 'Denied' })).status, 201);
    assert.equal((await ack(otherConnected.client, 'events:context:get')).ok, true);
    assert.equal((await request('dual', 'PUT', adminPath + '/access-state', { enabled: true })).status, 403);
    assert.equal((await request('admin1', 'PUT', adminPath + '/access-state', { enabled: true })).status, 200);
    const reconstructed = new EventGrantRepository(domain, { now: f.now });
    for (const g of issued) { assert.equal((await exchange(g.token)).status, 401); await assert.rejects(reconstructed.exchange(a, g.token), { statusCode: 401 }); }
    await assert.rejects(reconstructed.withSession(auth(oldSession)), { statusCode: 401 });
    let callbacks = 0;
    for (const session of oldSessions) await assert.rejects(reconstructed.withSession(auth(session), () => { callbacks++; }), { statusCode: 401 });
    await assert.rejects(reconstructed.withBrowser({ eventId: a, grantId: issued[0].grantId, token: issued[0].token }, () => { callbacks++; }), { statusCode: 401 });
    assert.equal(callbacks, 0, 'revoked credentials never reach a read or mutation callback');
    await socket(auth(oldSession), true);
    const participant = registration.body.context;
    const participantCookie = registration.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(null, 'GET', `${access}/${a}/${participant.grantId}/context`, undefined, { cookie: participantCookie })).status, 401);
    f.setEnabled(false); await grantSockets.reviewAll(); f.setEnabled(true);
    assert.equal((await exchange(issued[0].token)).status, 401);
    assert.equal((await request(null, 'POST', access + '/exchange', { eventId: b, token: other.body.token })).status, 200);
    const fresh = (await issue()).body; assert.equal((await exchange(fresh.token)).status, 200);
    assert.equal((await sql("SELECT COUNT(*) n FROM event_security_audit WHERE event_id=? AND action='event.access.suspend' AND outcome='ALLOWED'", [a]))[0].n, 1);
    otherConnected.client.close();
  });

  await t.test('concurrent grant issuance and emergency suspension serialize: no credential remains usable after suspension commits', async () => {
    const [issued, suspended] = await Promise.all([issue(), request('admin1', 'PUT', adminPath + '/access-state', { enabled: false })]);
    assert.equal(suspended.status, 200);
    assert.ok([201, 404].includes(issued.status));
    if (issued.status === 201) assert.equal((await exchange(issued.body.token)).status, 401);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_access_grants WHERE event_id=? AND revoked_at IS NULL', [a]))[0].n, 0);
    assert.equal((await request('admin1', 'PUT', adminPath + '/access-state', { enabled: true })).status, 200);
    if (issued.status === 201) assert.equal((await exchange(issued.body.token)).status, 401);
  });
}
module.exports = { grantSuite };
