const crypto = require('node:crypto');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { EventDeckPrivateStore, MAX_SOURCE_BYTES, digest } = require('./deck-private-store');

class EventDeckPreparationService {
  constructor({ domain, enabled = () => false, root, forbiddenRoots, store, basePreparations = null }) {
    this.domain = domain;
    this.enabled = enabled;
    this.store = store || new EventDeckPrivateStore({ root, forbiddenRoots });
    this.uploads = 0;
    this.base = basePreparations;
    this.table = this.base ? 'event_deck_translations' : 'event_deck_preparations';
    this.action = this.base ? 'deck.translation' : 'deck.source';
  }

  checkEnabled() {
    if (!this.enabled()) throw new EventAccessError('EVENTS_V2_DISABLED', 404);
  }

  async scoped(db, actor, scope, writable = false) {
    this.checkEnabled();
    const { organizationId, eventId, deckId, versionId } = scope;
    await this.domain.event(db, organizationId, eventId, actor, 'content.prepare');
    if (!isId(deckId) || !isId(versionId)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT id FROM event_deck_versions
      WHERE event_id=? AND deck_id=? AND id=? AND status='DRAFT' FOR UPDATE`, [eventId, deckId, versionId]);
    if (!rows[0]) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    if (this.base) {
      await this.baseSource(db, scope);
      if (writable) {
        const [sealed] = await db.execute('SELECT version_id FROM event_deck_configurations WHERE version_id=?', [versionId]);
        if (sealed.length) throw new EventAccessError('VERSION_CONFIGURATION_EXISTS', 409);
      }
    }
  }

  async baseSource(db, scope) {
    const row = await this.base.row(db, scope);
    if (!row || row.status !== 'CONVERTED' || !/^[a-f0-9]{64}$/.test(row.manifestDigest || '')
      || row.slideCount < 1 || row.slideCount > 500 || digest(row.manifestJson) !== row.manifestDigest) {
      throw new EventAccessError('PREPARATION_NOT_READY', 409);
    }
    return row;
  }

  async authorize(actor, scope) {
    return this.domain.transaction(actor, this.action + '.authorize', db => this.scoped(db, actor, scope, true));
  }

  // Bound memory and concurrent Poppler work within each instance. SQL's
  // unique version key remains the cross-instance duplicate-upload authority.
  acquireUpload() {
    const budget = this.base || this;
    if (budget.uploads >= 2) throw new EventAccessError('PDF_PREPARATION_BUSY', 429);
    budget.uploads++;
    let released = false;
    return () => { if (!released) { released = true; budget.uploads--; } };
  }

  async row(db, scope) {
    const [rows] = await db.execute(`SELECT event_id AS eventId, deck_id AS deckId, version_id AS versionId,
      attempt_id AS attemptId, status, source_size AS sourceSize, source_sha256 AS sourceSha256,
      slide_count AS slideCount, manifest_digest AS manifestDigest, manifest_json AS manifestJson,
      error_code AS errorCode${this.base ? ',base_manifest_digest AS baseManifestDigest' : ''} FROM ${this.table} WHERE event_id=? AND deck_id=? AND version_id=?`,
    [scope.eventId, scope.deckId, scope.versionId]);
    return rows[0];
  }

  metadata(row) {
    if (!row) return { status: 'NOT_UPLOADED', ...(this.base ? { language: 'en' } : {}) };
    return { status: row.status, sourceSize: row.sourceSize, slideCount: row.slideCount,
      manifestDigest: row.manifestDigest, errorCode: row.errorCode,
      ...(this.base ? { language: 'en', baseManifestDigest: row.baseManifestDigest } : {}) };
  }

  async get(actor, scope) {
    return this.domain.transaction(actor, this.action + '.read', async db => {
      await this.scoped(db, actor, scope);
      const row = await this.row(db, scope);
      if (this.base && row && row.baseManifestDigest !== (await this.baseSource(db, scope)).manifestDigest) throw new EventAccessError('SOURCE_VERSION_CHANGED', 409);
      this.checkEnabled(); return this.metadata(row);
    });
  }

  async upload(actor, scope, bytes) {
    await this.authorize(actor, scope);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new EventAccessError('INVALID_PDF_SIZE', 413);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new EventAccessError('INVALID_PDF', 400);
    const attemptId = crypto.randomUUID();
    let baseSource;
    await this.domain.transaction(actor, this.action + '.reserve', async db => {
      await this.scoped(db, actor, scope, true);
      if (await this.row(db, scope)) throw new EventAccessError(this.base ? 'VERSION_TRANSLATION_EXISTS' : 'VERSION_SOURCE_EXISTS', 409);
      if (this.base) baseSource = await this.baseSource(db, scope);
      await db.execute(`INSERT INTO ${this.table}
        (version_id,event_id,deck_id,attempt_id,status,source_size,source_sha256${this.base ? ',base_manifest_digest' : ''}) VALUES (?,?,?,?,'PROCESSING',?,?${this.base ? ',?' : ''})`,
      [scope.versionId, scope.eventId, scope.deckId, attemptId, bytes.length, digest(bytes), ...(this.base ? [baseSource.manifestDigest] : [])]);
      await this.domain.audit(db, actor, this.action + '.reserve', scope.organizationId, scope.eventId, scope.versionId);
      this.checkEnabled();
    });
    try {
      // Conversion runs outside SQL locks. Current membership and the kill
      // switch must still permit the final commit, even after a long render.
      const result = await this.store.prepare({ eventId: scope.eventId, deckId: scope.deckId, versionId: scope.versionId, attemptId }, bytes, this.base ? { expectedSlideCount: baseSource.slideCount } : undefined);
      if (this.base && result.slideCount !== baseSource.slideCount) throw new EventAccessError('LOCALE_SLIDE_COUNT_MISMATCH', 422);
      return await this.domain.transaction(actor, this.action + '.complete', async db => {
        await this.scoped(db, actor, scope, true);
        if (this.base && (await this.baseSource(db, scope)).manifestDigest !== baseSource.manifestDigest) throw new EventAccessError('SOURCE_VERSION_CHANGED', 409);
        const [update] = await db.execute(`UPDATE ${this.table} SET status='CONVERTED',
          slide_count=?,manifest_digest=?,manifest_json=?,completed_at=CURRENT_TIMESTAMP(3)
          WHERE event_id=? AND deck_id=? AND version_id=? AND attempt_id=? AND status='PROCESSING'`,
        [result.slideCount, result.digest, result.json, scope.eventId, scope.deckId, scope.versionId, attemptId]);
        if (update.affectedRows !== 1) throw new EventAccessError('PREPARATION_CONFLICT', 409);
        await this.domain.audit(db, actor, this.action + '.complete', scope.organizationId, scope.eventId, scope.versionId);
        this.checkEnabled(); return this.metadata(await this.row(db, scope));
      });
    } catch (error) {
      const code = error instanceof EventAccessError ? error.code : 'PDF_CONVERSION_FAILED';
      // Conditional worker bookkeeping cannot publish files or downgrade a
      // committed conversion. Retain private bytes on ambiguous commit errors.
      await this.domain.pool.execute(`UPDATE ${this.table} SET status='FAILED',error_code=?,completed_at=CURRENT_TIMESTAMP(3)
        WHERE version_id=? AND attempt_id=? AND status='PROCESSING'`, [code, scope.versionId, attemptId]).catch(() => {});
      if (error instanceof EventAccessError) throw error;
      throw new EventAccessError('PDF_CONVERSION_FAILED', 503);
    }
  }

  async image(actor, scope, slideId, variant) {
    const row = await this.domain.transaction(actor, this.action + '.image', async db => {
      await this.scoped(db, actor, scope);
      const row = await this.row(db, scope);
      if (!row || row.status !== 'CONVERTED') throw new EventAccessError('PREPARATION_NOT_READY', 409);
      if (this.base && row.baseManifestDigest !== (await this.baseSource(db, scope)).manifestDigest) throw new EventAccessError('SOURCE_VERSION_CHANGED', 409);
      this.checkEnabled(); return row;
    });
    return this.store.image(row, slideId, variant);
  }
}

module.exports = { EventDeckPreparationService };
