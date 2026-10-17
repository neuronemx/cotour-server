const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const fail = (code, status = 409) => { throw new EventAccessError(code, status); };

class EventActivityDeckRepository {
  constructor({ domain, enabled = () => false }) { this.domain = domain; this.enabled = enabled; }

  checkEnabled() { if (!this.enabled()) fail('EVENTS_V2_DISABLED', 404); }

  async activity(db, actor, scope, writable = false) {
    this.checkEnabled();
    await this.domain.event(db, scope.organizationId, scope.eventId, actor, 'content.prepare');
    if (!isId(scope.activityId)) fail('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT a.id, a.status FROM event_activities a
      JOIN event_stages s ON s.id=a.event_stage_id AND s.event_workspace_id=a.event_workspace_id AND s.active=1
      WHERE a.id=? AND a.event_workspace_id=? FOR UPDATE`, [scope.activityId, scope.eventId]);
    const activity = rows[0];
    if (!activity) fail('RESOURCE_NOT_FOUND', 404);
    if (writable) {
      const [live] = await db.execute(`SELECT id FROM event_live_sessions
        WHERE event_workspace_id=? AND event_activity_id=? AND status='LIVE' FOR UPDATE`, [scope.eventId, scope.activityId]);
      if (activity.status !== 'SCHEDULED' || live.length) fail('ACTIVITY_NOT_EDITABLE');
    }
  }

  async row(db, scope) {
    const [rows] = await db.execute(`SELECT event_id AS eventId, activity_id AS activityId, deck_id AS deckId,
      version_id AS versionId, manifest_digest AS manifestDigest, slide_count AS slideCount, revision
      FROM event_activity_deck_bindings WHERE event_id=? AND activity_id=? FOR UPDATE`, [scope.eventId, scope.activityId]);
    return rows[0];
  }

  view(scope, row) {
    return { eventId: scope.eventId, activityId: scope.activityId, revision: row?.revision || 0,
      status: row?.versionId ? 'PENDING_DECK_CHECK' : 'UNBOUND',
      deckId: row?.deckId || null, versionId: row?.versionId || null,
      manifestDigest: row?.manifestDigest || null, slideCount: row?.slideCount || null };
  }

  async get(actor, scope) {
    return this.domain.transaction(actor, 'activity.deck.read', async db => {
      await this.activity(db, actor, scope);
      return this.view(scope, await this.row(db, scope));
    });
  }

  async set(actor, scope, { deckId, versionId, expectedRevision }, clear = false) {
    return this.domain.transaction(actor, clear ? 'activity.deck.clear' : 'activity.deck.bind', async db => {
      // Same organization lock as membership changes and Stage lifecycle.
      await this.activity(db, actor, scope, true);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 4294967295) fail('INVALID_REVISION', 400);
      const current = await this.row(db, scope);
      if ((current?.revision || 0) !== expectedRevision) fail('BINDING_REVISION_CONFLICT');
      if (expectedRevision === 4294967295) fail('BINDING_REVISION_LIMIT');
      let manifestDigest = null, slideCount = null;
      if (clear) { deckId = null; versionId = null; }
      else {
        if (!isId(deckId) || !isId(versionId)) fail('RESOURCE_NOT_FOUND', 404);
        const [versions] = await db.execute(`SELECT v.id, p.status, p.manifest_digest, p.slide_count
          FROM event_deck_versions v LEFT JOIN event_deck_preparations p
            ON p.version_id=v.id AND p.deck_id=v.deck_id AND p.event_id=v.event_id
          WHERE v.event_id=? AND v.deck_id=? AND v.id=? FOR UPDATE`, [scope.eventId, deckId, versionId]);
        if (!versions[0]) fail('RESOURCE_NOT_FOUND', 404);
        const preparation = versions[0];
        if (preparation.status !== 'CONVERTED' || !/^[a-f0-9]{64}$/.test(preparation.manifest_digest)
          || !Number.isInteger(preparation.slide_count) || preparation.slide_count < 1 || preparation.slide_count > 500) fail('PREPARATION_NOT_READY');
        manifestDigest = preparation.manifest_digest; slideCount = preparation.slide_count;
      }
      const revision = expectedRevision + 1;
      if (current) {
        const [updated] = await db.execute(`UPDATE event_activity_deck_bindings
          SET deck_id=?,version_id=?,manifest_digest=?,slide_count=?,revision=?,updated_by_user_id=?
          WHERE event_id=? AND activity_id=? AND revision=?`,
        [deckId, versionId, manifestDigest, slideCount, revision, actor, scope.eventId, scope.activityId, expectedRevision]);
        if (updated.affectedRows !== 1) fail('BINDING_REVISION_CONFLICT');
      } else {
        await db.execute(`INSERT INTO event_activity_deck_bindings
          (activity_id,event_id,deck_id,version_id,manifest_digest,slide_count,revision,updated_by_user_id)
          VALUES (?,?,?,?,?,?,?,?)`, [scope.activityId, scope.eventId, deckId, versionId, manifestDigest, slideCount, revision, actor]);
      }
      await this.domain.audit(db, actor, clear ? 'activity.deck.clear' : 'activity.deck.bind', scope.organizationId, scope.eventId, scope.activityId);
      this.checkEnabled();
      return this.view(scope, { deckId, versionId, manifestDigest, slideCount, revision });
    });
  }
}
module.exports = { EventActivityDeckRepository };
