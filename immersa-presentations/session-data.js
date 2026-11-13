const { createHash } = require("node:crypto");

class SessionDataRepository {
  constructor(pool, metrics, engagement) {
    this.pool = pool;
    this.metrics = metrics;
    this.engagement = engagement;
    this.rafflePending = new Map();
    this.raffleWinners = new Map();
    this.flushing = null;
  }

  captureRaffle(context, raffle) {
    if (!raffle) return;
    const snapshot = JSON.parse(JSON.stringify(raffle));
    const id = createHash("sha256").update([context.deckId, context.sessionId, raffle.id, raffle.createdAt].join("::")).digest("hex").slice(0, 32);
    const history = this.raffleWinners.get(id) || { sourceSessionId: context.sessionId, winners: new Map() };
    if (snapshot.winner && snapshot.winnerSelectedAt) {
      history.winners.set(snapshot.winnerSelectedAt + ":" + snapshot.winner.audienceId,
        {...snapshot.winner, selectedAt:snapshot.winnerSelectedAt});
    }
    snapshot.winners = [...history.winners.values()];
    this.raffleWinners.set(id, history);
    this.rafflePending.set(id, { context: { ...context }, snapshot });
  }

  flushRaffles() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.rafflePending.size) {
        for (const [id, pending] of this.rafflePending) {
          const sessionId = pending.context.presentationSessionId || await this.metrics.activeLiveSession(pending.context);
          if (!sessionId) {
            if (this.rafflePending.get(id) === pending) this.rafflePending.delete(id);
            continue;
          }
          await this.pool.execute(
            `INSERT INTO presentation_raffles (presentation_session_id, raffle_id, snapshot_json)
             VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE snapshot_json = VALUES(snapshot_json)`,
            [sessionId, id, JSON.stringify(pending.snapshot)]
          );
          if (this.rafflePending.get(id) === pending) this.rafflePending.delete(id);
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  releaseSession(context) {
    for (const [id, history] of this.raffleWinners) {
      if (history.sourceSessionId === context.sessionId) this.raffleWinners.delete(id);
    }
  }

  async raffles(sessionId) {
    const [rows] = await this.pool.execute("SELECT raffle_id, snapshot_json FROM presentation_raffles WHERE presentation_session_id = ?", [sessionId]);
    return rows.map(row => ({ ... (typeof row.snapshot_json === "string" ? JSON.parse(row.snapshot_json) : row.snapshot_json), executionId: row.raffle_id }));
  }

  async summary(deckId, sessionId) {
    const sessions = await this.metrics.listDeckSessions(deckId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;
    const [knowledge] = await this.pool.execute(
      `SELECT e.category, COUNT(DISTINCT e.id) AS executions, COUNT(a.question_id) AS answers
       FROM knowledge_activity_executions e LEFT JOIN knowledge_activity_answers a ON a.execution_id = e.id
       WHERE e.presentation_session_id = ? GROUP BY e.category`, [sessionId]
    );
    const [views] = await this.pool.execute(
      `SELECT brand_id AS id, MAX(brand_name) AS name, COUNT(DISTINCT display_id) AS displays,
              COUNT(*) AS impressions, COUNT(DISTINCT audience_id) AS viewers
       FROM presentation_banner_views WHERE presentation_session_id = ? GROUP BY brand_id`, [sessionId]
    );
    const [clicks] = await this.pool.execute(
      `SELECT v.brand_id, COUNT(*) AS clicks, COUNT(DISTINCT c.audience_id) AS clickers
       FROM presentation_banner_clicks c JOIN presentation_banner_views v
       ON v.presentation_session_id = c.presentation_session_id AND v.display_id = c.display_id AND v.audience_id = c.audience_id
       WHERE c.presentation_session_id = ? GROUP BY v.brand_id`, [sessionId]
    );
    const raffles = await this.raffles(sessionId);
    // Raffle entrants are combined with other activity using their existing audience IDs.
    const [engaged] = await this.pool.execute(
      `SELECT DISTINCT a.audience_id FROM presentation_session_attendance a WHERE a.presentation_session_id = ? AND (
       EXISTS (SELECT 1 FROM presentation_poll_responses r JOIN presentation_poll_executions e ON e.id=r.poll_execution_id WHERE e.presentation_session_id=? AND r.audience_id=a.audience_id)
       OR EXISTS (SELECT 1 FROM qna_questions q JOIN qna_rounds r ON r.id=q.qna_round_id WHERE r.presentation_session_id=? AND q.audience_id=a.audience_id)
       OR EXISTS (SELECT 1 FROM presentation_audience_reactions r WHERE r.presentation_session_id=? AND r.audience_id=a.audience_id AND r.reaction_count>0)
       OR EXISTS (SELECT 1 FROM presentation_banner_clicks c WHERE c.presentation_session_id=? AND c.audience_id=a.audience_id)
       OR EXISTS (SELECT 1 FROM knowledge_activity_executions e JOIN knowledge_activity_answers r ON r.execution_id=e.id
         WHERE e.presentation_session_id=? AND r.participant_id=LEFT(SHA2(CONCAT(e.id,'::',a.audience_id),256),36)))`,
      Array(6).fill(sessionId)
    );
    const ids = new Set(engaged.map(row => row.audience_id));
    for (const raffle of raffles) for (const entry of raffle.entries || []) ids.add(entry.audienceId);
    return {
      ...session, deckId, recordedSince: (await this.engagement.session(deckId, sessionId))?.engagement_started_at,
      participation: { active: ids.size, percentage: session.participants.connected ? Math.round(ids.size / session.participants.connected * 100) : 0 },
      knowledge: knowledge.map(row => ({ category: row.category, executions: Number(row.executions), answers: Number(row.answers) })),
      raffles: { total: raffles.length, entries: raffles.reduce((n, r) => n + (r.entries || []).length, 0), winners: raffles.reduce((n, r) => n + (r.winners || []).length, 0) },
      brands: views.map(v => {
        const click = clicks.find(c => c.brand_id === v.id);
        return { id: v.id, name: v.name, displays: Number(v.displays), impressions: Number(v.impressions), viewers: Number(v.viewers),
          clicks: Number(click?.clicks || 0), clickers: Number(click?.clickers || 0) };
      })
    };
  }
}
module.exports = { SessionDataRepository };
