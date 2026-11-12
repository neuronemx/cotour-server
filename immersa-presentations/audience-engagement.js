const { participantIdFor } = require("./knowledge-activity-sockets");

class AudienceEngagementRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async session(deckId, sessionId) {
    const [rows] = await this.pool.execute(
      "SELECT id, engagement_started_at FROM presentation_sessions WHERE id = ? AND deck_id = ? AND recording_started_at IS NOT NULL",
      [sessionId, deckId]
    );
    return rows[0] || null;
  }

  async details(deckId, sessionId, { page = 0, brandId = "" } = {}) {
    const session = await this.session(deckId, sessionId);
    if (!session) return null;
    const offset = page * 100;
    const filter = brandId ? ` AND EXISTS (
      SELECT 1 FROM presentation_banner_views v JOIN presentation_banner_clicks c
        ON c.presentation_session_id = v.presentation_session_id AND c.display_id = v.display_id AND c.audience_id = v.audience_id
      WHERE v.presentation_session_id = a.presentation_session_id AND v.audience_id = a.audience_id AND v.brand_id = ?)` : "";
    const args = brandId ? [sessionId, brandId] : [sessionId];
    const [totals] = await this.pool.execute(
      "SELECT COUNT(*) AS total FROM presentation_session_attendance a WHERE a.presentation_session_id = ?" + filter, args
    );
    const [people] = await this.pool.execute(
      `SELECT a.audience_id, a.display_name, a.email, a.phone, a.company, a.locale, a.joined_at, a.terms_url, a.terms_accepted_at
       FROM presentation_session_attendance a WHERE a.presentation_session_id = ?${filter}
       ORDER BY a.joined_at, a.audience_id LIMIT 100 OFFSET ${offset}`, args
    );
    const [views] = await this.pool.execute(
      `SELECT brand_id, MAX(brand_name) AS brand_name, MAX(target_url) AS target_url,
              COUNT(*) AS impressions, COUNT(DISTINCT display_id) AS displays, COUNT(DISTINCT audience_id) AS viewers
       FROM presentation_banner_views WHERE presentation_session_id = ? GROUP BY brand_id`, [sessionId]
    );
    const [clickTotals] = await this.pool.execute(
      `SELECT v.brand_id, COUNT(*) AS clicks, COUNT(DISTINCT c.audience_id) AS clickers
       FROM presentation_banner_clicks c JOIN presentation_banner_views v
         ON v.presentation_session_id = c.presentation_session_id AND v.display_id = c.display_id AND v.audience_id = c.audience_id
       WHERE c.presentation_session_id = ? GROUP BY v.brand_id`, [sessionId]
    );
    const banners = views.map(row => {
      const clicks = clickTotals.find(c => c.brand_id === row.brand_id);
      return { id: row.brand_id, name: row.brand_name, url: row.target_url, displays: Number(row.displays),
        impressions: Number(row.impressions), viewers: Number(row.viewers), clicks: Number(clicks?.clicks || 0), clickers: Number(clicks?.clickers || 0) };
    });
    const attendees = people.map(row => ({
      id: row.audience_id, name: row.display_name, email: row.email, phone: row.phone, company: row.company,
      locale: row.locale, joinedAt: row.joined_at, termsUrl: row.terms_url, termsAcceptedAt: row.terms_accepted_at,
      answers: [], questions: [], reactions: { total: 0, byEmoji: {} }, banners: []
    }));
    if (!attendees.length) return { attendees, banners, total: Number(totals[0].total), page, recordedSince: session.engagement_started_at };
    const ids = attendees.map(p => p.id), slots = ids.map(() => "?").join(",");
    const [polls] = await this.pool.execute(
      `SELECT r.audience_id, r.submitted_at, e.id, e.title, e.prompt, o.label
       FROM presentation_poll_responses r JOIN presentation_poll_executions e ON e.id = r.poll_execution_id
       JOIN presentation_poll_options o ON o.poll_execution_id = r.poll_execution_id AND o.option_id = r.option_id
       WHERE e.presentation_session_id = ? AND r.audience_id IN (${slots}) ORDER BY r.submitted_at`, [sessionId, ...ids]
    );
    const [questions] = await this.pool.execute(
      `SELECT q.audience_id, q.question_text, q.created_at, q.projected_at FROM qna_questions q
       JOIN qna_rounds r ON r.id = q.qna_round_id
       WHERE r.presentation_session_id = ? AND q.audience_id IN (${slots}) ORDER BY q.created_at`, [sessionId, ...ids]
    );
    const [reactions] = await this.pool.execute(
      `SELECT audience_id, emoji, SUM(reaction_count) AS total FROM presentation_audience_reactions
       WHERE presentation_session_id = ? AND audience_id IN (${slots}) GROUP BY audience_id, emoji`, [sessionId, ...ids]
    );
    // Derivation is the same as the live answer handler, so earlier persisted activities can also be linked.
    const [executions] = await this.pool.execute(
      "SELECT id, title, category, snapshot_json FROM knowledge_activity_executions WHERE presentation_session_id = ?", [sessionId]
    );
    for (const execution of executions) {
      let snapshot = execution.snapshot_json;
      if (typeof snapshot === "string") snapshot = JSON.parse(snapshot);
      const participants = new Map(attendees.map(p => [participantIdFor(execution.id, p.id), p]));
      const participantIds = [...participants.keys()];
      const [answers] = await this.pool.execute(
        `SELECT participant_id, question_id, option_id, correct, received_at FROM knowledge_activity_answers
         WHERE execution_id = ? AND participant_id IN (${participantIds.map(() => "?").join(",")}) ORDER BY received_at`,
        [execution.id, ...participantIds]
      );
      for (const answer of answers) {
        const question = snapshot?.definition?.questions?.find(q => q.id === answer.question_id);
        const option = question?.options?.find(o => o.id === answer.option_id);
        participants.get(answer.participant_id)?.answers.push({
          type: execution.category, title: execution.title, question: question?.prompt || question?.text || answer.question_id,
          answer: option?.label || option?.text || answer.option_id, correct: Boolean(answer.correct), at: answer.received_at
        });
      }
    }
    const [bannerActivity] = await this.pool.execute(
      `SELECT v.audience_id, v.brand_id, MAX(v.brand_name) AS brand_name, COUNT(DISTINCT v.display_id) AS views,
              COUNT(c.event_id) AS clicks
       FROM presentation_banner_views v LEFT JOIN presentation_banner_clicks c
         ON c.presentation_session_id = v.presentation_session_id AND c.display_id = v.display_id AND c.audience_id = v.audience_id
       WHERE v.presentation_session_id = ? AND v.audience_id IN (${slots})
       GROUP BY v.audience_id, v.brand_id`, [sessionId, ...ids]
    );
    const byId = new Map(attendees.map(p => [p.id, p]));
    for (const poll of polls) byId.get(poll.audience_id)?.answers.push({
      type: "poll", title: poll.title, question: poll.prompt, answer: poll.label, at: poll.submitted_at
    });
    for (const q of questions) byId.get(q.audience_id)?.questions.push({
      text: q.question_text, at: q.created_at, projectedAt: q.projected_at
    });
    for (const r of reactions) {
      const attendee = byId.get(r.audience_id);
      attendee.reactions.byEmoji[r.emoji] = Number(r.total);
      attendee.reactions.total += Number(r.total);
    }
    for (const b of bannerActivity) byId.get(b.audience_id)?.banners.push({
      id: b.brand_id, name: b.brand_name, views: Number(b.views), clicks: Number(b.clicks)
    });
    for (const p of attendees) {
      p.answers.sort((a, b) => new Date(a.at) - new Date(b.at));
      p.actions = p.answers.length + p.questions.length + p.reactions.total + p.banners.reduce((n, b) => n + b.clicks, 0);
    }
    return { attendees, banners, total: Number(totals[0].total), page, recordedSince: session.engagement_started_at };
  }
}

function createEngagementHandler(repository) {
  return async (req, res) => {
    const page = Number(req.query.page || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return res.status(400).json({ error: "Página inválida." });
    try {
      res.set("Cache-Control", "no-store");
      const result = await repository.details(req.params.deckId, req.params.sessionId, { page, brandId: String(req.query.brandId || "").slice(0, 191) });
      if (!result) return res.status(404).json({ error: "Sesión no encontrada." });
      res.json(result);
    } catch (error) {
      console.error("Unable to load audience engagement", error);
      res.status(500).json({ error: "No se pudo cargar la participación por asistente." });
    }
  };
}

module.exports = { AudienceEngagementRepository, createEngagementHandler };
