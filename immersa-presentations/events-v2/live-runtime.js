const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { applyPresenterSlide } = require('../presentation-navigation');
const error = code => new EventAccessError(code, 403);
const executionKey = (eventId, liveId) => `evt:${eventId}:live:${liveId}`;
const control = context => ['STAGE', 'SPEAKER'].includes(context.kind);

class EventLiveRuntime {
  // No public deck fallback. Phase 2 supplies a private, versioned preparation
  // reader; this increment exercises that boundary with scoped test fixtures.
  constructor({ readPreparation = async () => null, enabled = () => true } = {}) {
    this.readPreparation = readPreparation;
    this.enabled = enabled;
    this.states = new Map();
    this.queues = new Map();
  }
  async resolve(context, db, liveId) {
    if (!isId(liveId) || !['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT'].includes(context.kind)
      || (context.kind === 'SPEAKER' && context.purpose !== 'live')) throw error('LIVE_ACCESS_DENIED');
    const [rows] = await db.execute(`SELECT l.id, l.deck_id, l.event_activity_id, l.event_stage_id, a.access_level
      FROM event_live_sessions l
      JOIN event_activities a ON a.id = l.event_activity_id AND a.event_workspace_id = l.event_workspace_id AND a.event_stage_id = l.event_stage_id
      JOIN event_stages s ON s.id = l.event_stage_id AND s.event_workspace_id = l.event_workspace_id AND s.active = 1
      WHERE l.id = ? AND l.event_workspace_id = ? AND l.status = 'LIVE' AND l.ended_at IS NULL`, [liveId, context.eventId]);
    const live = rows[0];
    if (!live || (context.stageId && context.stageId !== live.event_stage_id)
      || (context.activityId && context.activityId !== live.event_activity_id)
      || (context.liveSessionId && context.liveSessionId !== live.id)
      || !['FREE', 'PAID'].includes(live.access_level)
      || (context.kind === 'PARTICIPANT' && (context.audienceLevel !== 'PAID' && live.access_level !== 'FREE'))) throw error('LIVE_ACCESS_DENIED');
    return Object.freeze({ eventId: context.eventId, liveSessionId: live.id, activityId: live.event_activity_id,
      stageId: live.event_stage_id, deckId: live.deck_id });
  }
  async prepared(context, db, liveId) {
    const live = await this.resolve(context, db, liveId);
    const preparation = await this.readPreparation(live, db);
    if (!preparation || preparation.eventId !== live.eventId || preparation.liveSessionId !== live.liveSessionId
      || preparation.deckId !== live.deckId || typeof preparation.versionId !== 'string' || !preparation.versionId
      || !Number.isSafeInteger(preparation.slideCount) || preparation.slideCount < 1 || preparation.slideCount > 100000) {
      throw error('CONTENT_NOT_PREPARED');
    }
    return { ...live, versionId: preparation.versionId, slideCount: preparation.slideCount };
  }
  initial(preparation) {
    return Object.freeze({ ...preparation, presenterSlideIndex: 0, liveSlideIndex: 0, slideIndex: 0,
      transmissionPaused: false, transmissionPausedBy: null, revision: 0 });
  }
  async serial(key, callback) {
    const previous = this.queues.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(callback);
    this.queues.set(key, pending);
    try { return await pending; } finally { if (this.queues.get(key) === pending) this.queues.delete(key); }
  }
  async operate(grants, credentials, liveId, command = 'snapshot', payload = {}) {
    // Serializes one execution, including its DB authorization/commit. A failed
    // transaction never publishes a candidate or mutates the in-memory engine.
    const key = executionKey(credentials.eventId, liveId);
    return this.serial(key, async () => {
      const candidate = await grants.withSession(credentials, async (context, db) => {
        if (!this.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (command !== 'snapshot') {
          if (!['next', 'prev', 'go', 'pause', 'play'].includes(command)) throw error('COMMAND_NOT_ENABLED');
          if (!(control(context) || (context.kind === 'PLAYER' && ['next', 'prev'].includes(command)))) throw error('LIVE_COMMAND_DENIED');
        }
        const prepared = await this.prepared(context, db, liveId);
        const state = this.states.get(key) || this.initial(prepared);
        if (state.activityId !== prepared.activityId || state.stageId !== prepared.stageId || state.deckId !== prepared.deckId || state.versionId !== prepared.versionId || state.slideCount !== prepared.slideCount) throw error('CONTENT_VERSION_CHANGED');
        if (command === 'snapshot') return state;
        const next = { ...state };
        if (['next', 'prev', 'go'].includes(command)) {
          if (context.kind !== 'PLAYER' && state.transmissionPaused && state.transmissionPausedBy !== context.kind) throw error('LIVE_COMMAND_DENIED');
          if (command === 'go' && (!Number.isSafeInteger(payload.slideIndex) || payload.slideIndex < 0)) throw error('INVALID_COMMAND');
          applyPresenterSlide(next, command === 'go' ? payload.slideIndex : state.presenterSlideIndex + (command === 'next' ? 1 : -1));
        } else if (command === 'pause') {
          if (!state.transmissionPaused) { next.transmissionPaused = true; next.transmissionPausedBy = context.kind; }
        } else {
          next.transmissionPaused = false; next.transmissionPausedBy = null;
          next.liveSlideIndex = next.presenterSlideIndex;
        }
        next.revision++;
        return Object.freeze(next);
      });
      if (!this.enabled()) throw error('LIVE_ACCESS_DENIED');
      this.states.set(key, candidate);
      return key;
    });
  }
  async deliver(grants, credentials, liveId, emit) {
    // Never broadcast cached projections to a room. Every recipient must still
    // hold an active credential and current resource/access scope at send time.
    return grants.withSession(credentials, async (context, db) => {
      const prepared = await this.prepared(context, db, liveId);
      const state = this.states.get(executionKey(context.eventId, liveId));
      if (!state || state.activityId !== prepared.activityId || state.stageId !== prepared.stageId || state.versionId !== prepared.versionId || state.deckId !== prepared.deckId || state.slideCount !== prepared.slideCount) throw error('CONTENT_VERSION_CHANGED');
      const snapshot = { eventId: context.eventId, liveSessionId: liveId, revision: state.revision,
        slideIndex: state.liveSlideIndex, transmissionPaused: state.transmissionPaused };
      if (control(context)) Object.assign(snapshot, { presenterSlideIndex: state.presenterSlideIndex,
        liveSlideIndex: state.liveSlideIndex, slideCount: state.slideCount, transmissionPausedBy: state.transmissionPausedBy });
      return emit(Object.freeze(snapshot), context, db, prepared);
    });
  }
}
module.exports = { EventLiveRuntime, executionKey };
