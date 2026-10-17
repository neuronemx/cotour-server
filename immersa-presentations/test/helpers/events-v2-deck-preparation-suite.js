const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pdfFixture } = require('./events-v2-pdf-fixture');
const { runMigrations } = require('../../db/migrate');

async function deckPreparationSuite(t, f) {
  const { request, sql, domain, ids, cookies, base, o1, a, b, deckPreparations: service } = f;
  const decksPath = event => `/api/events-v2/organizations/${o1}/events/${event}/decks`;
  let deck, version, ownPath;
  const versionPath = v => `${decksPath(a)}/${deck.id}/versions/${v.id}`;
  async function newVersion() {
    const result = await request('producer', 'POST', `${decksPath(a)}/${deck.id}/versions`, {});
    assert.equal(result.status, 201); return result.body;
  }
  async function upload(actor, url, { bytes = pdfFixture(), filename = '../../untrusted.pdf', field = 'pdf', headers = {}, extra = false } = {}) {
    const body = new FormData(); body.append(field, new Blob([bytes], { type: 'application/pdf' }), filename);
    if (extra) body.append('eventId', b);
    const response = await fetch(base + url + '/source', { method: 'POST', body,
      headers: { origin: base, ...(cookies.has(actor) ? { cookie: cookies.get(actor) } : {}), ...headers } });
    return { status: response.status, body: await response.json() };
  }
  const rows = () => sql('SELECT * FROM event_deck_preparations WHERE deck_id=?', [deck.id]);
  async function image(actor, url, method = 'GET') {
    const response = await fetch(base + url, { method, headers: cookies.has(actor) ? { cookie: cookies.get(actor) } : {} });
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  await t.test('event PDF upload converts real bytes into a private immutable DRAFT preparation', async () => {
    const created = await request('producer', 'POST', decksPath(a), { title: 'Private PDF preparation' });
    assert.equal(created.status, 201); deck = created.body; version = deck.version; ownPath = versionPath(version);
    assert.deepEqual((await request('producer', 'GET', ownPath + '/preparation')).body, { status: 'NOT_UPLOADED' });
    const result = await upload('producer', ownPath);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.status, 'CONVERTED'); assert.equal(result.body.slideCount, 2);
    assert.equal(result.body.sourceSize, pdfFixture().length); assert.match(result.body.manifestDigest, /^[a-f0-9]{64}$/);
    assert.equal((await request('producer', 'GET', `${decksPath(a)}/${deck.id}`)).body.versions[0].status, 'DRAFT');
    const [row] = await rows(); const manifest = JSON.parse(row.manifest_json);
    assert.equal(manifest.versionId, version.id); assert.equal(manifest.eventId, a);
    assert.equal(JSON.stringify(manifest).includes('untrusted'), false);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_activities WHERE deck_id=? OR pending_deck_id=?', [deck.id, deck.id]))[0].n, 0);
  });

  await t.test('preview requires current account/event permissions for GET and HEAD and is never public', async () => {
    const url = ownPath + '/slides/slide-001/full';
    const preview = await image('producer', url);
    assert.equal(preview.status, 200); assert.equal(preview.bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(preview.headers.get('cache-control'), 'no-store'); assert.equal(preview.headers.get('content-type'), 'image/jpeg');
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff'); assert.equal(preview.headers.get('cross-origin-resource-policy'), 'same-origin');
    const head = await image('producer', url, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
    for (const actor of [null, 'platform', 'member', 'admin2']) {
      const expected = actor === null ? 401 : 404;
      assert.equal((await image(actor, url)).status, expected);
      assert.equal((await request(actor, 'GET', ownPath + '/preparation')).status, expected);
    }
    for (const variant of ['original', 'manifest', 'source']) assert.equal((await image('producer', ownPath + '/slides/slide-001/' + variant)).status, 404);
    assert.equal((await image('producer', ownPath + '/slides/slide-999/full')).status, 404);
    for (const id of [deck.id, version.id]) {
      const response = await fetch(base + `/decks/${id}/slides/slide-001.jpg`);
      assert.equal(response.status, 404); assert.equal((await response.text()).includes('JFIF'), false);
    }
  });

  await t.test('scope substitution fails for an actor in both events and before malformed multipart parsing', async () => {
    const badPaths = [`${decksPath(b)}/${deck.id}/versions/${version.id}`, `${decksPath(a)}/${crypto.randomUUID()}/versions/${version.id}`,
      `${decksPath(a)}/${deck.id}/versions/${crypto.randomUUID()}`];
    for (const url of badPaths) {
      assert.equal((await request('dual', 'GET', url + '/preparation')).status, 404);
      assert.equal((await image('dual', url + '/slides/slide-001/full')).status, 404);
      assert.equal((await upload('dual', url)).status, 404);
    }
    const response = await fetch(base + badPaths[0] + '/source', { method: 'POST', headers: { origin: base, cookie: cookies.get('dual'),
      'content-type': 'multipart/form-data; boundary=broken' }, body: 'broken' });
    assert.equal(response.status, 404); assert.equal((await rows()).length, 1);
  });

  await t.test('multipart, PDF signature and Origin validation cannot reserve or overwrite a version', async () => {
    const v = await newVersion(), url = versionPath(v);
    for (const options of [{ bytes: Buffer.from('not a PDF') }, { field: 'other' }, { extra: true }]) {
      assert.equal((await upload('producer', url, options)).status, 400);
    }
    for (const origin of ['', 'null', 'https://foreign.example']) assert.equal((await upload('producer', url, { headers: { origin } })).status, 403);
    assert.equal((await rows()).length, 1);
    assert.equal((await upload('producer', ownPath)).status, 409);
    assert.equal((await request('producer', 'GET', ownPath + '/preparation')).body.status, 'CONVERTED');
  });

  await t.test('concurrent uploads reserve one SQL version once across requests', async () => {
    const v = await newVersion(), url = versionPath(v);
    const results = await Promise.all([upload('producer', url), upload('producer', url)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_deck_preparations WHERE version_id=?', [v.id]))[0].n, 1);
    assert.equal(service.uploads, 0);
  });

  async function duringConversion(change, restore) {
    const v = await newVersion(), url = versionPath(v);
    const prepare = service.store.prepare.bind(service.store);
    let signal, resume;
    const started = new Promise(resolve => { signal = resolve; });
    const held = new Promise(resolve => { resume = resolve; });
    service.store.prepare = async (...args) => { const result = await prepare(...args); signal(); await held; return result; };
    const pending = upload('producer', url);
    try {
      await started; await change(); resume();
      const result = await pending;
      assert.equal(result.status, 404, JSON.stringify(result.body));
      const [row] = await sql('SELECT status FROM event_deck_preparations WHERE version_id=?', [v.id]);
      assert.equal(row.status, 'FAILED');
    } finally { resume(); await pending; service.store.prepare = prepare; await restore(); }
    assert.equal((await image('producer', url + '/slides/slide-001/full')).status, 409);
  }

  await t.test('revocation during conversion prevents publication after a fresh final authorization', async () => {
    await duringConversion(() => domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), null),
      () => domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), ['PRODUCER']));
    await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), null);
    try { assert.equal((await image('producer', ownPath + '/slides/slide-001/full')).status, 404); }
    finally { await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), ['PRODUCER']); }
  });

  await t.test('disabling v2 during rendering prevents publication while leaving private bytes inaccessible', async () => {
    await duringConversion(async () => f.setDomainEnabled(false), async () => f.setDomainEnabled(true));
  });

  await t.test('malformed PDF and partial render failures leave explicit FAILED states and require a new version', async () => {
    const v = await newVersion(), url = versionPath(v);
    assert.equal((await upload('producer', url, { bytes: Buffer.from('%PDF- broken') })).status, 400);
    assert.equal((await request('producer', 'GET', url + '/preparation')).body.status, 'FAILED');
    assert.equal((await upload('producer', url)).status, 409);
    const other = await newVersion();
    const prepare = service.store.prepare;
    service.store.prepare = async () => { throw new Error('PRIVATE_FILESYSTEM_PATH_AND_SECRET'); };
    try {
      const result = await upload('producer', versionPath(other));
      assert.equal(result.status, 503); assert.deepEqual(result.body, { code: 'PDF_CONVERSION_FAILED' });
      assert.equal((await request('producer', 'GET', versionPath(other) + '/preparation')).body.errorCode, 'PDF_CONVERSION_FAILED');
    } finally { service.store.prepare = prepare; }
  });

  await t.test('failed final SQL write rolls back without publishing conversion or leaking SQL', async () => {
    const v = await newVersion(), url = versionPath(v);
    await domain.pool.query("CREATE TRIGGER reject_pdf_complete BEFORE UPDATE ON event_deck_preparations FOR EACH ROW BEGIN IF NEW.status='CONVERTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_SQL_FAILURE'; END IF; END");
    try {
      const result = await upload('producer', url);
      assert.equal(result.status, 503); assert.deepEqual(result.body, { code: 'PDF_CONVERSION_FAILED' });
      assert.equal((await request('producer', 'GET', url + '/preparation')).body.status, 'FAILED');
      assert.equal((await image('producer', url + '/slides/slide-001/full')).status, 409);
    } finally { await domain.pool.query('DROP TRIGGER reject_pdf_complete'); }
  });

  await t.test('preview detects changed SQL manifest and stored images instead of returning corrupt bytes', async () => {
    const [row] = await rows();
    const good = await sql('SELECT * FROM event_deck_preparations WHERE version_id=?', [version.id]);
    const original = good[0].manifest_json;
    await sql('UPDATE event_deck_preparations SET manifest_json=? WHERE version_id=?', ['{}', version.id]);
    try { assert.equal((await image('producer', ownPath + '/slides/slide-001/full')).status, 409); }
    finally { await sql('UPDATE event_deck_preparations SET manifest_json=? WHERE version_id=?', [original, version.id]); }
    const manifest = JSON.parse(original);
    const file = path.join(service.store.directory(manifest), manifest.slides[0].full.file);
    const bytes = await fs.readFile(file); await fs.chmod(file, 0o600); await fs.writeFile(file, 'CORRUPTED_PRIVATE_BYTES');
    try { const result = await image('producer', ownPath + '/slides/slide-001/full'); assert.equal(result.status, 409); assert.equal(result.bytes.includes('CORRUPTED_PRIVATE_BYTES'), false); }
    finally { await fs.writeFile(file, bytes); await fs.chmod(file, 0o400); }
    assert.ok(row);
  });

  await t.test('preparation SQL scope and result constraints survive repeatable migration with existing files', async () => {
    const v = await newVersion();
    const insert = (event, status) => sql(`INSERT INTO event_deck_preparations
      (version_id,event_id,deck_id,attempt_id,status,source_size,source_sha256) VALUES (?,?,?,?,?,1,?)`, [v.id, event, deck.id, crypto.randomUUID(), status, '0'.repeat(64)]);
    await assert.rejects(insert(b, 'PROCESSING'), { code: 'ER_NO_REFERENCED_ROW_2' });
    await assert.rejects(insert(a, 'READY')); await assert.rejects(insert(a, 'CONVERTED'));
    await sql("DELETE FROM schema_migrations WHERE id='044_event_deck_preparations.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['044_event_deck_preparations.sql']);
    assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    assert.equal((await image('producer', ownPath + '/slides/slide-002/thumb')).status, 200);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM event_deck_versions WHERE status <> 'DRAFT'"))[0].n, 0);
  });
}
module.exports = { deckPreparationSuite };
