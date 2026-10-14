const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { LegacyEventBoundary } = require('../events-v2/legacy-boundary');
const { createDeckInteractionHandlers } = require('../deck-interactions-api');
const { readDeckInventory } = require('../deck-inventory');
const { createAccessLinkHandlers } = require('../access-links');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'events-perimeter-'));
  const data = path.join(root, 'data'), pub = path.join(root, 'public');
  for (const folder of [data, path.join(pub, 'decks')]) {
    for (const id of ['private-deck', 'personal-deck', 'demo']) {
      const dir = path.join(folder, id); await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ deckId: id, title: id === 'private-deck' ? 'PRIVATE_BYTES' : 'Personal', session_id: 'session-' + id, slides: [] }));
      await fs.writeFile(path.join(dir, 'interactions.json'), JSON.stringify([{ id: 'poll', type: 'poll', prompt: id === 'private-deck' ? 'PRIVATE_BYTES' : 'Personal', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }]));
    }
  }
  let unavailable = false, handlers = 0, queries = 0;
  const boundary = new LegacyEventBoundary({ execute: async (_sql, params) => { queries++; if (unavailable) throw new Error('PRIVATE_SQL_PASSWORD'); return [params.includes('private-deck') || params.includes('private-stage') || params.includes('private-activity') || params.includes('private-live') || params.includes('private-event') ? [{}] : []]; } });
  const app = express(); app.use(express.json()); app.use(boundary.httpMiddleware());
  const api = createDeckInteractionHandlers({ dataDecksDir: data, staticDecksDir: path.join(pub, 'decks') });
  app.get('/api/decks/:deckId/interactions', (req, res, next) => { handlers++; return api.getInteractions(req, res, next); });
  app.post('/api/admin/event-hubs/:eventId/activities', (_req, res) => { handlers++; res.json({ legacyWrite: true }); });
  app.post('/api/event/stages/:stageId/live-sessions', (_req, res) => { handlers++; res.json({ legacyWrite: true }); });
  app.post('/api/event/stages/:stageId/live-sessions/:liveId/finish', (_req, res) => { handlers++; res.json({ legacyWrite: true }); });
  app.use('/decks', express.static(data)); app.use(express.static(pub));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND' }));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (url, method = 'GET', body) => { const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, text: await response.text() }; };
  return { boundary, data, get, handlers: () => handlers, queries: () => queries, outage: () => { unavailable = true; } };
}

test('Express case-insensitive routes and trimmed IDs cannot expose a v2 Deck through the real legacy interaction reader', async t => {
  const f = await fixture(t);
  const urls = ['/API/DECKS/private-deck/interactions', '/api/Decks/private-deck/interactions/', '/api/decks/%20private-deck%20/interactions'];
  const results = []; for (const url of urls) { const r = await f.get(url); results.push({ url, status: r.status, privateBytes: r.text.includes('PRIVATE_BYTES') }); }
  assert.deepEqual(results, urls.map(url => ({ url, status: 404, privateBytes: false })));
  assert.equal(f.handlers(), 0);
  const personal = await f.get('/API/DECKS/personal-deck/interactions/'); assert.equal(personal.status, 200); assert.equal(personal.text.includes('Personal'), true);
});

test('Encoded slashes, dot segments and literal-prefix escapes cannot reach private bytes in either actual static root', async t => {
  const f = await fixture(t);
  const urls = ['/decks/private-deck/manifest.json', '/DECKS/private-deck/manifest.json', '/decks/demo%2f..%2fprivate-deck/manifest.json', '/decks/demo/..%2fprivate-deck/manifest.json', '/%64ecks/private-deck/manifest.json', '/foo/..%2fdecks/private-deck/manifest.json'];
  const results = []; for (const url of urls) { const r = await f.get(url); results.push({ url, status: r.status, privateBytes: r.text.includes('PRIVATE_BYTES') }); }
  assert.deepEqual(results, urls.map(url => ({ url, status: 404, privateBytes: false })));
  assert.equal((await f.get('/decks/personal-deck/manifest.json')).status, 200);
});

test('Legacy mutations inspect typed child and body resources independently of a visible v1 parent and URL casing', async t => {
  const f = await fixture(t);
  for (const [url, body] of [
    ['/API/EVENT/STAGES/legacy-stage/live-sessions', { eventActivityId: ' private-activity ' }],
    ['/api/admin/event-hubs/legacy-event/activities', { eventStageId: 'private-stage' }],
    ['/api/admin/event-hubs/legacy-event/activities', { deckId: ' private-deck ' }],
    ['/api/event/stages/legacy-stage/live-sessions/private-live/finish', {}]
  ]) assert.equal((await f.get(url, 'POST', body)).status, 404, url);
  assert.equal(f.handlers(), 0);
  assert.equal((await f.get('/API/EVENT/STAGES/legacy-stage/live-sessions', 'POST', { eventActivityId: 'personal-activity' })).status, 200);
});

