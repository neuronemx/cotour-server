const { createHash, randomUUID } = require("node:crypto");

const AUDIENCE_LEVELS = new Set(["FREE", "PAID"]);
const ACTIVITY_ACCESS_LEVELS = new Set(["FREE", "PAID"]);
const ACTIVITY_TYPES = new Set(["CONFERENCE", "ROUND_TABLE", "WORKSHOP", "MASTER_CLASS", "PANEL", "OTHER"]);

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

function activityType(value) {
  const normalized = String(value || "CONFERENCE").trim().toUpperCase();
  if (!ACTIVITY_TYPES.has(normalized)) throw new EventHubError("INVALID_ACTIVITY_TYPE", "Activity type is invalid");
  return normalized;
}

function optionalText(value, name, limit) {
  const normalized = String(value || "").trim();
  if (normalized.length > limit) throw new EventHubError("INVALID_INPUT", `${name} is too long`);
  return normalized;
}

function publicSpeakerPhotoUrl({ photoKey, authImage, manualPhotoUrl }) {
  const key = String(photoKey || "").trim();
  if (/^profile-[a-f0-9-]+\.(?:png|jpg|webp)$/i.test(key)) return `/profile-images/${encodeURIComponent(key)}`;
  const accountImage = String(authImage || "").trim();
  if (/^https:\/\//i.test(accountImage)) return accountImage;
  const manualPhoto = String(manualPhotoUrl || "").trim();
  return /^https:\/\//i.test(manualPhoto) ? manualPhoto : "";
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

  async createHub({ slug: requestedSlug, title, createdByUserId, stages = ["CCC Sala THX", "CHURUBUSCO Foro NELA", "CHURUBUSCO Foro A", "CHURUBUSCO Foro 2", "CHURUBUSCO Lobby"] }) {
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
          "INSERT INTO event_stages (id, event_workspace_id, name, sort_order, audience_capacity) VALUES (?, ?, ?, ?, 300)",
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
      `SELECT a.id, a.title, a.activity_type, a.access_level, a.deck_id, a.pending_deck_id, a.deck_check_status, a.status, a.duration_minutes,
              a.scheduled_starts_at, a.scheduled_ends_at,
              s.id AS event_stage_id, s.name AS stage_name
       FROM event_activities a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       WHERE a.event_workspace_id = ?
       ORDER BY a.scheduled_starts_at IS NULL, a.scheduled_starts_at, s.sort_order, a.title`,
      [required(eventWorkspaceId, "event workspace id")]
    );
    const activities = rows || [];
    const speakersByActivity = await this.listActivitySpeakers(activities.map((activity) => activity.id));
    return activities.map((activity) => ({ ...activity, speakers: speakersByActivity.get(activity.id) || [] }));
  }

  async listActivitySpeakers(activityIds, executor = this.pool) {
    const ids = [...new Set((activityIds || []).map(String).filter(Boolean))];
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await executor.execute(
      `SELECT eas.event_activity_id, es.id, es.source_kind, es.account_user_id,
              es.manual_name, es.manual_role_title, es.manual_bio, es.manual_photo_url,
              u.name AS auth_name, u.image AS auth_image, p.display_name, p.role_title, p.company, p.bio, p.photo_key,
              asa.id AS assignment_id, asa.status AS assignment_status, asa.selected_deck_id
       FROM event_activity_speakers eas
       INNER JOIN event_speakers es ON es.id = eas.event_speaker_id
       LEFT JOIN \`user\` u ON u.id = es.account_user_id
       LEFT JOIN user_profiles p ON p.user_id = es.account_user_id
       LEFT JOIN event_activity_speaker_assignments asa ON asa.event_activity_id = eas.event_activity_id AND asa.event_speaker_id = es.id
       WHERE eas.event_activity_id IN (${placeholders})
       ORDER BY eas.event_activity_id, eas.sort_order, es.created_at`,
      ids
    );
    const speakers = new Map();
    for (const row of rows || []) {
      const item = {
        id: row.id,
        sourceKind: row.source_kind,
        accountUserId: row.account_user_id || null,
        name: row.source_kind === "ACCOUNT" ? String(row.display_name || row.auth_name || "").trim() : String(row.manual_name || "").trim(),
        roleTitle: row.source_kind === "ACCOUNT" ? [row.role_title, row.company].filter(Boolean).join(" · ") : String(row.manual_role_title || "").trim(),
        bio: row.source_kind === "ACCOUNT" ? String(row.bio || "").trim() : String(row.manual_bio || "").trim(),
        photoUrl: publicSpeakerPhotoUrl({ photoKey: row.photo_key, authImage: row.auth_image, manualPhotoUrl: row.manual_photo_url }),
        invitation: row.assignment_id ? { id: row.assignment_id, status: row.assignment_status, selectedDeckId: row.selected_deck_id || null } : null
      };
      const current = speakers.get(row.event_activity_id) || [];
      current.push(item);
      speakers.set(row.event_activity_id, current);
    }
    return speakers;
  }

  async addActivitySpeaker({ eventWorkspaceId, activityId, accountUserId = null, name = "", roleTitle = "", bio = "", photoUrl = "" }) {
    const activity = await this.getActivity(activityId);
    if (activity.event_workspace_id !== required(eventWorkspaceId, "event workspace id")) {
      throw new EventHubError("ACTIVITY_WORKSPACE_MISMATCH", "This activity does not belong to this Event Hub", 403);
    }
    const accountId = String(accountUserId || "").trim();
    let speakerId;
    if (accountId) {
      const [existing] = await this.pool.execute(
        "SELECT id FROM event_speakers WHERE event_workspace_id = ? AND account_user_id = ? LIMIT 1",
        [eventWorkspaceId, accountId]
      );
      speakerId = existing?.[0]?.id;
      if (!speakerId) {
        speakerId = this.createId();
        const [result] = await this.pool.execute(
          `INSERT INTO event_speakers (id, event_workspace_id, source_kind, account_user_id)
           SELECT ?, ?, 'ACCOUNT', u.id FROM \`user\` u WHERE u.id = ?`,
          [speakerId, eventWorkspaceId, accountId]
        );
        if (!Number(result?.affectedRows)) throw new EventHubError("SPEAKER_ACCOUNT_NOT_FOUND", "IMMERSA account not found", 404);
      }
    } else {
      speakerId = this.createId();
      const manualName = required(name, "speaker name");
      await this.pool.execute(
        `INSERT INTO event_speakers
         (id, event_workspace_id, source_kind, manual_name, manual_role_title, manual_bio, manual_photo_url)
         VALUES (?, ?, 'MANUAL', ?, ?, ?, ?)`,
        [speakerId, eventWorkspaceId, manualName, optionalText(roleTitle, "speaker role", 120), optionalText(bio, "speaker bio", 600), optionalText(photoUrl, "speaker photo URL", 500)]
      );
    }
    await this.pool.execute(
      `INSERT IGNORE INTO event_activity_speakers (event_activity_id, event_speaker_id, sort_order)
       VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM event_activity_speakers current WHERE current.event_activity_id = ?))`,
      [activity.id, speakerId, activity.id]
    );
    return (await this.listActivitySpeakers([activity.id])).get(activity.id) || [];
  }

  async removeActivitySpeaker({ eventWorkspaceId, activityId, eventSpeakerId }) {
    return transaction(this.pool, async (connection) => {
      const [result] = await connection.execute(
        `DELETE eas FROM event_activity_speakers eas
         INNER JOIN event_activities a ON a.id = eas.event_activity_id
         WHERE eas.event_activity_id = ? AND eas.event_speaker_id = ? AND a.event_workspace_id = ?`,
        [required(activityId, "activity id"), required(eventSpeakerId, "event speaker id"), required(eventWorkspaceId, "event workspace id")]
      );
      if (!Number(result?.affectedRows)) throw new EventHubError("ACTIVITY_SPEAKER_NOT_FOUND", "Activity speaker not found", 404);
      await connection.execute(
        "DELETE FROM event_activity_speaker_assignments WHERE event_activity_id = ? AND event_speaker_id = ?",
        [required(activityId, "activity id"), required(eventSpeakerId, "event speaker id")]
      );
      return { activityId, eventSpeakerId };
    });
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

  async getPublicQrForAudience({ eventWorkspaceId, audienceLevel }) {
    const [rows] = await this.pool.execute(
      `SELECT public_id FROM event_public_qrs
       WHERE event_workspace_id = ? AND audience_level = ? AND active = 1
       LIMIT 1`,
      [required(eventWorkspaceId, "event workspace id"), level(audienceLevel)]
    );
    return rows?.[0]?.public_id || null;
  }

  async listPublicActivities({ eventWorkspaceId, audienceLevel }) {
    const viewerLevel = level(audienceLevel);
    const [rows] = await this.pool.execute(
      `SELECT a.id, a.title, a.activity_type, a.access_level, a.status, a.duration_minutes,
              a.scheduled_starts_at, a.scheduled_ends_at, s.id AS event_stage_id, s.name AS stage_name,
              l.id AS live_session_id, l.status AS live_status
       FROM event_activities a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       LEFT JOIN event_live_sessions l ON l.event_activity_id = a.id AND l.status = 'LIVE'
       WHERE a.event_workspace_id = ?
       ORDER BY a.scheduled_starts_at IS NULL, a.scheduled_starts_at, s.sort_order, a.title`,
      [required(eventWorkspaceId, "event workspace id")]
    );
    const activities = rows || [];
    const speakersByActivity = await this.listActivitySpeakers(activities.map((activity) => activity.id));
    return activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      activityType: activity.activity_type,
      accessLevel: activity.access_level,
      scheduledStartsAt: activity.scheduled_starts_at,
      scheduledEndsAt: activity.scheduled_ends_at,
      durationMinutes: activity.duration_minutes,
      stage: { id: activity.event_stage_id, name: activity.stage_name },
      speakers: speakersByActivity.get(activity.id) || [],
      liveSessionId: activity.live_session_id || null,
      live: activity.live_status === "LIVE",
      canEnter: activity.live_status === "LIVE" && canEnterActivity(viewerLevel, activity.access_level)
    }));
  }

  async createActivity({ eventWorkspaceId, eventStageId, title, activityType: requestedActivityType = "CONFERENCE", accessLevel = "PAID", deckId = null, scheduledStartsAt = null, durationMinutes = 60 }) {
    const id = this.createId();
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      throw new EventHubError("INVALID_ACTIVITY_DURATION", "Activity duration must be between 5 and 480 minutes");
    }
    await this.assertStageScheduleAvailable({ eventWorkspaceId, eventStageId, scheduledStartsAt, durationMinutes: duration });
    await this.pool.execute(
      `INSERT INTO event_activities
       (id, event_workspace_id, event_stage_id, title, activity_type, access_level, deck_id, scheduled_starts_at, scheduled_ends_at, duration_minutes)
       SELECT ?, ?, s.id, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(?, INTERVAL ? MINUTE) END, ? FROM event_stages s
       WHERE s.id = ? AND s.event_workspace_id = ? AND s.active = 1`,
      [id, required(eventWorkspaceId, "event workspace id"), required(title, "title"), activityType(requestedActivityType), level(accessLevel, ACTIVITY_ACCESS_LEVELS),
        deckId ? String(deckId) : null, scheduledStartsAt, scheduledStartsAt, scheduledStartsAt, duration, duration,
        required(eventStageId, "event stage id"), eventWorkspaceId]
    ).then(([result]) => {
      if (!Number(result?.affectedRows)) throw new EventHubError("EVENT_STAGE_NOT_FOUND", "Event Stage not found", 404);
    });
    return this.getActivity(id);
  }

  async updateActivity({ activityId, eventWorkspaceId, eventStageId, title, activityType: requestedActivityType = "CONFERENCE", accessLevel = "PAID", scheduledStartsAt = null, durationMinutes = 60 }) {
    const activity = await this.getActivity(activityId);
    if (activity.event_workspace_id !== required(eventWorkspaceId, "event workspace id")) {
      throw new EventHubError("ACTIVITY_WORKSPACE_MISMATCH", "This activity does not belong to this Event Hub", 403);
    }
    if (activity.status !== "SCHEDULED") {
      throw new EventHubError("ACTIVITY_NOT_EDITABLE", "Only scheduled activities can be edited", 409);
    }
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      throw new EventHubError("INVALID_ACTIVITY_DURATION", "Activity duration must be between 5 and 480 minutes");
    }
    await this.assertStageScheduleAvailable({ eventWorkspaceId, eventStageId, scheduledStartsAt, durationMinutes: duration, excludeActivityId: activityId });
    const [result] = await this.pool.execute(
      `UPDATE event_activities a
       INNER JOIN event_stages s ON s.id = ? AND s.event_workspace_id = a.event_workspace_id AND s.active = 1
       SET a.event_stage_id = s.id, a.title = ?, a.activity_type = ?, a.access_level = ?, a.scheduled_starts_at = ?,
           a.scheduled_ends_at = CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(?, INTERVAL ? MINUTE) END,
           a.duration_minutes = ?
       WHERE a.id = ? AND a.event_workspace_id = ? AND a.status = 'SCHEDULED'`,
      [required(eventStageId, "event stage id"), required(title, "title"), activityType(requestedActivityType), level(accessLevel, ACTIVITY_ACCESS_LEVELS),
        scheduledStartsAt, scheduledStartsAt, scheduledStartsAt, duration, duration,
        required(activityId, "activity id"), eventWorkspaceId]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("EVENT_STAGE_NOT_FOUND", "Event Stage not found", 404);
    return this.getActivity(activityId);
  }

  async assertStageScheduleAvailable({ eventWorkspaceId, eventStageId, scheduledStartsAt, durationMinutes, excludeActivityId = null }) {
    if (!scheduledStartsAt) return;
    const [rows] = await this.pool.execute(
      `SELECT id FROM event_activities
       WHERE event_workspace_id = ? AND event_stage_id = ? AND scheduled_starts_at IS NOT NULL
         AND scheduled_starts_at < DATE_ADD(?, INTERVAL ? MINUTE)
         AND COALESCE(scheduled_ends_at, DATE_ADD(scheduled_starts_at, INTERVAL duration_minutes MINUTE)) > ?
         AND (? IS NULL OR id <> ?) LIMIT 1`,
      [required(eventWorkspaceId, "event workspace id"), required(eventStageId, "event stage id"), scheduledStartsAt, durationMinutes, scheduledStartsAt, excludeActivityId, excludeActivityId]
    );
    if (rows?.[0]) throw new EventHubError("STAGE_SCHEDULE_CONFLICT", "Ya existe una actividad en este Event Stage que se traslapa con ese horario", 409);
  }

  async requestDeckCheck({ activityId, eventWorkspaceId, deckId }) {
    const [result] = await this.pool.execute(
      `UPDATE event_activities SET pending_deck_id = ?, deck_check_status = 'READY_FOR_TEST', deck_check_updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND event_workspace_id = ? AND status = 'SCHEDULED'`,
      [required(deckId, "deck id"), required(activityId, "activity id"), required(eventWorkspaceId, "event workspace id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("ACTIVITY_NOT_EDITABLE", "Only scheduled activities can request Deck Check", 409);
    return this.getActivity(activityId);
  }

  async getLinkedSpeakerForActivity({ activityId, eventWorkspaceId, eventSpeakerId }) {
    const [rows] = await this.pool.execute(
      `SELECT es.account_user_id
       FROM event_activity_speaker_assignments asa
       INNER JOIN event_activities a ON a.id = asa.event_activity_id
       INNER JOIN event_speakers es ON es.id = asa.event_speaker_id
       WHERE asa.event_activity_id = ? AND a.event_workspace_id = ? AND asa.event_speaker_id = ?
         AND asa.status = 'LINKED' LIMIT 1`,
      [required(activityId, "activity id"), required(eventWorkspaceId, "event workspace id"), required(eventSpeakerId, "event speaker id")]
    );
    const userId = rows?.[0]?.account_user_id;
    if (!userId) throw new EventHubError("SPEAKER_NOT_LINKED", "The speaker has not accepted the Event Hub invitation", 409);
    return { userId: String(userId) };
  }

  async approveDeckCheck({ activityId, eventWorkspaceId }) {
    const [result] = await this.pool.execute(
      `UPDATE event_activities SET deck_id = pending_deck_id, pending_deck_id = NULL, deck_check_status = 'DECK_CHECK', deck_check_updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND event_workspace_id = ? AND status = 'SCHEDULED' AND pending_deck_id IS NOT NULL`,
      [required(activityId, "activity id"), required(eventWorkspaceId, "event workspace id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("DECK_CHECK_NOT_READY", "There is no Deck pending approval", 409);
    return this.getActivity(activityId);
  }

  async inviteSpeakerToLinkAccount({ activityId, eventWorkspaceId, eventSpeakerId }) {
    const [result] = await this.pool.execute(
      `INSERT INTO event_activity_speaker_assignments (id, event_activity_id, event_speaker_id)
       SELECT ?, a.id, s.id FROM event_activities a
       INNER JOIN event_speakers s ON s.id = ? AND s.event_workspace_id = a.event_workspace_id AND s.source_kind = 'ACCOUNT'
       WHERE a.id = ? AND a.event_workspace_id = ?
       ON DUPLICATE KEY UPDATE status = 'INVITED', selected_deck_id = NULL, invited_at = CURRENT_TIMESTAMP(3), accepted_at = NULL`,
      [this.createId(), required(eventSpeakerId, "event speaker id"), required(activityId, "activity id"), required(eventWorkspaceId, "event workspace id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("SPEAKER_INVITE_NOT_AVAILABLE", "Only a linked IMMERSA speaker can receive this invitation", 409);
    const invitation = await this.getSpeakerInvitationForAdmin({ activityId, eventWorkspaceId, eventSpeakerId });
    return { ...invitation, status: "INVITED" };
  }

  async getSpeakerInvitationForAdmin({ activityId, eventWorkspaceId, eventSpeakerId }) {
    const [rows] = await this.pool.execute(
      `SELECT asa.id, a.id AS activity_id, a.title AS activity_title, h.title AS event_title,
              u.id AS user_id, u.name AS speaker_name, u.email AS speaker_email
       FROM event_activity_speaker_assignments asa
       INNER JOIN event_activities a ON a.id = asa.event_activity_id
       INNER JOIN event_hubs h ON h.workspace_id = a.event_workspace_id
       INNER JOIN event_speakers s ON s.id = asa.event_speaker_id
       INNER JOIN \`user\` u ON u.id = s.account_user_id
       WHERE asa.event_activity_id = ? AND a.event_workspace_id = ? AND asa.event_speaker_id = ? LIMIT 1`,
      [required(activityId, "activity id"), required(eventWorkspaceId, "event workspace id"), required(eventSpeakerId, "event speaker id")]
    );
    const invitation = rows?.[0];
    if (!invitation) throw new EventHubError("SPEAKER_INVITE_NOT_AVAILABLE", "Only a linked IMMERSA speaker can receive this invitation", 409);
    return {
      assignmentId: invitation.id,
      activityId: invitation.activity_id,
      activityTitle: invitation.activity_title,
      eventTitle: invitation.event_title,
      speakerUserId: invitation.user_id,
      speakerName: invitation.speaker_name || "",
      speakerEmail: invitation.speaker_email || ""
    };
  }

  async listSpeakerInvitations(userId) {
    const [rows] = await this.pool.execute(
      `SELECT asa.id, asa.status, asa.selected_deck_id, asa.invited_at, asa.accepted_at,
              a.id AS activity_id, a.title AS activity_title, a.scheduled_starts_at, a.duration_minutes, a.deck_id, a.deck_check_status,
              s.name AS stage_name, h.title AS event_title
       FROM event_activity_speaker_assignments asa
       INNER JOIN event_speakers es ON es.id = asa.event_speaker_id AND es.account_user_id = ?
       INNER JOIN event_activities a ON a.id = asa.event_activity_id
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       INNER JOIN event_hubs h ON h.workspace_id = a.event_workspace_id
       WHERE asa.status IN ('INVITED', 'LINKED', 'DECLINED', 'DECK_SELECTED') AND a.status IN ('SCHEDULED', 'LIVE')
       ORDER BY a.scheduled_starts_at IS NULL, a.scheduled_starts_at, h.title, a.title`,
      [required(userId, "speaker user id")]
    );
    return (rows || []).map((row) => ({
      id: row.id, status: row.status === 'DECK_SELECTED' ? 'INVITED' : row.status,
      invitedAt: row.invited_at, acceptedAt: row.accepted_at,
      speakerAccessReady: row.status === 'LINKED' && Boolean(row.deck_id || row.pending_deck_id),
      deckCheckStatus: row.deck_check_status,
      activity: { id: row.activity_id, title: row.activity_title, scheduledStartsAt: row.scheduled_starts_at, durationMinutes: row.duration_minutes, stageName: row.stage_name },
      eventTitle: row.event_title
    }));
  }

  async getSpeakerPresentationAccess({ assignmentId, userId }) {
    const [rows] = await this.pool.execute(
      `SELECT asa.id, a.id AS activity_id, a.deck_id, a.pending_deck_id, a.deck_check_status
       FROM event_activity_speaker_assignments asa
       INNER JOIN event_speakers es ON es.id = asa.event_speaker_id AND es.account_user_id = ?
       INNER JOIN event_activities a ON a.id = asa.event_activity_id AND a.status IN ('SCHEDULED', 'LIVE')
       WHERE asa.id = ? AND asa.status = 'LINKED' LIMIT 1`,
      [required(userId, "speaker user id"), required(assignmentId, "invitation id")]
    );
    const assignment = rows?.[0];
    if (!assignment) throw new EventHubError("SPEAKER_INVITATION_NOT_FOUND", "Esta invitación no está disponible", 404);
    const deckId = assignment.deck_id || assignment.pending_deck_id;
    if (!deckId) throw new EventHubError("SPEAKER_DECK_NOT_READY", "Tu acceso como Speaker estará disponible cuando Event Stage asigne tu Deck", 409);
    return { assignmentId: assignment.id, activityId: assignment.activity_id, deckId, deckCheckStatus: assignment.deck_check_status };
  }

  async acceptSpeakerInvitation({ assignmentId, userId }) {
    const [result] = await this.pool.execute(
      `UPDATE event_activity_speaker_assignments asa
       INNER JOIN event_speakers es ON es.id = asa.event_speaker_id AND es.account_user_id = ?
       INNER JOIN event_activities a ON a.id = asa.event_activity_id AND a.status = 'SCHEDULED'
       SET asa.selected_deck_id = NULL, asa.status = 'LINKED', asa.accepted_at = CURRENT_TIMESTAMP(3)
       WHERE asa.id = ? AND asa.status IN ('INVITED', 'DECK_SELECTED', 'LINKED')`,
      [required(userId, "speaker user id"), required(assignmentId, "invitation id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("SPEAKER_INVITATION_NOT_FOUND", "This speaker invitation is not available", 404);
    return { assignmentId, status: "LINKED" };
  }

  async declineSpeakerInvitation({ assignmentId, userId }) {
    const [result] = await this.pool.execute(
      `UPDATE event_activity_speaker_assignments asa
       INNER JOIN event_speakers es ON es.id = asa.event_speaker_id AND es.account_user_id = ?
       INNER JOIN event_activities a ON a.id = asa.event_activity_id AND a.status = 'SCHEDULED'
       SET asa.selected_deck_id = NULL, asa.status = 'DECLINED', accepted_at = NULL
       WHERE asa.id = ? AND asa.status = 'INVITED'`,
      [required(userId, "speaker user id"), required(assignmentId, "invitation id")]
    );
    if (!Number(result?.affectedRows)) throw new EventHubError("SPEAKER_INVITATION_NOT_FOUND", "This speaker invitation is not available", 404);
    return { assignmentId, status: "DECLINED" };
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
      `SELECT a.id, a.event_workspace_id, a.event_stage_id, a.title, a.access_level, a.deck_id, a.pending_deck_id, a.deck_check_status, a.status,
              s.name AS stage_name
       FROM event_activities a INNER JOIN event_stages s ON s.id = a.event_stage_id
       WHERE a.id = ? LIMIT 1`, [required(activityId, "activity id")]
    );
    if (!rows?.[0]) throw new EventHubError("ACTIVITY_NOT_FOUND", "Activity not found", 404);
    return rows[0];
  }

  async getStageControlForDeck(deckId) {
    const [rows] = await this.pool.execute(
      `SELECT a.id AS activity_id, a.title AS activity_title, a.event_stage_id, a.status AS activity_status, a.deck_check_status,
              s.name AS stage_name, l.id AS live_session_id
       FROM event_activities a
       INNER JOIN event_stages s ON s.id = a.event_stage_id
       LEFT JOIN event_live_sessions l ON l.event_activity_id = a.id AND l.status = 'LIVE'
       WHERE COALESCE(a.deck_id, a.pending_deck_id) = ? AND a.status IN ('SCHEDULED', 'LIVE')
       ORDER BY a.status = 'LIVE' DESC, a.scheduled_starts_at ASC
       LIMIT 1`,
      [required(deckId, "deck id")]
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      activityId: row.activity_id,
      title: row.activity_title,
      stageId: row.event_stage_id,
      stageName: row.stage_name,
      status: row.activity_status,
      deckCheckStatus: row.deck_check_status,
      liveSessionId: row.live_session_id || null
    };
  }

  async startLiveSession({ eventActivityId }) {
    return transaction(this.pool, async (connection) => {
      const activity = await this.getActivity(eventActivityId, connection);
      const [liveRows] = await connection.execute(
        "SELECT id FROM event_live_sessions WHERE event_stage_id = ? AND status = 'LIVE' LIMIT 1 FOR UPDATE",
        [activity.event_stage_id]
      );
      if (liveRows?.[0]) throw new EventHubError("STAGE_ALREADY_LIVE", "This Event Stage already has a LiveSession", 409);
      const deckId = activity.deck_id || activity.pending_deck_id;
      if (!deckId) throw new EventHubError("EVENT_DECK_REQUIRED", "Selecciona un Deck antes de iniciar la conferencia", 409);
      const id = this.createId();
      await connection.execute(
        "INSERT INTO event_live_sessions (id, event_workspace_id, event_activity_id, event_stage_id, deck_id) VALUES (?, ?, ?, ?, ?)",
        [id, activity.event_workspace_id, activity.id, activity.event_stage_id, deckId]
      );
      await connection.execute("UPDATE event_activities SET status = 'LIVE' WHERE id = ?", [activity.id]);
      return { id, eventWorkspaceId: activity.event_workspace_id, activityId: activity.id, stageId: activity.event_stage_id, deckId, status: "LIVE" };
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
      // Closing a LiveSession preserves its metrics and keeps the scheduled Activity operable.
      await connection.execute("UPDATE event_activities SET status = 'SCHEDULED' WHERE id = ?", [liveSession.event_activity_id]);
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
      return { admitted: true, liveSessionId: row.id, participantId: row.participant_id, audienceLevel: row.audience_level };
    });
  }

  async isParticipantLiveSessionActive({ eventLiveSessionId, eventParticipantId }) {
    const [rows] = await this.pool.execute(
      `SELECT l.status
       FROM event_live_sessions l
       INNER JOIN event_live_attendance attendance ON attendance.event_live_session_id = l.id
       WHERE l.id = ? AND attendance.event_participant_id = ?
       LIMIT 1`,
      [required(eventLiveSessionId, "live session id"), required(eventParticipantId, "event participant id")]
    );
    if (!rows?.[0]) throw new EventHubError("LIVE_SESSION_ACCESS_DENIED", "LiveSession access denied", 403);
    return rows[0].status === "LIVE";
  }
}

module.exports = { EventHubRepository, EventHubError, AUDIENCE_LEVELS, ACTIVITY_ACCESS_LEVELS, canEnterActivity, registrationKeyHash, secretHash };
