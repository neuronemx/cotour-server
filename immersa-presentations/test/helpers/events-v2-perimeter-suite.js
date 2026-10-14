const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { io } = require('socket.io-client');

async function perimeterSuite(t, f) {
  const { sql, request, domain, boundary, legacy, base, a, stageA, activityA, liveA, publicId, localDir, perimeterDataDir, perimeterPublicDir } = f;
  const v1 = crypto.randomUUID(), stage = crypto.randomUUID(), activity = crypto.randomUUID(), speaker = crypto.randomUUID(), poll = crypto.randomUUID();
  await sql("INSERT INTO workspaces (id,kind,plan) VALUES (?,'event','FREE')", [v1]);
  await sql('INSERT INTO event_hubs (workspace_id,slug,title) VALUES (?,?,?)', [v1, 'perimeter-legacy-' + v1, 'Legacy fixture']);
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?)', [stage, v1, 'Legacy stage']);
  await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,access_level) VALUES (?,?,?,?,?,'FREE')", [activity, v1, stage, 'Legacy activity', 'personal-deck']);
  await sql("INSERT INTO event_speakers (id,event_workspace_id,source_kind,manual_name) VALUES (?,?,'MANUAL','PRIVATE_PERIMETER_NAME')", [speaker, a]);
  await sql('INSERT INTO event_hub_polls (id,event_workspace_id,title,prompt) VALUES (?,?,?,?)', [poll, a, 'PRIVATE_PERIMETER_POLL', 'Private question']);
  await legacy.grantStageOperatorAccess({ eventStageId: stage, accessSecret: 'perimeter-isolated-stage-secret' });
  const header = { 'x-immersa-event-stage-access': 'perimeter-isolated-stage-secret' };
  for (const root of [localDir, perimeterDataDir, path.join(perimeterPublicDir, 'decks')]) for (const id of ['v2-private-deck', 'personal-deck', 'demo']) {
    const dir = path.join(root, id); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ deckId: id, session_id: 'session-' + id, title: id === 'v2-private-deck' ? 'PRIVATE_PERIMETER_BYTES' : 'Personal', slides: [] }));
    await fs.writeFile(path.join(dir, 'interactions.json'), JSON.stringify([{ id: 'poll', type: 'poll', prompt: id === 'v2-private-deck' ? 'PRIVATE_PERIMETER_BYTES' : 'Personal', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }]));
  }
  async function http(url, actor = null, method = 'GET', body, extra = {}) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', origin: base,
      ...(f.cookies.has(actor) ? { cookie: f.cookies.get(actor) } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch (_) {}
    return { status: response.status, text, data };
  }
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const count = async () => {
    const result = {}; for (const table of ['event_live_sessions', 'event_activities', 'event_access_grants', 'event_v2_qna_questions', 'event_v2_knowledge_executions', 'event_v2_reaction_counts', 'presentation_sessions']) result[table] = Number((await sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n); return result;
  };
  const paths = [
    `/API/ADMIN/EVENT-HUBS/${a}`, `/api/admin/event-stages/%20${stageA}%20/capacity`, `/API/EVENT/STAGE-CONTROL/v2-private-deck`,
    `/API/EVENT/LIVE-SESSIONS/${liveA}/status`, `/API/EVENT/PUBLIC/${publicId}`, `/event-Hubs/${a}/brand-assets/logo.png`,
    '/API/DECKS/v2-private-deck/interactions', '/api/Decks/%20v2-private-deck%20/interactions/',
    '/decks/v2-private-deck/manifest.json', '/DECKS/v2-private-deck/manifest.json', '/decks/demo%2f..%2fv2-private-deck/manifest.json',
    '/decks/demo/..%2fv2-private-deck/manifest.json', '/%64ecks/v2-private-deck/manifest.json', '/foo/..%2fdecks/v2-private-deck/manifest.json',
    `/api/admin/event-hubs/${v1}/activities/${activityA}/deck-check`, `/api/admin/event-hubs/${v1}/activities/${activity}/speakers/${speaker}/decks`,
    `/api/admin/event-hubs/${v1}/polls/${poll}`, `/api/event/stages/${stage}/live-sessions/${liveA}/finish`
  ];

  await t.test('real SQL classification blocks URL case/whitespace/static aliases and child IDs with feature off; private bytes and nominal metadata never reach legacy', async () => {
    const before = await count(), reads = f.perimeterReads(), writes = f.perimeterWrites();
    f.setEnabled(false);
    try {
      for (const url of paths) { const r = await http(url, 'platform'); assert.equal(r.status, 404, url + ': ' + r.text); assert.equal(r.text.includes('PRIVATE_PERIMETER'), false); }
      const catalog = await http(`/API/ADMIN/EVENT-HUBS/${v1}/decks/`, 'platform'); assert.equal(catalog.status, 200); assert.equal(catalog.text.includes('PRIVATE_PERIMETER'), false); assert.equal(catalog.data.decks.some(d => d.deckId === 'v2-private-deck'), false); assert.equal(catalog.data.decks.some(d => d.deckId === 'personal-deck'), true);
      assert.equal((await http('/API/DECKS/personal-deck/interactions')).status, 200); assert.equal((await http('/decks/personal-deck/manifest.json')).status, 200);
      assert.equal((await http('/API/OPEN/a_1234567890')).status, 404); assert.equal((await http('/API/OPEN/a_abcdefghij')).status, 200);
    } finally { f.setEnabled(true); }
    assert.deepEqual(await count(), before); assert.equal(f.perimeterReads(), reads + 2); assert.equal(f.perimeterWrites(), writes);
    // Classification survives disabling a specific event as well as the flag.
    await sql('UPDATE event_v2_contexts SET enabled=0 WHERE event_id=?', [a]);
    try { assert.equal((await http('/API/DECKS/v2-private-deck/interactions')).status, 404); }
    finally { await sql('UPDATE event_v2_contexts SET enabled=1 WHERE event_id=?', [a]); }
  });
  await t.test('typed v2 body/child resources never enter real legacy mutations; normal legacy start/finish still works', async () => {
    const before = await count(), writes = f.perimeterWrites();
    for (const [url, body] of [
      [`/API/EVENT/STAGES/${stage}/live-sessions`, { eventActivityId: ' ' + activityA + ' ' }],
      [`/api/admin/event-hubs/${v1}/activities`, { eventStageId: stageA, title: 'Must not exist' }],
      [`/api/admin/event-hubs/${v1}/activities`, { eventStageId: stage, deckId: ' v2-private-deck ', title: 'Must not exist' }],
      [`/API/EVENT/STAGES/${stage}/live-sessions/${liveA}/finish`, {}],
      ['/API/ACCESS-LINKS/', { session_id: liveA, deck_id: 'personal-deck', role: 'speaker' }]
    ]) { const r = await http(url, 'platform', 'POST', body, header); assert.equal(r.status, 404, r.text); }
    assert.deepEqual(await count(), before); assert.equal(f.perimeterWrites(), writes);
    const started = await http(`/API/EVENT/STAGES/${stage}/live-sessions`, null, 'POST', { eventActivityId: activity }, header); assert.equal(started.status, 201, started.text);
    const finished = await http(`/api/event/stages/${stage}/live-sessions/${started.data.id}/finish`, null, 'POST', {}, header); assert.equal(finished.status, 200, finished.text);
    assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?', [started.data.id]))[0].status, 'FINISHED');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_activities WHERE title=?', ['Must not exist']))[0].n, 0);
  });
  await t.test('legacy Socket.IO rejects private deck aliases, reserved execution keys and normalized defaults before creating state or rooms', async () => {
    const defaultActivity = crypto.randomUUID(); await sql('INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id) VALUES (?,?,?,?,?)', [defaultActivity, a, stageA, 'Private default fixture', 'demo']);
    const initialStates = f.legacyStates();
    async function attempt(payload, denied) {
      const client = io(base, { transports: ['websocket'], reconnection: false, forceNew: true }); clients.add(client);
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Perimeter legacy join timeout')), 10000);
        client.once('connect', () => client.emit('join_presentation', { role: 'presenter', ...payload }));
        client.once('presentation:access_denied', () => { clearTimeout(timer); denied ? resolve() : reject(new Error('personal join denied')); });
        client.once('presentation_state', () => { clearTimeout(timer); denied ? reject(new Error('private state emitted')) : resolve(); });
      }); client.close();
    }
    try {
      for (const payload of [{ session: liveA, deck: 'personal-deck' }, { session: 'legacy', deck: 'demo/../v2-private-deck' },
        { session: 'legacy', deck: '../events/private' }, { session: `evt:${a}:live:${liveA}`, deck: 'personal-deck' },
        { session: `evt:${a}:venue:${liveA}`, deck: 'personal-deck' }, { session: 'legacy', deck: null }]) await attempt(payload, true);
      assert.equal(f.legacyStates(), initialStates);
      assert.ok([...f.sockets.of('/').sockets.values()].every(socket => ![...socket.rooms].some(room => room === 'legacy-runtime' || room.includes(a))));
    } finally { await sql('DELETE FROM event_activities WHERE id=?', [defaultActivity]); }
    await attempt({ session: 'personal-session', deck: 'personal-deck' }, false); assert.equal(f.legacyStates(), initialStates + 1);
  });
  await t.test('unavailable authorization denies aliased bytes and mutations; malformed encoding is sanitized; no data or state changes', async () => {
    const before = await count(), reads = f.perimeterReads(), writes = f.perimeterWrites(), pool = boundary.pool;
    boundary.pool = { execute: async () => { throw new Error('PRIVATE_PERIMETER_SQL_CREDENTIAL'); } };
    try {
      for (const [url, method, body] of [['/API/DECKS/v2-private-deck/interactions', 'GET'], ['/decks/demo%2f..%2fv2-private-deck/manifest.json', 'GET'], [`/API/EVENT/STAGES/${stage}/live-sessions`, 'POST', { eventActivityId: activity }]]) {
        const r = await http(url, 'platform', method, body, header); assert.equal(r.status, 503); assert.deepEqual(r.data, { code: 'AUTHORIZATION_UNAVAILABLE' }); assert.equal(r.text.includes('PRIVATE_PERIMETER'), false);
      }
    } finally { boundary.pool = pool; }
    const malformed = await http('/decks/%E0%A4%A/manifest.json'); assert.equal(malformed.status, 400); assert.deepEqual(malformed.data, { code: 'INVALID_RESOURCE_PATH' });
    assert.deepEqual(await count(), before); assert.equal(f.perimeterReads(), reads); assert.equal(f.perimeterWrites(), writes);
    assert.equal(await boundary.isV2('event', v1), false);
  });
}
module.exports = { perimeterSuite };
