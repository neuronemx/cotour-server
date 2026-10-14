const crypto = require('node:crypto');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { executionKey } = require('./live-runtime');

const fail = (code, status = 409) => { throw new EventAccessError(code, status); };
const view = row => Object.freeze({ eventId: row.event_workspace_id, liveSessionId: row.id,
  stageId: row.event_stage_id, activityId: row.event_activity_id, status: row.status,
  startedAt: row.started_at.toISOString(), endedAt: row.ended_at?.toISOString() || null });

class EventLifecycle {
  constructor({ grants, runtime, engines = [] }) {
    this.grants = grants; this.runtime = runtime; this.engines = engines;
  }
  check(context) {
    if (!this.runtime.enabled()) fail('EVENTS_V2_DISABLED', 404);
    if (context.kind !== 'STAGE' || context.purpose !== 'live' || !isId(context.stageId)) fail('LIFECYCLE_COMMAND_DENIED', 403);
  }
  async activity(context, db, activityId) {
    if (!isId(activityId)) fail('INVALID_INPUT', 400);
    const [rows] = await db.execute(`SELECT a.* FROM event_activities a
      JOIN event_stages s ON s.id=a.event_stage_id AND s.event_workspace_id=a.event_workspace_id AND s.active=1
      WHERE a.id=? AND a.event_workspace_id=? AND a.event_stage_id=? FOR UPDATE`, [activityId, context.eventId, context.stageId]);
    if (!rows[0]) fail('RESOURCE_NOT_FOUND', 404);
    return rows[0];
  }
  async live(context, db, liveId) {
    if (!isId(liveId)) fail('INVALID_INPUT', 400);
    const [rows] = await db.execute(`SELECT l.* FROM event_live_sessions l
      JOIN event_activities a ON a.id=l.event_activity_id AND a.event_workspace_id=l.event_workspace_id AND a.event_stage_id=l.event_stage_id
      JOIN event_stages s ON s.id=l.event_stage_id AND s.event_workspace_id=l.event_workspace_id AND s.active=1
      WHERE l.id=? AND l.event_workspace_id=? AND l.event_stage_id=? FOR UPDATE`, [liveId, context.eventId, context.stageId]);
    if (!rows[0]) fail('RESOURCE_NOT_FOUND', 404);
    return rows[0];
  }
  async current(credentials, authorize) {
    const result = await authorize(async (context, db) => {
      this.check(context);
      const [rows] = await db.execute("SELECT id FROM event_live_sessions WHERE event_stage_id=? AND status='LIVE' FOR UPDATE", [context.stageId]);
      if (rows.length > 1) fail('LIFECYCLE_STATE_INVALID');
      const row = rows[0] && await this.live(context, db, rows[0].id);
      if (row?.ended_at) fail('LIFECYCLE_STATE_INVALID');
      return { eventId: context.eventId, stageId: context.stageId, liveSession: row ? view(row) : null };
    });
    if (!this.runtime.enabled()) fail('EVENTS_V2_DISABLED', 404);
    return result;
  }
  async start(credentials, activityId, authorize) {
    // Serialize installation against finish/commands for this new execution.
    // The organization lock prevents competing starts on the same Stage.
    const id = crypto.randomUUID();
    return this.runtime.serial(executionKey(credentials.eventId, id), async () => {
      const candidate = await authorize(async (context, db) => {
        this.check(context);
        const activity = await this.activity(context, db, activityId);
        const [active] = await db.execute("SELECT id FROM event_live_sessions WHERE event_stage_id=? AND status='LIVE' FOR UPDATE", [context.stageId]);
        if (active.length || activity.status !== 'SCHEDULED') fail('STAGE_ALREADY_LIVE');
        if (!activity.deck_id || activity.deck_check_status !== 'DECK_CHECK') fail('CONTENT_NOT_PREPARED', 403);
        const now = this.grants.now();
        await db.execute(`INSERT INTO event_live_sessions (id,event_workspace_id,event_activity_id,event_stage_id,deck_id,started_at)
          VALUES (?,?,?,?,?,?)`, [id, context.eventId, activity.id, context.stageId, activity.deck_id, now]);
        // Private preparation is checked on the same connection. Missing
        // Phase 2 reader rolls the candidate back; no personal/pending fallback.
        const prepared = await this.runtime.prepared(context, db, id);
        await db.execute("UPDATE event_activities SET status='LIVE' WHERE id=? AND event_workspace_id=?", [activity.id, context.eventId]);
        await this.grants.domain.audit(db, context.actorId, 'live.start', context.organizationId, context.eventId, id);
        this.check(context);
        return { state: this.runtime.initial(prepared), result: view({ id, event_workspace_id: context.eventId,
          event_activity_id: activity.id, event_stage_id: context.stageId, status: 'LIVE', started_at: now, ended_at: null }) };
      });
      if (!this.runtime.enabled()) fail('EVENTS_V2_DISABLED', 404);
      this.runtime.states.set(executionKey(candidate.result.eventId, candidate.result.liveSessionId), candidate.state);
      return candidate.result;
    });
  }
  discard(key) {
    this.runtime.states.delete(key);
    for (const engine of this.engines) {
      const timer = engine.timers?.get(key);
      if (timer !== undefined) engine.clearTimeoutFn(timer);
      engine.timers?.delete(key); engine.witnesses?.delete(key); engine.states?.delete(key);
    }
  }
  async finish(credentials, liveId, authorize) {
    if (!isId(liveId)) fail('INVALID_INPUT', 400);
    const key = executionKey(credentials.eventId, liveId);
    return this.runtime.serial(key, async () => {
      const result = await authorize(async (context, db) => {
        this.check(context);
        const row = await this.live(context, db, liveId);
        if (row.status === 'FINISHED' && row.ended_at) return view(row);
        if (row.status !== 'LIVE' || row.ended_at) fail('LIFECYCLE_STATE_INVALID');
        const now = this.grants.now();
        await db.execute("UPDATE event_live_sessions SET status='FINISHED', ended_at=? WHERE id=? AND event_workspace_id=?", [now, liveId, context.eventId]);
        await db.execute("UPDATE event_activities SET status='SCHEDULED' WHERE id=? AND event_workspace_id=?", [row.event_activity_id, context.eventId]);
        await this.grants.domain.audit(db, context.actorId, 'live.finish', context.organizationId, context.eventId, liveId);
        this.check(context);
        return view({ ...row, status: 'FINISHED', ended_at: now });
      });
      // Cleanup is after commit even if the public flag was turned off while
      // committing. No persisted history is deleted or synthesized.
      this.discard(key);
      if (!this.runtime.enabled()) fail('EVENTS_V2_DISABLED', 404);
      return result;
    });
  }
  session(credentials) { return operation => this.grants.withSession(credentials, operation); }
  browser(credentials) { return operation => this.grants.withBrowser(credentials, operation); }
}
module.exports = { EventLifecycle };
