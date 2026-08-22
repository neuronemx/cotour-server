const { createHash, randomUUID } = require("node:crypto");

const AUDIENCE_LEVELS = new Set(["FREE", "PAID"]);
const ACTIVITY_ACCESS_LEVELS = new Set(["FREE", "PAID"]);

class EventHubError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "EventHubError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new EventHubError("INVALID_INPUT", `${name} is required`);
  return normalized;
}

function slug(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,95}$/.test(normalized)) {
    throw new EventHubError("INVALID_SLUG", "Event slug is invalid");
  }
  return normalized;
}

function level(value, allowed = AUDIENCE_LEVELS) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!allowed.has(normalized)) throw new EventHubError("INVALID_ACCESS_LEVEL", "Access level is invalid");
  return normalized;
}

function registrationKeyHash(value) {
  return createHash("sha256").update(required(value, "registration key")).digest("hex");
}

function secretHash(value) {
  return createHash("sha256").update(required(value, "access secret")).digest("hex");
}

function canEnterActivity(audienceLevel, activityAccessLevel) {
  return level(audienceLevel) === "PAID" || level(activityAccessLevel, ACTIVITY_ACCESS_LEVELS) === "FREE";
}

async function transaction(pool, operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

class EventHubRepository {
  constructor(pool, options = {}) {
    if (!pool?.getConnection || !pool?.execute) throw new Error("A MySQL pool is required");
    this.pool = pool;
    this.createId = options.createId || randomUUID;
  }

  async createHub({ slug: requestedSlug, title, createdByUserId, stages = ["CCC", "Foro 2"] }) {
    const workspaceId = this.createId();
    const eventSlug = slug(requestedSlug);
    const normalizedStages = [...new Set((stages || []).map((name) => required(name, "stage name")))];
    if (!normalizedStages.length) throw new EventHubError("INVALID_INPUT", "At least one Event Stage is required");
    const [existingHubs] = await this.pool.execute("SELECT workspace_id FROM event_hubs WHERE slug = ? LIMIT 1", [eventSlug]);
    if (existingHubs?.[0]) {
      throw new EventHubError("EVENT_HUB_SLUG_EXISTS", "Ya existe un Event Hub con este identificador", 409);
    }
    return transaction(this.pool, async (connection) => {
      await connection.execute(
        "INSERT INTO workspaces (id, kind, personal_owner_user_id, plan) VALUES (?, 'event', NULL, 'FREE')",
        [workspaceId]
      );
      await connection.execute(
        "INSERT INTO event_hubs (workspace_id, slug, title, created_by_user_id) VALUES (?, ?, ?, ?)",
        [workspaceId, eventSlug, required(title, "title"), required(createdByUserId, "createdByUserId")]
      );
      for (const [index, name] of normalizedStages.entries()) {
        await connection.execute(
          "INSERT INTO event_stages (id, event_workspace_id, name, sort_order) VALUES (?, ?, ?, ?)",
          [this.createId(), workspaceId, name, index]
        );
      }
      for (const audienceLevel of ["FREE", "PAID"]) {
        await connection.execute(
          "INSERT INTO event_public_qrs (id, event_workspace_id, public_id, audience_level) VALUES (?, ?, ?, ?)",
          [this.createId(), workspaceId, `p_evt_${this.createId().replace(/-/g, "")}`, audienceLevel]
        );
      }
      return this.getHub(workspaceId, connection);
    });
  }

  async getHub(workspaceId, executor = this.pool) {
    const [hubs] = await executor.execute(
      "SELECT workspace_id, slug, title, timezone, status FROM event_hubs WHERE workspace_id = ? LIMIT 1",
      [required(workspaceId, "event workspace id")]
    );
    const hub = hubs?.[0];
    if (!hub) throw new EventHubError("EVENT_HUB_NOT_FOUND", "Event Hub not found", 404);
    const [stages] = await executor.execute(
      "SELECT id, name, audience_capacity, sort_order, active FROM event_stages WHERE event_workspace_id = ? ORDER BY sort_order, name",
      [hub.workspace_id]
    );
    const [qrs] = await executor.execute(
      "SELECT public_id, audience_level, active FROM event_public_qrs WHERE event_workspace_id = ? ORDER BY audience_level",
      [hub.workspace_id]
    );
    return { ...hub, stages: stages || [], publicQrs: qrs || [] };
  }

  async listHubs() {
    const [rows] = await this.pool.execute(
      "SELECT workspace_id, slug, title, timezone, status FROM event_hubs ORDER BY created_at DESC, title"
    );
    return rows || [];
  }

  async setStageCapacity({ eventStageId, audienceCapacity }) {
    const capacity = Number(audienceCapacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new EventHubError("INVALID_STAGE_CAPACITY", "Event Stage capacity must be at least 1");
    }
    const [result] = await this.pool.execute(
      "UPDATE event_stages SET audience_capacity = ? WHERE id = ? AND active = 1",
      [capacity, required(eventStageId, "event stage id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("EVENT_STAGE_NOT_FOUND", "Event Stage not found", 404);
    return { eventStageId, audienceCapacity: capacity };
  }

  async listActivities(eventWorkspaceId) {
    const [rows] = await this.pool.execute(
      `SELECT a.id, a.title, a.access_level, a.deck_id, a.status, a.duration_minutes,
              a.scheduled_starts_at, a.scheduled_ends_at,
              s.id AS event_stage_id, s.name AS stage_name
       FROM event_activities a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       WHERE a.event_workspace_id = ?
       ORDER BY a.scheduled_starts_at IS NULL, a.scheduled_starts_at, s.sort_order, a.title`,
      [required(eventWorkspaceId, "event workspace id")]
    );
    return rows || [];
  }

  async getLiveStageCapacityForDeck(deckId) {
    const normalizedDeckId = required(deckId, "deck id");
    const [rows] = await this.pool.execute(
      `SELECT s.id AS event_stage_id, s.audience_capacity
       FROM event_live_sessions l
       INNER JOIN event_stages s ON s.id = l.event_stage_id
       WHERE l.deck_id = ? AND l.status = 'LIVE'
       ORDER BY l.started_at DESC LIMIT 1`,
      [normalizedDeckId]
    );
    const row = rows?.[0];
    if (!row || !Number.isInteger(Number(row.audience_capacity)) || Number(row.audience_capacity) < 1) return null;
    return { eventStageId: row.event_stage_id, audienceCapacity: Number(row.audience_capacity) };
  }

  async getPublicQr(publicId) {
    const [rows] = await this.pool.execute(
      `SELECT q.public_id, q.audience_level, h.workspace_id, h.slug, h.title, h.status
       FROM event_public_qrs q
       INNER JOIN event_hubs h ON h.workspace_id = q.event_workspace_id
       WHERE q.public_id = ? AND q.active = 1 LIMIT 1`,
      [required(publicId, "public id")]
    );
    const qr = rows?.[0];
    if (!qr) throw new EventHubError("EVENT_QR_NOT_FOUND", "Event access link not found", 404);
    return {
      publicId: qr.public_id,
      audienceLevel: qr.audience_level,
      eventWorkspaceId: qr.workspace_id,
      slug: qr.slug,
      title: qr.title,
      status: qr.status
    };
  }

  async listPublicActivities({ eventWorkspaceId, audienceLevel }) {
    const viewerLevel = level(audienceLevel);
    const [rows] = await this.pool.execute(
      `SELECT a.id, a.title, a.access_level, a.status, s.id AS event_stage_id, s.name AS stage_name,
              l.id AS live_session_id, l.status AS live_status
       FROM event_activities a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       LEFT JOIN event_live_sessions l ON l.event_activity_id = a.id AND l.status = 'LIVE'
       WHERE a.event_workspace_id = ?
       ORDER BY a.scheduled_starts_at IS NULL, a.scheduled_starts_at, s.sort_order, a.title`,
      [required(eventWorkspaceId, "event workspace id")]
    );
    return (rows || []).map((activity) => ({
      id: activity.id,
      title: activity.title,
      accessLevel: activity.access_level,
      stage: { id: activity.event_stage_id, name: activity.stage_name },
      liveSessionId: activity.live_session_id || null,
      live: activity.live_status === "LIVE",
      canEnter: activity.live_status === "LIVE" && canEnterActivity(viewerLevel, activity.access_level)
    }));
  }

  async createActivity({ eventWorkspaceId, eventStageId, title, accessLevel = "PAID", deckId = null, scheduledStartsAt = null, durationMinutes = 60 }) {
    const id = this.createId();
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      throw new EventHubError("INVALID_ACTIVITY_DURATION", "Activity duration must be between 5 and 480 minutes");
    }
    await this.pool.execute(
      `INSERT INTO event_activities
       (id, event_workspace_id, event_stage_id, title, access_level, deck_id, scheduled_starts_at, scheduled_ends_at, duration_minutes)
       SELECT ?, ?, s.id, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(?, INTERVAL ? MINUTE) END, ? FROM event_stages s
       WHERE s.id = ? AND s.event_workspace_id = ? AND s.active = 1`,
      [id, required(eventWorkspaceId, "event workspace id"), required(title, "title"), level(accessLevel, ACTIVITY_ACCESS_LEVELS),
        deckId ? String(deckId) : null, scheduledStartsAt, scheduledStartsAt, scheduledStartsAt, duration, duration,
        required(eventStageId, "event stage id"), eventWorkspaceId]
    ).then(([result]) => {
      if (!Number(result?.affectedRows)) throw new EventHubError("EVENT_STAGE_NOT_FOUND", "Event Stage not found", 404);
    });
    return this.getActivity(id);
  }

  async grantStageOperatorAccess({ eventStageId, accessSecret, expiresAt = null }) {
    const id = this.createId();
    const [result] = await this.pool.execute(
      `INSERT INTO event_stage_operator_access (id, event_stage_id, access_secret_hash, expires_at)
       SELECT ?, s.id, ?, ? FROM event_stages s WHERE s.id = ? AND s.active = 1`,
      [id, secretHash(accessSecret), expiresAt, required(eventStageId, "event stage id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("EVENT_STAGE_NOT_FOUND", "Event Stage not found", 404);
    return { id, eventStageId, expiresAt };
  }

  async authorizeStageOperation({ eventStageId, accessSecret }) {
    const [rows] = await this.pool.execute(
      `SELECT a.id, a.event_stage_id
       FROM event_stage_operator_access a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       WHERE a.event_stage_id = ? AND a.access_secret_hash = ? AND a.revoked_at IS NULL
         AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(3)) AND s.active = 1
       LIMIT 1`,
      [required(eventStageId, "event stage id"), secretHash(accessSecret)]
    );
    if (!rows?.[0]) throw new EventHubError("EVENT_STAGE_ACCESS_DENIED", "Event Stage access is not valid", 403);
    return { stageAccessId: rows[0].id, eventStageId: rows[0].event_stage_id };
  }

  async getActivity(activityId, executor = this.pool) {
    const [rows] = await executor.execute(
      `SELECT a.id, a.event_workspace_id, a.event_stage_id, a.title, a.access_level, a.deck_id, a.status,
              s.name AS stage_name
       FROM event_activities a INNER JOIN event_stages s ON s.id = a.event_stage_id
       WHERE a.id = ? LIMIT 1`, [required(activityId, "activity id")]
    );
    if (!rows?.[0]) throw new EventHubError("ACTIVITY_NOT_FOUND", "Activity not found", 404);
    return rows[0];
  }

  async startLiveSession({ eventActivityId }) {
    return transaction(this.pool, async (connection) => {
      const activity = await this.getActivity(eventActivityId, connection);
      const [liveRows] = await connection.execute(
        "SELECT id FROM event_live_sessions WHERE event_stage_id = ? AND status = 'LIVE' LIMIT 1 FOR UPDATE",
        [activity.event_stage_id]
      );
      if (liveRows?.[0]) throw new EventHubError("STAGE_ALREADY_LIVE", "This Event Stage already has a LiveSession", 409);
      const id = this.createId();
      await connection.execute(
        "INSERT INTO event_live_sessions (id, event_workspace_id, event_activity_id, event_stage_id, deck_id) VALUES (?, ?, ?, ?, ?)",
        [id, activity.event_workspace_id, activity.id, activity.event_stage_id, activity.deck_id]
      );
      await connection.execute("UPDATE event_activities SET status = 'LIVE' WHERE id = ?", [activity.id]);
      return { id, eventWorkspaceId: activity.event_workspace_id, activityId: activity.id, stageId: activity.event_stage_id, deckId: activity.deck_id, status: "LIVE" };
    });
  }

  async finishLiveSession(liveSessionId) {
    return transaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(
        "SELECT id, event_activity_id FROM event_live_sessions WHERE id = ? AND status = 'LIVE' LIMIT 1 FOR UPDATE",
        [required(liveSessionId, "live session id")]
      );
      const liveSession = rows?.[0];
      if (!liveSession) throw new EventHubError("LIVE_SESSION_NOT_FOUND", "LiveSession not found", 404);
      await connection.execute("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [liveSession.id]);
      await connection.execute("UPDATE event_activities SET status = 'FINISHED' WHERE id = ?", [liveSession.event_activity_id]);
      return { id: liveSession.id, status: "FINISHED" };
    });
  }

  async getLiveSession(liveSessionId, executor = this.pool) {
    const [rows] = await executor.execute(
      "SELECT id, event_workspace_id, event_activity_id, event_stage_id, deck_id, status FROM event_live_sessions WHERE id = ? LIMIT 1",
      [required(liveSessionId, "live session id")]
    );
    if (!rows?.[0]) throw new EventHubError("LIVE_SESSION_NOT_FOUND", "LiveSession not found", 404);
    return rows[0];
  }

  async registerParticipant({ eventWorkspaceId, registrationKey, audienceLevel }) {
    const hubId = required(eventWorkspaceId, "event workspace id");
    const requestedLevel = level(audienceLevel);
    const hash = registrationKeyHash(registrationKey);
    return transaction(this.pool, async (connection) => {
      const [existing] = await connection.execute(
        "SELECT id, audience_level FROM event_participants WHERE event_workspace_id = ? AND registration_key_hash = ? LIMIT 1 FOR UPDATE",
        [hubId, hash]
      );
      let participant = existing?.[0];
      if (!participant) {
        participant = { id: this.createId(), audience_level: requestedLevel };
        await connection.execute(
          "INSERT INTO event_participants (id, event_workspace_id, registration_key_hash, audience_level) VALUES (?, ?, ?, ?)",
          [participant.id, hubId, hash, requestedLevel]
        );
      } else if (participant.audience_level === "FREE" && requestedLevel === "PAID") {
        participant.audience_level = "PAID";
        await connection.execute("UPDATE event_participants SET audience_level = 'PAID' WHERE id = ?", [participant.id]);
      }
      return { id: participant.id, eventWorkspaceId: hubId, audienceLevel: participant.audience_level };
    });
  }

  async admitParticipant({ eventLiveSessionId, eventParticipantId }) {
    return transaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT l.id, l.event_workspace_id, l.status, a.access_level, p.id AS participant_id, p.audience_level
         FROM event_live_sessions l
         INNER JOIN event_activities a ON a.id = l.event_activity_id
         INNER JOIN event_participants p ON p.id = ? AND p.event_workspace_id = l.event_workspace_id
         WHERE l.id = ? LIMIT 1 FOR UPDATE`,
        [required(eventParticipantId, "event participant id"), required(eventLiveSessionId, "live session id")]
      );
      const row = rows?.[0];
      if (!row) throw new EventHubError("LIVE_SESSION_NOT_FOUND", "LiveSession not found", 404);
      if (row.status !== "LIVE") throw new EventHubError("ACTIVITY_NOT_LIVE", "Activity is not live", 409);
      if (!canEnterActivity(row.audience_level, row.access_level)) throw new EventHubError("ACTIVITY_ACCESS_DENIED", "This activity is not included in your access", 403);
      await connection.execute(
        `INSERT INTO event_live_attendance (event_live_session_id, event_participant_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE last_joined_at = CURRENT_TIMESTAMP(3)`,
        [row.id, row.participant_id]
      );
      return { admitted: true, liveSessionId: row.id, participantId: row.participant_id };
    });
  }
}

module.exports = { EventHubRepository, EventHubError, AUDIENCE_LEVELS, ACTIVITY_ACCESS_LEVELS, canEnterActivity, registrationKeyHash, secretHash };
