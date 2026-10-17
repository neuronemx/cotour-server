const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventActivityDeckRepository } = require('../../events-v2/activity-deck-repository');
const { consoleTargets } = require('../../events-v2/console-http');
const { runMigrations } = require('../../db/migrate');
const { pdfFixture } = require('./events-v2-pdf-fixture');

async function activityDeckSuite(t, f) {
  const { request, sql, domain, ids, base, cookies, o1, o2, a, b, c, runtime, lifecycle, grants } = f;
  const stageA = crypto.randomUUID(), stageB = crypto.randomUUID();
  const activityA = crypto.randomUUID(), activityA2 = crypto.randomUUID(), activityA3 = crypto.randomUUID(), activityB = crypto.randomUUID();
  const allActivities = [activityA, activityA2, activityA3, activityB], ownDecks = [];
  const root = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const url = (activity = activityA, event = a, org = o1) => `/api/events-v2/organizations/${org}/events/${event}/activities/${activity}/deck-binding`;
  const current = async activity => (await request('producer', 'GET', url(activity))).body;
  const payload = (deck, expectedRevision, version = deck.version) => ({ deckId: deck.id, versionId: version.id, expectedRevision });
  let deckA, deckB, version2;
  async function newDeck(event = a) {
    const result = await request('dual', 'POST', root(event) + '/decks', { title: 'Activity binding fixture' });
    assert.equal(result.status, 201); ownDecks.push(result.body.id); return result.body;
  }
  async function newVersion(deck) {
    const result = await request('producer', 'POST', root(a) + `/decks/${deck.id}/versions`, {});
    assert.equal(result.status, 201); return result.body;
  }
  async function upload(deck, version, bytes = pdfFixture(), actor = 'dual', event = a) {
    const data = new FormData(); data.append('pdf', new Blob([bytes]), 'fixture.pdf');
    const response = await fetch(base + root(event) + `/decks/${deck.id}/versions/${version.id}/source`, {
      method: 'POST', headers: { origin: base, cookie: cookies.get(actor) }, body: data });
    const body = await response.json(); return { status: response.status, body };
  }
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageA, a, 'Binding A', stageB, b, 'Binding B']);
  for (const [id, event, stage] of [[activityA, a, stageA], [activityA2, a, stageA], [activityA3, a, stageA], [activityB, b, stageB]]) {
    await sql('INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title) VALUES (?,?,?,?)', [id, event, stage, 'Version binding']);
  }
  try {
    await t.test('converted event Deck version binds to multiple same-event activities without approval or legacy changes', async () => {
      deckA = await newDeck(); deckB = await newDeck(b);
      assert.equal((await upload(deckA, deckA.version)).status, 201);
      assert.equal((await upload(deckB, deckB.version, pdfFixture(), 'dual', b)).status, 201);
      const before = await current(activityA); assert.equal(before.status, 'UNBOUND'); assert.equal(before.revision, 0);
      for (const activity of [activityA, activityA2]) {
        const result = await request('producer', 'PUT', url(activity), payload(deckA, 0));
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.status, 'PENDING_DECK_CHECK'); assert.equal(result.body.revision, 1);
        assert.equal(result.body.versionId, deckA.version.id); assert.equal(result.body.slideCount, 2);
        assert.match(result.body.manifestDigest, /^[a-f0-9]{64}$/);
      }
      const [legacy] = await sql('SELECT deck_id,pending_deck_id,deck_check_status FROM event_activities WHERE id=?', [activityA]);
      assert.deepEqual(legacy, { deck_id: null, pending_deck_id: null, deck_check_status: 'PENDING' });
      assert.equal((await sql('SELECT status FROM event_deck_versions WHERE id=?', [deckA.version.id]))[0].status, 'DRAFT');
      const restarted = new EventActivityDeckRepository({ domain, enabled: () => true });
      assert.deepEqual(await restarted.get(ids.get('producer'), { organizationId: o1, eventId: a, activityId: activityA }), await current(activityA));
    });

    await t.test('new converted versions never silently move existing activity bindings', async () => {
      version2 = await newVersion(deckA); assert.equal((await upload(deckA, version2)).status, 201);
      assert.equal((await current(activityA)).versionId, deckA.version.id);
      const updated = await request('producer', 'PUT', url(), payload(deckA, 1, version2));
      assert.equal(updated.status, 200); assert.equal(updated.body.versionId, version2.id); assert.equal(updated.body.revision, 2);
      assert.equal((await current(activityA2)).versionId, deckA.version.id);
      assert.equal((await current(activityA2)).revision, 1);
    });

    await t.test('same-organization dual membership never authorizes cross-event activity/Deck/version substitution', async () => {
      const before = await current(activityA);
      for (const body of [payload(deckB, before.revision), { ...payload(deckA, before.revision), versionId: deckB.version.id },
        { ...payload(deckB, before.revision), versionId: version2.id }]) {
        assert.equal((await request('dual', 'PUT', url(), body)).status, 404);
      }
      for (const path of [url(activityB), url(activityA, b), url(activityA, c, o2), url(activityA, a, o2)]) {
        assert.equal((await request('dual', 'GET', path)).status, 404);
        assert.equal((await request('dual', 'PUT', path, payload(deckA, 0))).status, 404);
        assert.equal((await request('dual', 'DELETE', path, { expectedRevision: 0 })).status, 404);
      }
      assert.deepEqual(await current(activityA), before);
    });

    await t.test('missing/processing/failed preparations cannot bind, and clients cannot forge approval, identity or paths', async () => {
      const draft = await newVersion(deckA), failed = await newVersion(deckA), processing = await newVersion(deckA);
      assert.equal((await upload(deckA, failed, Buffer.from('%PDF- broken'))).status, 400);
      await sql(`INSERT INTO event_deck_preparations (version_id,event_id,deck_id,attempt_id,status,source_size,source_sha256)
        VALUES (?,?,?,?,'PROCESSING',1,?)`, [processing.id, a, deckA.id, crypto.randomUUID(), '0'.repeat(64)]);
      for (const version of [draft, failed, processing]) assert.equal((await request('producer', 'PUT', url(activityA3), payload(deckA, 0, version))).status, 409);
      for (const body of [{ ...payload(deckA, 0), approved: true }, { ...payload(deckA, 0), eventId: b },
        { ...payload(deckA, 0), manifestDigest: '0'.repeat(64) }, { ...payload(deckA, 0), storagePath: '/decks/public' }, []]) {
        assert.equal((await request('producer', 'PUT', url(activityA3), body)).status, 400);
      }
      for (const expectedRevision of [undefined, -1, 0.5, '0', true, 4294967296]) {
        const body = payload(deckA, expectedRevision); assert.equal((await request('producer', 'PUT', url(activityA3), body)).status, 400);
      }
      for (const origin of ['', 'null', 'https://foreign.example']) {
        assert.equal((await request('producer', 'PUT', url(activityA3), payload(deckA, 0), { origin })).status, 403);
        assert.equal((await request('producer', 'DELETE', url(activityA3), { expectedRevision: 0 }, { origin })).status, 403);
      }
      assert.equal((await request('producer', 'PUT', url(activityA3) + '?eventId=' + b, payload(deckA, 0))).status, 400);
      assert.equal((await current(activityA3)).revision, 0);
    });

    await t.test('concurrent operators use optimistic revisions and a loser cannot overwrite the winner', async () => {
      const before = await current(activityA);
      const results = await Promise.all([request('producer', 'PUT', url(), payload(deckA, before.revision)),
        request('dual', 'PUT', url(), payload(deckA, before.revision, version2))]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      const winner = results.find(r => r.status === 200).body;
      assert.deepEqual(await current(activityA), winner);
      const rejected = await request('producer', 'DELETE', url(), { expectedRevision: before.revision });
      assert.equal(rejected.status, 409); assert.equal(rejected.body.code, 'BINDING_REVISION_CONFLICT');
      assert.deepEqual(await current(activityA), winner);
    });

    await t.test('unlink keeps a durable revision tombstone and rejects delayed bind/unlink requests', async () => {
      const before = await current(activityA2);
      const cleared = await request('producer', 'DELETE', url(activityA2), { expectedRevision: before.revision });
      assert.equal(cleared.status, 200); assert.equal(cleared.body.status, 'UNBOUND'); assert.equal(cleared.body.revision, 2);
      assert.equal(cleared.body.versionId, null); assert.equal(cleared.body.manifestDigest, null);
      assert.equal((await request('producer', 'PUT', url(activityA2), payload(deckA, before.revision))).status, 409);
      assert.equal((await request('producer', 'DELETE', url(activityA2), { expectedRevision: before.revision })).status, 409);
      assert.equal((await sql('SELECT COUNT(*) AS n FROM event_activity_deck_bindings WHERE activity_id=?', [activityA2]))[0].n, 1);
      const recreated = await request('producer', 'PUT', url(activityA2), payload(deckA, 2, version2));
      assert.equal(recreated.status, 200); assert.equal(recreated.body.revision, 3);
    });

    await t.test('activity status and persisted live sessions block binding changes even if activity status is stale', async () => {
      const before = await current(activityA), liveId = crypto.randomUUID();
      await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [liveId, a, stageA, activityA, deckA.id]);
      try {
        for (const method of ['PUT', 'DELETE']) assert.equal((await request('producer', method, url(), method === 'PUT' ? payload(deckA, before.revision) : { expectedRevision: before.revision })).status, 409);
      } finally { await sql('DELETE FROM event_live_sessions WHERE id=?', [liveId]); }
      for (const status of ['LIVE', 'CANCELLED']) {
        await sql('UPDATE event_activities SET status=? WHERE id=?', [status, activityA]);
        try { assert.equal((await request('producer', 'PUT', url(), payload(deckA, before.revision))).status, 409); }
        finally { await sql("UPDATE event_activities SET status='SCHEDULED' WHERE id=?", [activityA]); }
      }
      assert.deepEqual(await current(activityA), before);
    });

    await t.test('binding and unlink tombstones never reuse legacy approval or an injected live preparation reader', async () => {
      for (const activity of [activityA, activityA2]) await sql("UPDATE event_activities SET deck_id=?,deck_check_status='DECK_CHECK' WHERE id=?", [deckA.id, activity]);
      const before = await current(activityA2);
      assert.equal((await request('producer', 'DELETE', url(activityA2), { expectedRevision: before.revision })).status, 200);
      const context = { eventId: a, stageId: stageA, organizationId: o1, actorId: ids.get('admin1'), kind: 'STAGE', purpose: 'live' };
      const targets = await domain.transaction(ids.get('admin1'), 'binding.fixture.targets', async db => {
        await domain.event(db, o1, a, ids.get('admin1')); return consoleTargets(grants, db, context);
      });
      assert.ok(targets.filter(x => [activityA, activityA2].includes(x.activityId)).every(x => x.canStart === false));
      const reader = runtime.readPreparation; let reads = 0;
      runtime.readPreparation = async live => { reads++; return { ...live, versionId: 'forged-approval', slideCount: 2 }; };
      const states = runtime.states.size;
      try {
        for (const activity of [activityA, activityA2]) await assert.rejects(lifecycle.start({ eventId: a }, activity, operation =>
          domain.transaction(ids.get('admin1'), 'binding.fixture.start', async db => {
            await domain.event(db, o1, a, ids.get('admin1')); return operation(context, db);
          })), { code: 'CONTENT_NOT_PREPARED' });
        assert.equal(reads, 0); assert.equal(runtime.states.size, states);
        assert.equal((await sql('SELECT COUNT(*) AS n FROM event_live_sessions WHERE event_stage_id=?', [stageA]))[0].n, 0);
      } finally { runtime.readPreparation = reader; }
    });

    await t.test('current membership, event suspension and the kill switch govern persisted binding reads and writes', async () => {
      for (const actor of [null, 'platform', 'member', 'admin2']) {
        const status = actor === null ? 401 : 404;
        assert.equal((await request(actor, 'GET', url())).status, status);
        assert.equal((await request(actor, 'PUT', url(), payload(deckA, 0))).status, status);
      }
      await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), null);
      try { assert.equal((await request('producer', 'GET', url())).status, 404); assert.equal((await request('producer', 'DELETE', url(), { expectedRevision: 0 })).status, 404); }
      finally { await domain.setEventMember(ids.get('admin1'), o1, a, ids.get('producer'), ['PRODUCER']); }
      await sql('UPDATE event_v2_contexts SET enabled=0 WHERE event_id=?', [a]);
      try { assert.equal((await request('producer', 'GET', url())).status, 404); }
      finally { await sql('UPDATE event_v2_contexts SET enabled=1 WHERE event_id=?', [a]); }
      f.setDomainEnabled(false);
      try { assert.equal((await request('producer', 'GET', url())).status, 404); assert.equal((await request('producer', 'PUT', url(), payload(deckA, 0))).status, 404); }
      finally { f.setDomainEnabled(true); }
    });

    await t.test('audit failure after a binding write rolls back both revision and content without leaking SQL', async () => {
      const before = await current(activityA);
      const auditBefore = (await sql("SELECT COUNT(*) AS n FROM event_security_audit WHERE event_id=? AND action='activity.deck.bind' AND outcome='ALLOWED'", [a]))[0].n;
      await domain.pool.query("CREATE TRIGGER reject_binding_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='activity.deck.bind' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_BINDING_SQL_FAILURE'; END IF; END");
      try {
        const result = await request('producer', 'PUT', url(), payload(deckA, before.revision, version2));
        assert.equal(result.status, 503); assert.deepEqual(result.body, { code: 'AUTHORIZATION_UNAVAILABLE' });
        assert.deepEqual(await current(activityA), before);
        assert.equal((await sql("SELECT COUNT(*) AS n FROM event_security_audit WHERE event_id=? AND action='activity.deck.bind' AND outcome='ALLOWED'", [a]))[0].n, auditBefore);
      } finally { await domain.pool.query('DROP TRIGGER reject_binding_audit'); }
    });

    await t.test('composite SQL constraints reject foreign activity/version scope and migration recovers after partial DDL', async () => {
      const insert = (activity, event, deckId, versionId, revision = 1) => sql(`INSERT INTO event_activity_deck_bindings
        (activity_id,event_id,deck_id,version_id,manifest_digest,slide_count,revision,updated_by_user_id) VALUES (?,?,?,?,?,2,?,?)`,
      [activity, event, deckId, versionId, '0'.repeat(64), revision, ids.get('producer')]);
      await assert.rejects(insert(activityB, a, deckA.id, version2.id), { code: 'ER_NO_REFERENCED_ROW_2' });
      await assert.rejects(insert(activityA3, b, deckB.id, deckB.version.id), { code: 'ER_NO_REFERENCED_ROW_2' });
      await assert.rejects(insert(activityA3, a, deckB.id, deckB.version.id), { code: 'ER_NO_REFERENCED_ROW_2' });
      await assert.rejects(insert(activityA3, a, deckA.id, version2.id, 0));
      await assert.rejects(insert(activityA3, a, null, version2.id));
      await sql("DELETE FROM schema_migrations WHERE id='045_event_activity_deck_bindings.sql'");
      assert.deepEqual((await runMigrations(domain.pool)).executed, ['045_event_activity_deck_bindings.sql']);
      assert.deepEqual((await runMigrations(domain.pool)).executed, []);
      assert.equal((await current(activityA)).status, 'PENDING_DECK_CHECK');
      assert.equal((await sql("SELECT COUNT(*) AS n FROM event_deck_versions WHERE status<>'DRAFT'"))[0].n, 0);
    });
  } finally {
    for (const id of allActivities) await sql('DELETE FROM event_activity_deck_bindings WHERE activity_id=?', [id]);
    for (const id of allActivities) await sql('DELETE FROM event_live_sessions WHERE event_activity_id=?', [id]);
    for (const id of allActivities) await sql('DELETE FROM event_activities WHERE id=?', [id]);
    for (const id of [stageA, stageB]) await sql('DELETE FROM event_stages WHERE id=?', [id]);
    for (const id of ownDecks) {
      await sql('DELETE FROM event_deck_preparations WHERE deck_id=?', [id]);
      await sql('DELETE FROM event_deck_versions WHERE deck_id=?', [id]);
      await sql('DELETE FROM event_decks WHERE id=?', [id]);
    }
  }
}
module.exports = { activityDeckSuite };
