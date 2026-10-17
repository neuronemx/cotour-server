const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runMigrations } = require('../../db/migrate');
const { LegacyEventBoundary } = require('../../events-v2/legacy-boundary');

async function decksSuite(t, f) {
  const { request, sql, domain, ids, o1, o2, a, b, c, boundary, perimeterDataDir, perimeterPublicDir } = f;
  const route = (event = a, org = o1) => `/api/events-v2/organizations/${org}/events/${event}/decks`;
  let deckA, deckB;

  await t.test('event Admin and Producer create owned draft Decks without personal workspace or activity links', async () => {
    const workspaces = (await sql('SELECT COUNT(*) AS n FROM workspaces'))[0].n;
    const first = await request('producer', 'POST', route(), { title: '  Deck del evento A  ' });
    const second = await request('dual', 'POST', route(b), { title: 'Deck del evento B' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    deckA = first.body; deckB = second.body;
    assert.equal(deckA.eventId, a); assert.equal(deckA.title, 'Deck del evento A');
    assert.equal(deckA.version.deckId, deckA.id); assert.equal(deckA.version.eventId, a);
    assert.equal(deckA.version.number, 1); assert.equal(deckA.version.status, 'DRAFT');
    assert.notEqual(deckA.id, deckB.id); assert.notEqual(deckA.version.id, deckB.version.id);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM workspaces'))[0].n, workspaces);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_activities WHERE deck_id=? OR pending_deck_id=?', [deckA.id, deckA.id]))[0].n, 0);
    assert.deepEqual((await sql('SELECT created_by_user_id FROM event_decks WHERE id=?', [deckA.id]))[0], { created_by_user_id: ids.get('producer') });
  });

  await t.test('Deck reads and version writes reject foreign scopes even for an actor assigned to both events', async () => {
    assert.deepEqual((await request('dual', 'GET', route())).body.decks.map(d => d.id), [deckA.id]);
    assert.deepEqual((await request('dual', 'GET', route(b))).body.decks.map(d => d.id), [deckB.id]);
    for (const actor of [null, 'platform', 'member', 'admin2']) {
      assert.equal((await request(actor, 'GET', route())).status, actor === null ? 401 : 404);
      assert.equal((await request(actor, 'POST', route(), { title: 'No access' })).status, actor === null ? 401 : 404);
    }
    for (const url of [`${route()}/${deckB.id}`, `${route(b)}/${deckA.id}`, `${route(c, o2)}/${deckA.id}`, `${route(a, o2)}/${deckA.id}`]) {
      assert.equal((await request('dual', 'GET', url)).status, 404);
      assert.equal((await request('dual', 'POST', url + '/versions', {})).status, 404);
    }
    const own = await request('producer', 'GET', `${route()}/${deckA.id}`);
    assert.equal(own.status, 200); assert.deepEqual(own.body.versions, [deckA.version]);
    for (const field of ['created_by_user_id', 'storagePath', 'media_url', 'ownerUserId']) assert.equal(JSON.stringify(own.body).includes(field), false);
  });

  await t.test('concurrent draft versions are numbered once each and preserve existing versions', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => request('producer', 'POST', `${route()}/${deckA.id}/versions`, {})));
    assert.ok(results.every(r => r.status === 201), JSON.stringify(results));
    assert.deepEqual(results.map(r => r.body.number).sort((x, y) => x - y), [2, 3, 4, 5]);
    assert.equal(new Set(results.map(r => r.body.id)).size, 4);
    const versions = (await request('producer', 'GET', `${route()}/${deckA.id}`)).body.versions;
    assert.equal(versions.length, 5); assert.deepEqual(versions[0], deckA.version);
    assert.ok(versions.every(v => v.status === 'DRAFT' && v.eventId === a && v.deckId === deckA.id));
  });

  await t.test('client-supplied identity, preparation state, fields and foreign origins cannot create versions', async () => {
    const before = (await sql('SELECT COUNT(*) AS n FROM event_deck_versions'))[0].n;
    for (const body of [{ eventId: b }, { deckId: deckB.id }, { number: 20 }, { status: 'READY' }, { storagePath: '/decks/public' }, []]) {
      assert.equal((await request('producer', 'POST', `${route()}/${deckA.id}/versions`, body)).status, 400);
    }
    assert.equal((await request('producer', 'POST', route(), { title: 'bad', ownerUserId: ids.get('admin1') })).status, 400);
    assert.equal((await request('producer', 'POST', route(), { title: '' })).status, 400);
    assert.equal((await request('producer', 'POST', route(), { title: 'x'.repeat(192) })).status, 400);
    for (const origin of ['', 'null', 'https://foreign.example']) {
      assert.equal((await request('producer', 'POST', `${route()}/${deckA.id}/versions`, {}, { origin })).status, 403);
    }
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_deck_versions'))[0].n, before);
  });

  await t.test('database constraints prevent cross-event versions, duplicate numbering and premature approval', async () => {
    const insert = (event, number, status = 'DRAFT') => sql(`INSERT INTO event_deck_versions
      (id,event_id,deck_id,version_number,status,created_by_user_id) VALUES (?,?,?,?,?,?)`, [crypto.randomUUID(), event, deckA.id, number, status, ids.get('producer')]);
    await assert.rejects(insert(b, 6), { code: 'ER_NO_REFERENCED_ROW_2' });
    await assert.rejects(insert(a, 1), { code: 'ER_DUP_ENTRY' });
    await assert.rejects(insert(a, 0)); await assert.rejects(insert(a, 6, 'READY'));
    assert.equal((await sql('SELECT COUNT(*) AS n FROM event_deck_versions WHERE deck_id=?', [deckA.id]))[0].n, 5);
  });

  await t.test('new unassigned Decks and version locators remain private through legacy HTTP and a new boundary instance with v2 off', async () => {
    const restarted = new LegacyEventBoundary(domain.pool);
    f.setDomainEnabled(false);
    try {
      assert.equal((await request('producer', 'GET', `${route()}/${deckA.id}`)).status, 404);
      for (const id of [deckA.id, deckA.version.id]) {
        for (const variant of [id, id.toUpperCase()]) {
          for (const root of [perimeterDataDir, path.join(perimeterPublicDir, 'decks')]) {
            const folder = path.join(root, variant); await fs.mkdir(folder, { recursive: true });
            await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ sentinel: 'PRIVATE_EVENT_DECK_BYTES' }));
          }
          assert.equal(await restarted.isV2('deck', variant), true);
          await assert.rejects(() => boundary.assertPresentation('unassigned', variant), { code: 'EVENT_V2_ACCESS_REQUIRED' });
          for (const url of [`/decks/${variant}/manifest.json`, `/API/DECKS/${variant}/interactions`, `/decks/%20${variant}%20/manifest.json`]) {
            const result = await request(null, 'GET', url); assert.equal(result.status, 404, url);
            assert.equal(JSON.stringify(result.body).includes('PRIVATE_EVENT_DECK_BYTES'), false);
          }
        }
      }
      assert.equal(await restarted.isV2('deck', 'personal-deck'), false);
    } finally { f.setDomainEnabled(true); }
  });

  await t.test('membership revocation denies the same account cookie and organization restore alone does not revive access', async () => {
    try {
      await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), null);
      assert.equal((await request('producer', 'GET', `${route()}/${deckA.id}`)).status, 404);
      assert.equal((await request('producer', 'POST', `${route()}/${deckA.id}/versions`, {})).status, 404);
      await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), ['PRODUCER']);
      await domain.setOrganizationMember(ids.get('admin1'), o1, ids.get('producer'), null);
      await domain.setOrganizationMember(ids.get('admin1'), o1, ids.get('producer'), 'MEMBER');
      assert.equal((await request('producer', 'GET', route())).status, 404);
    } finally { await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), ['PRODUCER']); }
    assert.equal((await request('producer', 'GET', `${route()}/${deckA.id}`)).status, 200);
  });

  await t.test('version insert failure rolls back the new Deck and does not report success or expose SQL', async () => {
    const before = (await sql('SELECT COUNT(*) AS n FROM event_decks'))[0].n;
    await sql("CREATE TRIGGER reject_event_draft BEFORE INSERT ON event_deck_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_INSERT_FAILURE'");
    try {
      const result = await request('producer', 'POST', route(), { title: 'must roll back' });
      assert.equal(result.status, 503); assert.deepEqual(result.body, { code: 'AUTHORIZATION_UNAVAILABLE' });
      assert.equal((await sql('SELECT COUNT(*) AS n FROM event_decks'))[0].n, before);
    } finally { await sql('DROP TRIGGER reject_event_draft'); }
  });

  await t.test('Deck metadata migration is repeatable with existing data and records audited creation', async () => {
    await sql("DELETE FROM schema_migrations WHERE id='043_event_decks.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['043_event_decks.sql']);
    assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    assert.equal((await request('producer', 'GET', `${route()}/${deckA.id}`)).body.versions.length, 5);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM event_security_audit WHERE event_id=? AND action='deck.create' AND resource_id=? AND outcome='ALLOWED'", [a, deckA.id]))[0].n, 1);
  });
}

module.exports = { decksSuite };
