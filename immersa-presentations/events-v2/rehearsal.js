const crypto = require('node:crypto');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');

const fail = (code, status = 403, revision) => { const e = new EventAccessError(code, status); if (Number.isSafeInteger(revision)) e.currentRevision = revision; throw e; };
const fingerprint = c => [c.scope.deckId, c.scope.versionId, c.binding.revision,
  c.snapshot.bundleDigest, c.row.approvalDigest].join(':');

// Private navigation only: no LiveSession, participant, engine or metrics row.
// Grant authorization and approval are resolved afresh on every operation.
class EventRehearsal {
  constructor({ grants, content, enabled = () => false, maxStates = 128, idleMs = 15 * 60 * 1000 }) {
    Object.assign(this, { grants, content, enabled, maxStates, idleMs });
    this.states = new Map(); this.queues = new Map();
  }
  check(context) {
    if (!this.enabled()) fail('EVENTS_V2_DISABLED', 404);
    if (context.kind !== 'SPEAKER' || context.purpose !== 'rehearsal'
      || !isId(context.activityId) || !isId(context.stageId)) fail('REHEARSAL_ACCESS_DENIED');
  }
  async candidate(context, db) {
    this.check(context);
    const [rows] = await db.execute(`SELECT a.id,a.title FROM event_activities a
      JOIN event_stages s ON s.id=a.event_stage_id AND s.event_workspace_id=a.event_workspace_id AND s.active=1
      WHERE a.id=? AND a.event_workspace_id=? AND a.event_stage_id=?`,
    [context.activityId, context.eventId, context.stageId]);
    if (!rows[0]) fail('RESOURCE_NOT_FOUND', 404);
    return { ...await this.content.candidate(db, context, rows[0]), title: rows[0].title };
  }
  key(c) { return c.eventId + ':' + c.grantId; }
  async serial(key, work) {
    const previous = this.queues.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(work); this.queues.set(key, pending);
    try { return await pending; } finally { if (this.queues.get(key) === pending) this.queues.delete(key); }
  }
  sweep() {
    const now = this.grants.now().getTime();
    for (const [key, value] of this.states) if (value.expires <= now) this.states.delete(key);
  }
  current(context, candidate) {
    const value = this.states.get(this.key(context));
    if (value && value.expires > this.grants.now().getTime()) {
      if (value.fingerprint !== fingerprint(candidate)) fail('REHEARSAL_VERSION_CHANGED', 409, value.revision);
      return value;
    }
    return null;
  }
  async operate(credentials, action = 'snapshot', input = {}) {
    return this.serial(this.key(credentials), async () => {
      this.sweep();
      let verified;
      const initial = await this.grants.withBrowser(credentials, async (context, db) => {
        const candidate = await this.candidate(context, db);
        const existing = action === 'reset' ? null : this.current(context, candidate);
        return { candidate, needsCheck: !existing };
      });
      if (initial.needsCheck) {
        const release = this.content.checks.acquire();
        try { await this.content.verify(initial.candidate); verified = fingerprint(initial.candidate); }
        finally { release(); }
      }
      const result = await this.grants.withBrowser(credentials, async (context, db) => {
        const candidate = await this.candidate(context, db);
        if (verified && verified !== fingerprint(candidate)) fail('REHEARSAL_VERSION_CHANGED', 409);
        const catalog = await this.content.slides(candidate), previous = action === 'reset'
          ? this.states.get(this.key(context)) : this.current(context, candidate);
        if (!['snapshot', 'next', 'prev', 'go', 'reset', 'language'].includes(action)) fail('INVALID_INPUT', 400);
        if (action !== 'snapshot' && (!Number.isSafeInteger(input.expectedRevision)
          || input.expectedRevision !== (previous?.revision || 0))) fail('REHEARSAL_REVISION_CONFLICT', 409, previous?.revision || 0);
        if (!previous && !verified) fail('REHEARSAL_EXPIRED', 409);
        if (!previous && this.states.size >= this.maxStates) fail('REHEARSAL_BUSY', 429);
        const next = previous && action !== 'reset' ? { ...previous } : {
          runId: crypto.randomUUID(), fingerprint: fingerprint(candidate), slideIndex: 0,
          language: catalog.presenterLanguage, revision: previous?.revision || 0 };
        if (action === 'go') {
          if (!Number.isSafeInteger(input.slideIndex) || input.slideIndex < 0 || input.slideIndex >= catalog.slides.length) fail('INVALID_INPUT', 400);
          next.slideIndex = input.slideIndex;
        }
        if (action === 'next' || action === 'prev') next.slideIndex = Math.max(0, Math.min(catalog.slides.length - 1, next.slideIndex + (action === 'next' ? 1 : -1)));
        if (action === 'language') {
          if (!['es', 'en'].includes(input.language) || (input.language === 'en' && !catalog.englishEnabled)) fail('INVALID_INPUT', 400);
          next.language = input.language;
        }
        if (action !== 'snapshot') next.revision++;
        next.expires = Math.min(Date.parse(context.expiresAt), this.grants.now().getTime() + this.idleMs);
        this.check(context);
        const variant = catalog.slides[next.slideIndex][next.language];
        const root = '/api/events-v2/rehearsal/' + context.eventId + '/' + context.grantId
          + '/slides/' + next.runId + '/' + catalog.digest + '/' + next.language + '/';
        return { key: this.key(context), state: Object.freeze(next), view: {
          mode: 'rehearsal', eventId: context.eventId, activityId: context.activityId,
          title: candidate.title, versionId: candidate.scope.versionId, runId: next.runId,
          revision: next.revision, slideIndex: next.slideIndex, slideCount: catalog.slides.length,
          language: next.language, englishEnabled: catalog.englishEnabled, notes: variant.notes,
          image: { url: root + next.slideIndex + '/full', width: variant.full.width, height: variant.full.height } } };
      });
      if (!this.enabled()) fail('EVENTS_V2_DISABLED', 404);
      this.sweep();
      if (!this.states.has(result.key) && this.states.size >= this.maxStates) fail('REHEARSAL_BUSY', 429);
      this.states.set(result.key, result.state);
      return result.view;
    });
  }
  async image(credentials, { runId, digest, language, index, variant }) {
    return this.serial(this.key(credentials), () => this.grants.withBrowser(credentials, async (context, db) => {
      const candidate = await this.candidate(context, db), state = this.current(context, candidate);
      if (!state || state.runId !== runId) fail('REHEARSAL_EXPIRED', 409);
      const catalog = await this.content.slides(candidate);
      if (catalog.digest !== digest || !['es', 'en'].includes(language) || (language === 'en' && !catalog.englishEnabled)
        || !Number.isSafeInteger(index) || index < 0 || index >= catalog.slides.length
        || !['full', 'thumb'].includes(variant)) fail('REHEARSAL_IMAGE_DENIED');
      const resource = catalog.slides[index][language][variant];
      const descriptor = await this.content.preparedImage(candidate, resource);
      this.check(context); return { descriptor, resource };
    }));
  }
}
module.exports = { EventRehearsal };