test('Default/aliased deck inputs and reserved Events execution keys cannot bypass a legacy socket join', async () => {
  const boundary = new LegacyEventBoundary({ execute: async (_sql, params) => [params.includes('private-deck') ? [{}] : []] });
  const socket = { emissions: [], closed: false, emit(name, data) { this.emissions.push([name, data]); }, disconnect() { this.closed = true; } };
  assert.equal(await boundary.allowPresentationJoin(socket, 'legacy-session', 'demo/../private-deck'), false); assert.equal(socket.closed, true);
  await assert.rejects(boundary.assertPresentation('evt:00000000-0000-4000-8000-000000000001:live:00000000-0000-4000-8000-000000000002', 'personal-deck'), { code: 'EVENT_V2_ACCESS_REQUIRED' });
  await assert.rejects(boundary.assertPresentation('legacy-session', '../events/private'), { code: 'INVALID_DECK_ID' });
  await boundary.assertPresentation('legacy-session', 'personal-deck');
});

test('Database outage denies canonical and aliased private routes before reading bytes or mutating; malformed escapes are sanitized', async t => {
  const f = await fixture(t); f.outage();
  for (const url of ['/API/DECKS/private-deck/interactions', '/decks/demo%2f..%2fprivate-deck/manifest.json']) {
    const response = await f.get(url); assert.equal(response.status, 503); assert.equal(response.text.includes('PRIVATE_SQL_PASSWORD'), false); assert.equal(response.text.includes('PRIVATE_BYTES'), false);
  }
  assert.equal(f.handlers(), 0);
  const malformed = await f.get('/decks/%E0%A4%A/manifest.json'); assert.equal(malformed.status, 400); assert.equal(malformed.text.includes('URIError'), false);
});

test('Legacy inventory excludes v2 before manifest migration, retains personal defaults, and fails closed before reading on DB outage', async t => {
  const f = await fixture(t), migrated = [];
  const privateManifest = path.join(f.data, 'private-deck', 'manifest.json');
  const before = await fs.readFile(privateManifest, 'utf8');
  const options = { rootDir: f.data, seen: new Set(), usedSessionIds: new Set(), canPersistSessionId: true,
    allowDeck: async id => !(await f.boundary.isV2('deck', id)),
    ensureManifestSessionId: async (_path, manifest) => { migrated.push(manifest.deckId); return manifest; },
    manifestSummary: value => value };
  const result = await readDeckInventory(options);
  assert.deepEqual(result.map(item => item.deckId).sort(), ['demo', 'personal-deck']);
  assert.equal(migrated.includes('private-deck'), false); assert.equal(await fs.readFile(privateManifest, 'utf8'), before);
  f.outage(); migrated.length = 0;
  await assert.rejects(readDeckInventory({ ...options, seen: new Set() }), /PRIVATE_SQL_PASSWORD/); assert.equal(migrated.length, 0);
  const legacy = await readDeckInventory({ ...options, seen: new Set(), allowDeck: undefined });
  assert.equal(legacy.length, 3, 'default remains available to isolated Presentaciones without an Events boundary');
});

test('A stored private link and direct link creation are denied before manifest resolution; personal links keep their default flow', async t => {
  const f = await fixture(t), dataDir = path.dirname(f.data);
  await fs.writeFile(path.join(dataDir, 'access-links.json'), JSON.stringify([
    { access_token: 'a_1234567890', session_id: 'session-private-deck', deck_id: 'private-deck', role: 'speaker', active: true },
    { access_token: 'a_abcdefghij', session_id: 'session-personal-deck', deck_id: 'personal-deck', role: 'speaker', active: true }
  ]));
  const handlers = createAccessLinkHandlers({ dataDir, dataDecksDir: f.data, staticDecksDir: f.data,
    allowLegacyPresentation: async (session, deck) => { await f.boundary.assertPresentation(session, deck); return true; } });
  const read = fs.readFile; let privateReads = 0;
  fs.readFile = async (...args) => { if (String(args[0]).includes('/private-deck/manifest.json')) privateReads++; return read(...args); };
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    // A boolean policy matches the production allowLegacyPresentation hook;
    // exceptions are also fail closed, but the existing API reports them as 500.
    const blocked = createAccessLinkHandlers({ dataDir, dataDecksDir: f.data, staticDecksDir: f.data,
      allowLegacyPresentation: async (session, deck) => !(await f.boundary.isV2('deck', deck)) && !(await f.boundary.isV2('live', session)) });
    const res = response(); await blocked.resolveAccessLink({ params: { access_token: 'a_1234567890' } }, res); assert.equal(res.statusCode, 404);
    await assert.rejects(blocked.createAccessLinkForDeck({ deckId: 'private-deck', role: 'speaker' }), /Presentation not found/);
    assert.equal(privateReads, 0);
    const personal = response(); await handlers.resolveAccessLink({ params: { access_token: 'a_abcdefghij' } }, personal); assert.equal(personal.statusCode, 200);
  } finally { fs.readFile = read; }
});
