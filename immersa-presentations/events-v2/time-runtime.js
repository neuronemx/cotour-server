const crypto = require('node:crypto');
const engine = require('../immersa-time-runtime');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const CONTROL_KINDS = Object.freeze(['STAGE', 'SPEAKER', 'PLAYER']);
const controls = context => CONTROL_KINDS.includes(context.kind);
const error = code => new EventAccessError(code, 403);
async function scope(live, context, db, liveId, preparedLive) {
  const prepared = preparedLive || await live.prepared(context, db, liveId);
  const key = executionKey(context.eventId, liveId), current = live.states.get(key);
  if (!current || ['eventId', 'liveSessionId', 'stageId', 'activityId', 'deckId', 'versionId', 'slideCount']
    .some(field => current[field] !== prepared[field])) throw error('CONTENT_VERSION_CHANGED');
  return { key, prepared };
}
function validateCommand(payload) {
  const { target, action } = payload;
  const permitted = target === 'speaker' ? ['start', 'stop', 'reset'] : target === 'screen' ? ['start', 'stop', 'resume', 'reset', 'hide'] : [];
  if (!permitted.includes(action) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw error('TIME_INVALID_COMMAND');
  const fields = ['target', 'action', 'expectedRevision'];
  if (target === 'screen' && action === 'start') {
    fields.push('mode');
    if (!['stopwatch', 'countdown', 'clock'].includes(payload.mode)) throw error('TIME_INVALID_COMMAND');
    if (payload.mode === 'countdown') {
      fields.push('hours', 'minutes', 'seconds');
      if (![['hours', 99], ['minutes', 59], ['seconds', 59]].every(([key, max]) => Number.isSafeInteger(payload[key]) && payload[key] >= 0 && payload[key] <= max)
        || payload.hours + payload.minutes + payload.seconds === 0) throw error('TIME_INVALID_COMMAND');
    }
  }
  if (Object.keys(payload).length !== fields.length || fields.some(field => !Object.hasOwn(payload, field))) throw error('TIME_INVALID_COMMAND');
}
class EventTimeRuntime {
  constructor({ liveRuntime, now = Date.now }) { this.live = liveRuntime; this.now = now; this.states = new Map(); }
  async prepared(context, db, liveId, preparedLive) {
    const scoped = await scope(this.live, context, db, liveId, preparedLive), state = this.states.get(scoped.key);
    if (state && ['stageId', 'activityId', 'deckId', 'versionId'].some(field => state.prepared[field] !== scoped.prepared[field])) throw error('CONTENT_VERSION_CHANGED');
    return scoped;
  }
  async operate(grants, credentials, liveId, payload) {
    const key = executionKey(credentials.eventId, liveId);
    return this.live.serial(key, async () => {
      const candidate = await grants.withSession(credentials, async (context, db) => {
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (!controls(context)) throw error('TIME_COMMAND_DENIED');
        validateCommand(payload);
        const { prepared } = await this.prepared(context, db, liveId);
        const state = structuredClone(this.states.get(key)?.state || engine.createImmersaTimeState());
        if (state.revision !== payload.expectedRevision) throw error('TIME_STALE_REVISION');
        const now = this.now();
        // Freeze an expired countdown before resume/reset; views already derive
        // zero from the server clock. No client timestamp can advance Time.
        if (state.screen.running && state.screen.mode === 'countdown' && !engine.snapshot(state, now).screen.running) {
          engine.applyCommand(state, { target: 'screen', action: 'stop' }, now);
        }
        const result = engine.applyCommand(state, payload, now);
        if (!result.changed) throw error('TIME_INVALID_STATE');
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        return { prepared, state, runId: this.states.get(key)?.runId || crypto.randomUUID() };
      });
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      this.states.set(key, candidate); return key;
    });
  }
  async projection(context, db, liveId, preparedLive) {
    const { key } = await this.prepared(context, db, liveId, preparedLive), current = this.states.get(key);
    const raw = engine.snapshot(current?.state || engine.createImmersaTimeState(), this.now());
    const result = { eventId: context.eventId, liveSessionId: liveId, revision: raw.revision, serverNow: raw.serverNow,
      timeRunId: current?.runId || null, screen: context.kind === 'PARTICIPANT' ? null : raw.screen };
    if (['STAGE', 'SPEAKER'].includes(context.kind)) result.speaker = raw.speaker;
    return result;
  }
}
module.exports = { EventTimeRuntime, CONTROL_KINDS, controls, scope, error, validateCommand };
