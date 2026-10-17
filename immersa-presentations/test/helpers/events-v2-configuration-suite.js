const assert = require('node:assert/strict');
const { EventDeckConfigurationService } = require('../../events-v2/deck-configuration');
const { pdfFixture } = require('./events-v2-pdf-fixture');
const { configurationFixture } = require('./events-v2-configuration-fixture');
const { runMigrations } = require('../../db/migrate');
async function configurationSuite(t, f) {
  const { request, sql, domain, ids, cookies, base, o1, o2, a, b, deckPreparations } = f;
  const own = []; let deck, other, version2, sealed;
  const root = (event = a, org = o1) => `/api/events-v2/organizations/${org}/events/${event}/decks`;
  const url = (d = deck, v = d.version, event = a, org = o1) => root(event, org) + `/${d.id}/versions/${v.id}/configuration`;
  const service = new EventDeckConfigurationService({ preparations: deckPreparations });
  const scope = v => ({ organizationId: o1, eventId: a, deckId: deck.id, versionId: v.id });
  async function create(event = a) { const r = await request('dual', 'POST', root(event), { title: 'Authored configuration' }); assert.equal(r.status, 201); own.push(r.body.id); return r.body; }
  async function version() { const r = await request('producer', 'POST', root() + `/${deck.id}/versions`, {}); assert.equal(r.status, 201); return r.body; }
  async function convert(d = deck, v = d.version, event = a) {
    const body = new FormData(); body.append('pdf', new Blob([pdfFixture()]), 'fixture.pdf');
    const r = await fetch(base + root(event) + `/${d.id}/versions/${v.id}/source`, { method: 'POST', headers: { origin: base, cookie: cookies.get('dual') }, body });
    assert.equal(r.status, 201, await r.text());
  }
  try {
    await t.test('configuration seals server-owned PDF fingerprint, private notes and normalized catalogs without approving or starting live', async () => {
      deck = await create(); other = await create(b); await convert(); await convert(other, other.version, b);
      assert.deepEqual((await request('producer', 'GET', url())).body, { status: 'NOT_CONFIGURED' });
      const r = await request('producer', 'POST', url(), configurationFixture()); assert.equal(r.status, 201, JSON.stringify(r.body)); sealed = r.body;
      assert.equal(sealed.status, 'CONFIGURED_PENDING_DECK_CHECK'); assert.match(sealed.configurationDigest, /^[a-f0-9]{64}$/);
      const source = (await sql('SELECT manifest_digest FROM event_deck_preparations WHERE version_id=?', [deck.version.id]))[0];
      assert.equal(sealed.configuration.sourceManifestDigest, source.manifest_digest); assert.equal(sealed.configuration.eventId, a);
      assert.equal(sealed.configuration.slides[0].notes.es, configurationFixture().slides[0].notes.es);
      assert.equal(sealed.configuration.knowledge[0].questions[0].correctOptionId, 'a');
      assert.equal(JSON.stringify(sealed).includes('/decks/'), false);
      assert.deepEqual((await request('producer', 'GET', url())).body, sealed);
      const restarted = new EventDeckConfigurationService({ preparations: deckPreparations });
      assert.deepEqual(await restarted.get(ids.get('producer'), scope(deck.version)), sealed);
      assert.equal((await sql('SELECT status FROM event_deck_versions WHERE id=?', [deck.version.id]))[0].status, 'DRAFT');
      assert.equal((await sql('SELECT COUNT(*) n FROM event_activity_deck_bindings WHERE deck_id=?', [deck.id]))[0].n, 0);
    });
    await t.test('immutable configurations require a new converted version; competing writers have exactly one durable winner', async () => {
      assert.equal((await request('producer', 'POST', url(), configurationFixture())).body.code, 'VERSION_CONFIGURATION_EXISTS');
      version2 = await version();
      assert.equal((await request('producer', 'POST', url(deck, version2), configurationFixture())).body.code, 'PREPARATION_NOT_READY');
      await convert(deck, version2);
      const left = configurationFixture(), right = configurationFixture(); right.slides[0].notes.es = 'Other operator';
      const results = await Promise.all([request('producer', 'POST', url(deck, version2), left), request('dual', 'POST', url(deck, version2), right)]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      assert.deepEqual((await request('producer', 'GET', url(deck, version2))).body, results.find(r => r.status === 201).body);
      assert.deepEqual((await request('producer', 'GET', url())).body, sealed);
      for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await request('producer', method, url(), configurationFixture())).status, 404);
    });
    await t.test('current account permissions and composite event/version scope protect notes and correct answers', async () => {
      for (const actor of [null, 'platform', 'member', 'admin2']) {
        assert.equal((await request(actor, 'GET', url())).status, actor === null ? 401 : 404);
        assert.equal((await request(actor, 'POST', url(), configurationFixture())).status, actor === null ? 401 : 404);
      }
      for (const path of [url(deck, other.version), url(other, other.version), url(deck, deck.version, b), url(deck, deck.version, a, o2)]) {
        assert.equal((await request('dual', 'GET', path)).status, 404);
        assert.equal((await request('dual', 'POST', path, configurationFixture())).status, 404);
      }
      await sql("UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?", [a, ids.get('producer')]);
      try { assert.equal((await request('producer', 'GET', url())).status, 404); }
      finally { await sql("UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?", [a, ids.get('producer')]); }
      assert.deepEqual((await request('producer', 'GET', url())).body, sealed);
    });
    await t.test('origin, unknown fields, query injection, byte limits and live flag fail closed without persisting configuration', async () => {
      const v = await version(); await convert(deck, v);
      for (const origin of ['', 'null', 'https://foreign.example']) assert.equal((await request('producer', 'POST', url(deck, v), configurationFixture(), { origin })).status, 403);
      assert.equal((await request('producer', 'POST', url(deck, v) + '?approved=true', configurationFixture())).status, 400);
      assert.equal((await request('producer', 'GET', url() + '?eventId=' + b)).status, 400);
      for (const edit of [x => { x.approved = true; }, x => { x.slides[0].full = '/decks/personal'; }, x => { x.knowledge[0].questions[0].image = 'foreign'; }]) {
        const input = configurationFixture(); edit(input); assert.equal((await request('producer', 'POST', url(deck, v), input)).status, 400);
      }
      const huge = configurationFixture(); huge.slides[0].notes.es = 'x'.repeat(1048576);
      assert.equal((await request('producer', 'POST', url(deck, v), huge)).status, 413);
      f.setDomainEnabled(false);
      try {
        assert.equal((await request('producer', 'GET', url())).body.code, 'EVENTS_V2_DISABLED');
        await assert.rejects(service.create(ids.get('producer'), scope(v), configurationFixture()), { code: 'EVENTS_V2_DISABLED' });
      } finally { f.setDomainEnabled(true); }
      assert.deepEqual((await request('producer', 'GET', url(deck, v))).body, { status: 'NOT_CONFIGURED' });
    });
    await t.test('tampered configuration or changed source fingerprint is never returned as prepared content', async () => {
      const [row] = await sql('SELECT configuration_json,configuration_digest FROM event_deck_configurations WHERE version_id=?', [deck.version.id]);
      const changed = JSON.parse(row.configuration_json); changed.slides[0].notes.es = 'Tampered';
      await sql('UPDATE event_deck_configurations SET configuration_json=? WHERE version_id=?', [JSON.stringify(changed), deck.version.id]);
      try { const r = await request('producer', 'GET', url()); assert.equal(r.status, 409); assert.equal(r.body.code, 'CONFIGURATION_INTEGRITY_FAILED'); assert.equal(JSON.stringify(r.body).includes('Tampered'), false); }
      finally { await sql('UPDATE event_deck_configurations SET configuration_json=? WHERE version_id=?', [row.configuration_json, deck.version.id]); }
      const [source] = await sql('SELECT manifest_digest FROM event_deck_preparations WHERE version_id=?', [deck.version.id]);
      await sql('UPDATE event_deck_preparations SET manifest_digest=? WHERE version_id=?', ['0'.repeat(64), deck.version.id]);
      try { assert.equal((await request('producer', 'GET', url())).body.code, 'CONFIGURATION_INTEGRITY_FAILED'); }
      finally { await sql('UPDATE event_deck_preparations SET manifest_digest=? WHERE version_id=?', [source.manifest_digest, deck.version.id]); }
      assert.deepEqual((await request('producer', 'GET', url())).body, sealed);
    });
    await t.test('configuration and audit commit atomically; SQL details stay private and migration reruns with data', async () => {
      const v = await version(); await convert(deck, v);
      await domain.pool.query("CREATE TRIGGER reject_configuration_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='deck.configuration.create' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_CONFIGURATION_SQL_FAILURE'; END IF; END");
      try { const r = await request('producer', 'POST', url(deck, v), configurationFixture()); assert.equal(r.status, 503); assert.deepEqual(r.body, { code: 'AUTHORIZATION_UNAVAILABLE' }); }
      finally { await domain.pool.query('DROP TRIGGER reject_configuration_audit'); }
      assert.deepEqual((await request('producer', 'GET', url(deck, v))).body, { status: 'NOT_CONFIGURED' });
      await sql("DELETE FROM schema_migrations WHERE id='046_event_deck_configurations.sql'");
      assert.deepEqual((await runMigrations(domain.pool)).executed, ['046_event_deck_configurations.sql']);
      assert.deepEqual((await request('producer', 'GET', url())).body, sealed);
      const [stored] = await sql('SELECT event_id,deck_id,source_manifest_digest,configuration_digest,configuration_json,created_by_user_id FROM event_deck_configurations WHERE version_id=?', [deck.version.id]);
      await assert.rejects(sql(`INSERT INTO event_deck_configurations (version_id,event_id,deck_id,source_manifest_digest,configuration_digest,configuration_json,created_by_user_id) VALUES (?,?,?,?,?,?,?)`,
        [v.id, b, deck.id, stored.source_manifest_digest, stored.configuration_digest, stored.configuration_json, stored.created_by_user_id]), e => !!e.code);
    });
  } finally {
    await domain.pool.query('DROP TRIGGER IF EXISTS reject_configuration_audit');
    for (const id of own) {
      await sql('DELETE FROM event_deck_configurations WHERE deck_id=?', [id]);
      await sql('DELETE FROM event_deck_preparations WHERE deck_id=?', [id]);
      await sql('DELETE FROM event_deck_versions WHERE deck_id=?', [id]);
      await sql('DELETE FROM event_decks WHERE id=?', [id]);
    }
  }
}
module.exports = { configurationSuite };
