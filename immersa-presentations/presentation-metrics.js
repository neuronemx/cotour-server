const { randomUUID } = require("node:crypto");

function text(value) {
  return String(value || "").trim();
}

function date(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

class PresentationMetricsRepository {
  constructor(pool, options = {}) {
    if (!pool?.execute) throw new Error("A MySQL pool is required for presentation metrics");
    this.pool = pool;
    this.createId = options.createId || randomUUID;
  }

  async activeLiveSession({ deckId, sourceSessionId }) {
    const [rows] = await this.pool.execute(
      `SELECT id
       FROM presentation_sessions
       WHERE deck_id = ? AND source_session_id = ?
         AND recording_started_at IS NOT NULL AND ended_at IS NULL
       ORDER BY recording_started_at DESC, id DESC
       LIMIT 1`,
      [text(deckId), text(sourceSessionId)]
    );
    return rows?.[0]?.id ? String(rows[0].id) : null;
  }

  async recordAudienceSnapshot({ presentationSessionId, audience = [], connectedCount = 0 }) {
    const sessionId = text(presentationSessionId);
    if (!sessionId) return;
    const audienceIds = [...new Set((audience || []).map((item) => text(item?.audienceId || item)).filter(Boolean))];
    if (audienceIds.length) {
      const placeholders = audienceIds.map(() => "(?, ?)").join(", ");
      await this.pool.execute(
        `INSERT IGNORE INTO presentation_session_attendance (presentation_session_id, audience_id)
         VALUES ${placeholders}`,
        audienceIds.flatMap((audienceId) => [sessionId, audienceId])
      );
    }
    await this.pool.execute(
      `UPDATE presentation_sessions
       SET audience_peak_count = GREATEST(audience_peak_count, ?)
       WHERE id = ?`,
      [Math.max(Number(connectedCount) || 0, audienceIds.length), sessionId]
    );
  }

  async recordAudienceConnection(context, audience, connectedCount) {
    const presentationSessionId = await this.activeLiveSession(context);
    if (!presentationSessionId) return false;
    await this.recordAudienceSnapshot({ presentationSessionId, audience: [audience], connectedCount });
    return true;
  }

  async ensurePollExecution(presentationSessionId, active) {
    if (!presentationSessionId || !active?.id || !active?.launchedAt) return null;
    const executionId = this.createId();
    const launchedAt = date(active.launchedAt);
    await this.pool.execute(
      `INSERT INTO presentation_poll_executions
         (id, presentation_session_id, interaction_id, title, prompt, launched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), prompt = VALUES(prompt)`,
      [executionId, presentationSessionId, text(active.id), text(active.title) || "Encuesta", text(active.prompt) || "Encuesta", launchedAt]
    );
    const [rows] = await this.pool.execute(
      `SELECT id FROM presentation_poll_executions
       WHERE presentation_session_id = ? AND interaction_id = ? AND launched_at = ?
       LIMIT 1`,
      [presentationSessionId, text(active.id), launchedAt]
    );
    return rows?.[0]?.id ? String(rows[0].id) : null;
  }

  async recordPollSnapshot({ presentationSessionId, snapshot, closedAt = null }) {
    const active = snapshot?.active;
    if (!active) return false;
    const executionId = await this.ensurePollExecution(text(presentationSessionId), active);
    if (!executionId) return false;
    for (const [index, option] of (active.options || []).entries()) {
      if (!option?.id) continue;
      await this.pool.execute(
        `INSERT INTO presentation_poll_options (poll_execution_id, option_id, label, sort_order)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order)`,
        [executionId, text(option.id), text(option.label), index]
      );
    }
    for (const response of snapshot.responses || []) {
      if (!response?.audienceId || !response?.optionId) continue;
      await this.pool.execute(
        `INSERT INTO presentation_poll_responses
           (poll_execution_id, audience_id, option_id, submitted_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE option_id = VALUES(option_id), submitted_at = VALUES(submitted_at)`,
        [executionId, text(response.audienceId), text(response.optionId), date(response.submittedAt)]
      );
    }
    if (closedAt) {
      await this.pool.execute(
        `UPDATE presentation_poll_executions
         SET closed_at = COALESCE(closed_at, ?)
         WHERE id = ?`,
        [date(closedAt), executionId]
      );
    }
    return true;
  }

  async recordPollForContext(context, snapshot, closedAt = null) {
    const presentationSessionId = await this.activeLiveSession(context);
    if (!presentationSessionId) return false;
    return this.recordPollSnapshot({ presentationSessionId, snapshot, closedAt });
  }

  async listDeckSessions(deckId) {
    const [sessionRows] = await this.pool.execute(
      `SELECT ps.id, ps.source_session_id, ps.recording_started_at, ps.ended_at,
              TIMESTAMPDIFF(SECOND, ps.recording_started_at, COALESCE(ps.ended_at, CURRENT_TIMESTAMP(3))) AS duration_seconds,
              ps.audience_peak_count,
              COUNT(DISTINCT psa.audience_id) AS participant_count
       FROM presentation_sessions ps
       LEFT JOIN presentation_session_attendance psa ON psa.presentation_session_id = ps.id
       WHERE ps.deck_id = ? AND ps.recording_started_at IS NOT NULL
       GROUP BY ps.id, ps.source_session_id, ps.recording_started_at, ps.ended_at, ps.audience_peak_count
       ORDER BY ps.recording_started_at DESC, ps.id DESC
       LIMIT 100`,
      [text(deckId)]
    );
    if (!sessionRows.length) return [];
    const sessionIds = sessionRows.map((row) => String(row.id));
    const placeholders = sessionIds.map(() => "?").join(",");
    const [pollRows] = await this.pool.execute(
      `SELECT pe.id, pe.presentation_session_id, pe.interaction_id, pe.title, pe.prompt,
              pe.launched_at, pe.closed_at, po.option_id, po.label, po.sort_order,
              COUNT(pr.audience_id) AS response_count
       FROM presentation_poll_executions pe
       INNER JOIN presentation_poll_options po ON po.poll_execution_id = pe.id
       LEFT JOIN presentation_poll_responses pr
         ON pr.poll_execution_id = po.poll_execution_id AND pr.option_id = po.option_id
       WHERE pe.presentation_session_id IN (${placeholders})
       GROUP BY pe.id, pe.presentation_session_id, pe.interaction_id, pe.title, pe.prompt,
                pe.launched_at, pe.closed_at, po.option_id, po.label, po.sort_order
       ORDER BY pe.launched_at, pe.id, po.sort_order`,
      sessionIds
    );
    const [qnaRows] = await this.pool.execute(
      `SELECT qr.presentation_session_id,
              COUNT(q.id) AS questions_received,
              COUNT(q.projected_at) AS questions_projected
       FROM qna_rounds qr
       LEFT JOIN qna_questions q ON q.qna_round_id = qr.id
       WHERE qr.presentation_session_id IN (${placeholders})
       GROUP BY qr.presentation_session_id`,
      sessionIds
    );
    const pollsBySession = new Map();
    for (const row of pollRows || []) {
      const sessionId = String(row.presentation_session_id);
      if (!pollsBySession.has(sessionId)) pollsBySession.set(sessionId, new Map());
      const sessionPolls = pollsBySession.get(sessionId);
      const pollId = String(row.id);
      if (!sessionPolls.has(pollId)) sessionPolls.set(pollId, {
        id: pollId,
        interactionId: String(row.interaction_id),
        title: row.title,
        prompt: row.prompt,
        launchedAt: row.launched_at,
        closedAt: row.closed_at,
        totalResponses: 0,
        options: []
      });
      const poll = sessionPolls.get(pollId);
      const count = Number(row.response_count || 0);
      poll.totalResponses += count;
      poll.options.push({ id: String(row.option_id), label: row.label, count });
    }
    const qnaBySession = new Map((qnaRows || []).map((row) => [String(row.presentation_session_id), {
      received: Number(row.questions_received || 0),
      projected: Number(row.questions_projected || 0)
    }]));
    return sessionRows.map((row) => ({
      id: String(row.id),
      sourceSessionId: String(row.source_session_id),
      startedAt: row.recording_started_at,
      endedAt: row.ended_at,
      durationSeconds: Number(row.duration_seconds || 0),
      participants: {
        connected: Number(row.participant_count || 0),
        peak: Number(row.audience_peak_count || 0)
      },
      polls: Array.from(pollsBySession.get(String(row.id))?.values() || []).map((poll) => ({
        ...poll,
        options: poll.options.map((option) => ({
          ...option,
          percentage: poll.totalResponses ? Math.round((option.count / poll.totalResponses) * 100) : 0
        }))
      })),
      qna: qnaBySession.get(String(row.id)) || { received: 0, projected: 0 }
    }));
  }
}

function createPresentationMetricsHandlers(repository) {
  return {
    async listDeckSessions(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        res.json({ sessions: await repository.listDeckSessions(req.params.deckId) });
      } catch (error) {
        console.error("Unable to load presentation metrics", error);
        res.status(500).json({ error: "No se pudieron cargar las métricas" });
      }
    }
  };
}

module.exports = { PresentationMetricsRepository, createPresentationMetricsHandlers };
