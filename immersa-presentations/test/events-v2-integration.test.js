const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const { io: clientSocket } = require('socket.io-client');
const { createMysqlPool } = require('../db/mysql');
const { runMigrations } = require('../db/migrate');
const { createBetterAuthCompatibilityBridge } = require('../auth/better-auth-bridge');
const { EventDomainRepository } = require('../events-v2/domain-repository');
const { createEventDomainRouter } = require('../events-v2/http-router');
const { LegacyEventBoundary } = require('../events-v2/legacy-boundary');
const { EventHubRepository } = require('../event-hub/repository');
const { EventHubAdminInteractions } = require('../event-hub/admin-interactions');

const databaseUrl = process.env.IMMERSA_EVENTS_V2_TEST_DATABASE_URL;

test('Events v2: real Better Auth, SQL, HTTP and Socket.IO isolation', { skip: !databaseUrl, timeout: 120000 }, async t => {
  // Dedicated, disposable CI database only. Never default to the runtime DB.
  const parsedUrl = new URL(databaseUrl);
  assert.match(parsedUrl.pathname, /events_v2_test/, 'requires an explicitly named test database');
  const pool = createMysqlPool({ env: { IMMERSA_MYSQL_URL: databaseUrl } });
  const app = express();
  const server = http.createServer(app);
  const sockets = new Server(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: 'events-v2-isolated-ci-secret-12345678901234567890', IMMERSA_AUTH_ENABLED: 'true' };
  const bridge = createBetterAuthCompatibilityBridge({ env, enabled: true, unverifiedCleanupEnabled: false,
    databaseFactory: () => pool, emailSenderFactory: () => null });
  t.after(async () => { await new Promise(resolve => sockets.close(resolve)); await bridge.close(); });
  const migration = await runMigrations(pool);
  assert.ok(migration.executed.includes('037_event_organization_memberships.sql'));
  const { runAuthMigration } = await import('../auth/migrate-auth-v1.mjs');
  await runAuthMigration({ env, database: pool });
  const domain = new EventDomainRepository(pool);
  const boundary = new LegacyEventBoundary(pool);
  const legacy = new EventHubRepository(pool);
  const interactions = new EventHubAdminInteractions({ io: sockets, repository: legacy });
  let domainEnabled = true;
  let createdRuntimeStates = 0;
  app.all('/api/auth/*', bridge.handler);
  app.use(express.json());
  app.use(boundary.httpMiddleware());
  const platformGuard = (req, res, next) => req.accountContext?.user?.email === 'platform@events-v2.test'
    ? next() : res.status(403).json({ code: 'PLATFORM_PERMISSION_DENIED' });
  const router = createEventDomainRouter({ repository: domain, requireAccount: bridge.requireApiAuth(), requirePlatformAdmin: platformGuard, enabled: true });
  app.use('/api/events-v2', (req, res, next) => domainEnabled ? next() : res.status(404).json({ code: 'EVENTS_V2_DISABLED' }), router);
  app.get('/api/admin/event-hubs', async (_req, res) => res.json({ hubs: await legacy.listHubs() }));
  app.use((_req, res) => res.status(200).json({ legacy: true }));
  sockets.on('connection', socket => {
    interactions.attach(socket);
    socket.on('join_presentation', async payload => {
      if (!(await boundary.allowPresentationJoin(socket, payload.session, payload.deck))) return;
      createdRuntimeStates++;
      socket.join('legacy-runtime');
      socket.emit('presentation_state', { legacy: true });
    });
  });
  const cookies = new Map();
  const ids = new Map();
  async function request(actor, method, path, body, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
      ...(cookies.has(actor) ? { cookie: cookies.get(actor) } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function sql(query, params = []) { return (await pool.execute(query, params))[0]; }
  for (const actor of ['platform', 'admin1', 'admin2', 'producer', 'dual', 'member']) {
    const email = `${actor}@events-v2.test`;
    const signup = await request(null, 'POST', '/api/auth/sign-up/email', { email, password: 'Integration-password-12345', name: actor });
    assert.equal(signup.status, 200, JSON.stringify(signup.body));
    await sql('UPDATE `user` SET emailVerified = 1 WHERE email = ?', [email]);
    ids.set(actor, (await sql('SELECT id FROM `user` WHERE email = ?', [email]))[0].id);
    const login = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Integration-password-12345' }) });
    assert.equal(login.status, 200);
    cookies.set(actor, login.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '));
  }
  const root = '/api/events-v2';
  const organization1 = await request('platform', 'POST', root + '/platform/organizations', { name: 'O1', adminUserId: ids.get('admin1'), createEventsEnabled: true });
  const organization2 = await request('platform', 'POST', root + '/platform/organizations', { name: 'O2', adminUserId: ids.get('admin2') });
  assert.equal(organization1.status, 201); assert.equal(organization2.status, 201);
  const o1 = organization1.body.id, o2 = organization2.body.id;
  const orgPath = id => `${root}/organizations/${id}`;
  const eventPath = (org, event) => `${orgPath(org)}/events/${event}`;
  for (const actor of ['producer', 'dual', 'member']) assert.equal((await request('admin1', 'PUT', `${orgPath(o1)}/members/${ids.get(actor)}`, { role: 'MEMBER' })).status, 200);
  const eventA = await request('admin1', 'POST', `${orgPath(o1)}/events`, { title: 'A', slug: 'test-event-a' });
  const eventB = await request('admin1', 'POST', `${orgPath(o1)}/events`, { title: 'B', slug: 'test-event-b' });
  assert.equal(eventA.status, 201); assert.equal(eventB.status, 201);
  const a = eventA.body.eventId, b = eventB.body.eventId;
  assert.equal((await request('platform', 'PATCH', `${root}/platform/organizations/${o2}`, { createEventsEnabled: true })).status, 200);
  const eventC = await request('admin2', 'POST', `${orgPath(o2)}/events`, { title: 'C', slug: 'test-event-c' });
  assert.equal(eventC.status, 201); const c = eventC.body.eventId;
  for (const [event, actor, roles] of [[a, 'producer', ['PRODUCER']], [a, 'dual', ['PRODUCER']], [b, 'dual', ['PRODUCER']]]) {
    assert.equal((await request('admin1', 'PUT', `${eventPath(o1, event)}/members/${ids.get(actor)}`, { roles })).status, 200);
  }
  const stageA = crypto.randomUUID(), stageB = crypto.randomUUID(), activityA = crypto.randomUUID(), activityB = crypto.randomUUID(), liveA = crypto.randomUUID();
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageA, a, 'Virtual A', stageB, b, 'Virtual B']);
  await sql('INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id) VALUES (?,?,?,?,?),(?,?,?,?,?)', [activityA, a, stageA, 'Activity A', 'v2-private-deck', activityB, b, stageB, 'Activity B', 'v2-other-deck']);
  await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [liveA, a, stageA, activityA, 'v2-private-deck']);
  const publicId = 'p_evt_v2_private_test';
  await sql('INSERT INTO event_public_qrs (id,event_workspace_id,public_id,audience_level) VALUES (?,?,?,?)', [crypto.randomUUID(), a, publicId, 'FREE']);

  await t.test('migrations re-run; recover when the last migration already partially created tables', async () => {
    assert.deepEqual((await runMigrations(pool)).executed, []);
    await sql("DELETE FROM schema_migrations WHERE id = '037_event_organization_memberships.sql'");
    assert.deepEqual((await runMigrations(pool)).executed, ['037_event_organization_memberships.sql']);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_v2_contexts'))[0].n, 3);
  });
  await t.test('account login alone and platform admin never grant operational event access', async () => {
    assert.equal((await request(null, 'GET', eventPath(o1, a))).status, 401);
    assert.equal((await request('platform', 'GET', eventPath(o1, a))).status, 404);
    assert.equal((await request('member', 'GET', eventPath(o1, a))).status, 404);
    assert.equal((await request('admin1', 'GET', eventPath(o1, a), undefined, { cookie: 'better-auth.session_token=forged' })).status, 401);
  });
  await t.test('cross organization/event reads and writes are denied without mutation', async () => {
    for (const path of [eventPath(o2, c), eventPath(o2, a), `${eventPath(o1, a)}/activities/${activityB}`]) {
      assert.equal((await request('admin1', 'GET', path)).status, 404);
    }
    assert.equal((await request('admin1', 'PATCH', eventPath(o2, c), { title: 'stolen' })).status, 404);
    assert.equal((await sql('SELECT title FROM event_hubs WHERE workspace_id = ?', [c]))[0].title, 'C');
    assert.equal((await request('dual', 'GET', `${eventPath(o1, a)}/activities/${activityB}`)).status, 404);
    assert.equal((await request('dual', 'GET', `${eventPath(o1, b)}/activities/${activityB}`)).status, 200);
    assert.equal((await request('dual', 'GET', `${eventPath(o1, a)}/activities/${activityA}`)).status, 200);
    assert.equal((await request('admin1', 'GET', orgPath(o2))).status, 404);
    assert.equal((await request('admin2', 'GET', `${orgPath(o1)}/events`)).status, 404);
  });
  await t.test('producer prepares but cannot delegate; forged fields and origins never mutate', async () => {
    assert.equal((await request('producer', 'PATCH', eventPath(o1, a), { title: 'A prepared' })).status, 200);
    assert.equal((await request('producer', 'PUT', `${eventPath(o1, a)}/members/${ids.get('producer')}`, { roles: ['ADMIN'] })).status, 403);
    assert.equal((await request('admin1', 'PATCH', eventPath(o1, a), { title: 'bad', eventId: b, organizationId: o2 })).status, 400);
    assert.equal((await request('admin1', 'PATCH', eventPath(o1, a), { title: 'bad' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await sql('SELECT title FROM event_hubs WHERE workspace_id = ?', [a]))[0].title, 'A prepared');
    assert.deepEqual(await sql('SELECT role FROM event_member_roles WHERE event_id = ? AND user_id = ?', [a, ids.get('producer')]), [{ role: 'PRODUCER' }]);
  });
  await t.test('org membership cannot be forged through a cross-org FK', async () => {
    await assert.rejects(() => sql('INSERT INTO event_memberships (event_id,organization_id,user_id) VALUES (?,?,?)', [a, o2, ids.get('admin2')]), { code: 'ER_NO_REFERENCED_ROW_2' });
    assert.equal((await request('admin1', 'PUT', `${eventPath(o1, a)}/members/${ids.get('admin2')}`, { roles: ['ADMIN'] })).status, 404);
  });
  await t.test('event creation entitlement, duplicate slug and last admins are enforced atomically', async () => {
    await request('platform', 'PATCH', `${root}/platform/organizations/${o2}`, { createEventsEnabled: false });
    assert.equal((await request('admin2', 'POST', `${orgPath(o2)}/events`, { title: 'not enabled', slug: 'disabled-event' })).status, 403);
    const before = (await sql('SELECT COUNT(*) n FROM workspaces'))[0].n;
    assert.equal((await request('admin1', 'POST', `${orgPath(o1)}/events`, { title: 'duplicate', slug: 'test-event-a' })).status, 409);
    assert.equal((await sql('SELECT COUNT(*) n FROM workspaces'))[0].n, before);
    assert.equal((await request('admin1', 'DELETE', `${orgPath(o1)}/members/${ids.get('admin1')}`)).status, 409);
    assert.equal((await request('admin1', 'DELETE', `${eventPath(o1, a)}/members/${ids.get('admin1')}`)).status, 409);
    assert.equal((await sql('SELECT COUNT(*) n FROM event_stages WHERE event_workspace_id = ?', [c]))[0].n, 0);
  });
  await t.test('event and organization revocation apply to the same live account session', async () => {
    assert.equal((await request('admin1', 'DELETE', `${eventPath(o1, a)}/members/${ids.get('producer')}`)).status, 200);
    assert.equal((await request('producer', 'PATCH', eventPath(o1, a), { title: 'after revoke' })).status, 404);
    assert.equal((await request('admin1', 'DELETE', `${orgPath(o1)}/members/${ids.get('dual')}`)).status, 200);
    assert.equal((await request('dual', 'GET', eventPath(o1, b))).status, 404);
    // Restoring only org membership must not resurrect event grants.
    await request('admin1', 'PUT', `${orgPath(o1)}/members/${ids.get('dual')}`, { role: 'MEMBER' });
    assert.equal((await request('dual', 'GET', eventPath(o1, b))).status, 404);
    assert.ok((await sql("SELECT COUNT(*) n FROM event_security_audit WHERE outcome = 'DENIED'"))[0].n > 0);
  });
  await t.test('feature off never falls back to v1, including stages, live, QR, assets and sockets', async () => {
    domainEnabled = false;
    assert.equal((await request('admin1', 'GET', eventPath(o1, a))).status, 404);
    for (const path of [`/api/admin/event-hubs/${a}`, `/api/admin/event-stages/${stageA}/capacity`,
      `/api/event/stages/${stageA}/live-sessions`, `/api/event/stage-control/v2-private-deck`,
      `/api/event/live-sessions/${liveA}/status`, `/api/event/public/${publicId}`, `/${publicId}`,
      `/event-hubs/${a}/brand-assets/logo.png`, '/decks/v2-private-deck/manifest.json', '/api/decks/v2-private-deck/interactions']) {
      assert.equal((await request('admin1', 'GET', path)).status, 404, path);
    }
    assert.deepEqual((await request('admin1', 'GET', '/api/admin/event-hubs')).body.hubs, []);
    assert.equal((await request('admin1', 'GET', '/decks/personal-deck/manifest.json')).status, 200);
    assert.equal(await boundary.isV2('deck', 'personal-deck'), false);
    domainEnabled = true;
    const attempts = [];
    for (let i = 0; i < 2; i++) {
      const client = clientSocket(base, { transports: ['websocket'], reconnection: false, forceNew: true });
      attempts.push(client);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket isolation timeout')), 5000);
        client.once('connect', () => client.emit('join_presentation', { session: liveA, deck: 'v2-private-deck', role: 'presenter', eventId: b }));
        client.once('presentation_state', () => reject(new Error('v2 state leaked')));
        client.once('presentation:access_denied', () => { clearTimeout(timer); resolve(); });
      });
      client.close();
    }
    assert.equal(createdRuntimeStates, 0, 'neither first connection nor reconnection creates runtime state');
    const programClient = clientSocket(base, { transports: ['websocket'], reconnection: false, forceNew: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('program socket timeout')), 5000);
      programClient.once('connect', () => programClient.emit('event-admin:join', { publicId, participantId: 'forged' }));
      programClient.once('event-admin:interaction:state', state => { clearTimeout(timer); assert.equal(state.active, null); resolve(); });
    });
    assert.ok([...sockets.of('/').sockets.values()].every(socket => ![...socket.rooms].some(room => room.includes(a))));
    programClient.close();
  });
});
