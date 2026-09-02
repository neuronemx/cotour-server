const crypto = require("node:crypto");
const { getPlanLimits, summarizePlanUsage, assertCanReserveDeck, assertCanReplaceDeck } = require("./plan-limits");
const { normalizePlan } = require("./plan-features");

const PERSONAL_WORKSPACE_KIND = "personal";
const FREE_PLAN = "FREE";
const UNVERIFIED_RETENTION_MS = 48 * 60 * 60 * 1000;
const DOWNGRADE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function pendingDowngrade(row, usage) {
  const targetPlan = normalizePlan(row?.pending_plan);
  if (!targetPlan) return null;
  const limits = getPlanLimits(targetPlan);
  const normalizedUsage = { decks: Number(usage?.decks || 0), storageBytes: Number(usage?.storageBytes || 0) };
  const excess = {
    decks: Math.max(0, normalizedUsage.decks - limits.decks),
    storageBytes: Math.max(0, normalizedUsage.storageBytes - limits.storageBytes)
  };
  const deadlineAt = row.pending_plan_deadline_at || null;
  const adjustmentRequired = Boolean(deadlineAt && new Date(deadlineAt).getTime() <= Date.now());
  return {
    targetPlan,
    limits: { decks: limits.decks, storageBytes: limits.storageBytes },
    excess,
    ready: excess.decks === 0 && excess.storageBytes === 0,
    requestedAt: row.pending_plan_requested_at || null,
    deadlineAt,
    adjustmentRequired,
    state: adjustmentRequired ? "adjustment_required" : "pending"
  };
}

function adjustmentRequiredError() {
  const error = new Error("Tu cuenta requiere ajustar sus Decks antes de continuar");
  error.statusCode = 409;
  error.code = "ACCOUNT_ADJUSTMENT_REQUIRED";
  error.publicMessage = error.message;
  return error;
}

class WorkspaceRepository {
  constructor(pool) {
    if (!pool) throw new Error("A MySQL pool is required for Immersa workspaces");
    this.pool = pool;
  }

  async ensurePersonalWorkspace(user) {
    const userId = String(user?.id || "").trim();
    if (!userId) throw new Error("A Better Auth user id is required");

    const [existing] = await this.pool.execute(
      "SELECT id, plan FROM workspaces WHERE personal_owner_user_id = ? LIMIT 1",
      [userId]
    );
    if (existing?.[0]) return existing[0];

    const workspaceId = crypto.randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO workspaces (id, kind, personal_owner_user_id, plan)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [workspaceId, PERSONAL_WORKSPACE_KIND, userId, FREE_PLAN]
      );
      const [rows] = await connection.execute(
        "SELECT id, plan FROM workspaces WHERE personal_owner_user_id = ? LIMIT 1",
        [userId]
      );
      const workspace = rows?.[0];
      if (!workspace) throw new Error("Unable to create the personal workspace");
      await connection.execute(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES (?, ?, 'owner')
         ON DUPLICATE KEY UPDATE role = VALUES(role)`,
        [workspace.id, userId]
      );
      await connection.commit();
      return workspace;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async accountContext(session) {
    if (!session?.user?.id) return null;
    const workspace = await this.ensurePersonalWorkspace(session.user);
    return { session, user: session.user, workspace };
  }

  async listDeckIds(userId) {
    const [rows] = await this.pool.execute(
      `SELECT d.deck_id
       FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE wm.user_id = ?
       ORDER BY d.created_at DESC`,
      [String(userId)]
    );
    return (rows || []).map((row) => String(row.deck_id));
  }

  async ownsDeck(userId, deckId) {
    const [rows] = await this.pool.execute(
      `SELECT 1 AS owned
       FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE wm.user_id = ? AND d.deck_id = ?
       LIMIT 1`,
      [String(userId), String(deckId)]
    );
    return Boolean(rows?.[0]);
  }

  async ownsSession(userId, sessionId) {
    const [rows] = await this.pool.execute(
      `SELECT d.deck_id
       FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE wm.user_id = ? AND d.session_id = ?
       LIMIT 1`,
      [String(userId), String(sessionId)]
    );
    return rows?.[0] ? String(rows[0].deck_id) : null;
  }

  async getDeckPlan(deckId) {
    const state = await this.getDeckPlanState(deckId);
    return state?.plan || null;
  }

  async getDeckPlanState(deckId) {
    const [rows] = await this.pool.execute(
      `SELECT w.plan, w.pending_plan, w.pending_plan_deadline_at
       FROM decks d
       INNER JOIN workspaces w ON w.id = d.workspace_id
       WHERE d.deck_id = ?
       LIMIT 1`,
      [String(deckId)]
    );
    const row = rows?.[0];
    if (!row?.plan) return null;
    const deadline = row.pending_plan_deadline_at ? new Date(row.pending_plan_deadline_at).getTime() : 0;
    return {
      plan: String(row.plan).trim().toUpperCase(),
      adjustmentRequired: Boolean(row.pending_plan && deadline && deadline <= Date.now())
    };
  }

  async listAdminAccounts() {
    const [rows] = await this.pool.execute(
      `SELECT
         u.id AS user_id,
         u.name,
         u.email,
         u.emailVerified AS email_verified,
         u.createdAt AS registered_at,
         w.id AS workspace_id,
         w.plan,
         w.pending_plan,
         w.pending_plan_requested_at,
         w.pending_plan_deadline_at,
         COUNT(d.deck_id) AS deck_count,
         COALESCE(SUM(d.source_size_bytes), 0) AS storage_bytes
       FROM \`user\` u
       INNER JOIN workspaces w ON w.personal_owner_user_id = u.id
       LEFT JOIN decks d ON d.workspace_id = w.id
       GROUP BY u.id, u.name, u.email, u.emailVerified, u.createdAt, w.id, w.plan, w.pending_plan, w.pending_plan_requested_at, w.pending_plan_deadline_at
       ORDER BY u.createdAt DESC, u.id DESC`
    );
    return (rows || []).map((row) => {
      const usage = { decks: row.deck_count, storageBytes: row.storage_bytes };
      return {
      userId: String(row.user_id),
      workspaceId: String(row.workspace_id),
      name: String(row.name || ""),
      email: String(row.email || ""),
      emailVerified: Boolean(row.email_verified),
      registeredAt: row.registered_at,
        ...summarizePlanUsage(row.plan, usage),
        pendingDowngrade: pendingDowngrade(row, usage)
      };
    });
  }

  async changePlan({ workspaceId, plan, changedByUserId, note = "" }) {
    const targetPlan = normalizePlan(plan);
    let targetLimits;
    try {
      targetLimits = getPlanLimits(targetPlan);
    } catch (_error) {
      const error = new Error("Selecciona un plan IMMERSA válido");
      error.statusCode = 400;
      error.code = "INVALID_PLAN";
      error.publicMessage = error.message;
      throw error;
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [workspaces] = await connection.execute(
        `SELECT id, plan, pending_plan, pending_plan_request_id, pending_plan_requested_at, pending_plan_deadline_at,
                pending_plan_requested_by_user_id, pending_plan_note
         FROM workspaces WHERE id = ? LIMIT 1 FOR UPDATE`,
        [String(workspaceId)]
      );
      const workspace = workspaces?.[0];
      if (!workspace) {
        const error = new Error("Cuenta IMMERSA no encontrada");
        error.statusCode = 404;
        throw error;
      }
      const previousPlan = normalizePlan(workspace.plan);
      const [usageRows] = await connection.execute(
        `SELECT COUNT(*) AS deck_count,
                COALESCE(SUM(source_size_bytes), 0) AS storage_bytes
         FROM decks
         WHERE workspace_id = ?`,
        [String(workspaceId)]
      );
      const usage = {
        decks: Number(usageRows?.[0]?.deck_count || 0),
        storageBytes: Number(usageRows?.[0]?.storage_bytes || 0)
      };
      if (usage.decks > targetLimits.decks || usage.storageBytes > targetLimits.storageBytes) {
        const requestId = crypto.randomUUID();
        const requestedAt = new Date();
        const deadlineAt = new Date(requestedAt.getTime() + DOWNGRADE_GRACE_MS);
        await connection.execute(
          "DELETE FROM plan_downgrade_notifications WHERE workspace_id = ? AND sent_at IS NULL",
          [String(workspaceId)]
        );
        await connection.execute(
          `UPDATE workspaces
           SET pending_plan = ?, pending_plan_request_id = ?, pending_plan_requested_at = ?, pending_plan_deadline_at = ?,
               pending_plan_requested_by_user_id = ?, pending_plan_note = ?
           WHERE id = ?`,
          [targetPlan, requestId, requestedAt, deadlineAt, String(changedByUserId), String(note || "").trim().slice(0, 500) || null, String(workspaceId)]
        );
        await connection.execute(
          `INSERT INTO plan_downgrade_notifications
             (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
           VALUES (?, 'requested', ?, ?, ?, ?),
                  (?, 'reminder', ?, ?, ?, ?),
                  (?, 'expired', ?, ?, ?, ?)`,
          [requestId, String(workspaceId), targetPlan, deadlineAt, requestedAt,
            requestId, String(workspaceId), targetPlan, deadlineAt, new Date(deadlineAt.getTime() - 2 * 24 * 60 * 60 * 1000),
            requestId, String(workspaceId), targetPlan, deadlineAt, deadlineAt]
        );
        await connection.commit();
        return {
          ...summarizePlanUsage(previousPlan, usage),
          pendingDowngrade: pendingDowngrade({ pending_plan: targetPlan, pending_plan_requested_at: requestedAt, pending_plan_deadline_at: deadlineAt }, usage)
        };
      }
      await connection.execute(
        "DELETE FROM plan_downgrade_notifications WHERE workspace_id = ? AND sent_at IS NULL",
        [String(workspaceId)]
      );
      if (previousPlan !== targetPlan) {
        await connection.execute(
          `UPDATE workspaces
           SET plan = ?, pending_plan = NULL, pending_plan_request_id = NULL, pending_plan_requested_at = NULL, pending_plan_deadline_at = NULL,
               pending_plan_requested_by_user_id = NULL, pending_plan_note = NULL
           WHERE id = ?`,
          [targetPlan, String(workspaceId)]
        );
        await connection.execute(
          `INSERT INTO workspace_plan_changes
             (workspace_id, previous_plan, next_plan, source, changed_by_user_id, note)
           VALUES (?, ?, ?, 'manual', ?, ?)`,
          [String(workspaceId), previousPlan, targetPlan, String(changedByUserId), String(note || "").trim().slice(0, 500) || null]
        );
      } else await connection.execute(
        `UPDATE workspaces
         SET pending_plan = NULL, pending_plan_request_id = NULL, pending_plan_requested_at = NULL, pending_plan_deadline_at = NULL,
             pending_plan_requested_by_user_id = NULL, pending_plan_note = NULL
         WHERE id = ?`,
        [String(workspaceId)]
      );
      await connection.commit();
      return summarizePlanUsage(targetPlan, usage);
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async listWorkspaceDeckIds(workspaceId) {
    const [rows] = await this.pool.execute(
      "SELECT deck_id FROM decks WHERE workspace_id = ?",
      [String(workspaceId)]
    );
    return (rows || []).map((row) => String(row.deck_id));
  }

  async getPlanUsage({ userId, workspaceId }) {
    const [rows] = await this.pool.execute(
      `SELECT w.plan, w.pending_plan, w.pending_plan_requested_at, w.pending_plan_deadline_at,
              COUNT(d.deck_id) AS deck_count,
              COALESCE(SUM(d.source_size_bytes), 0) AS storage_bytes
       FROM workspaces w
       INNER JOIN workspace_members wm ON wm.workspace_id = w.id
       LEFT JOIN decks d ON d.workspace_id = w.id
       WHERE w.id = ? AND wm.user_id = ?
       GROUP BY w.id, w.plan, w.pending_plan, w.pending_plan_requested_at, w.pending_plan_deadline_at
       LIMIT 1`,
      [String(workspaceId), String(userId)]
    );
    const row = rows?.[0];
    if (!row) throw new Error("Immersa workspace not found");
    const usage = {
      decks: row.deck_count,
      storageBytes: row.storage_bytes
    };
    return { ...summarizePlanUsage(row.plan, usage), pendingDowngrade: pendingDowngrade(row, usage) };
  }

  async listDeckIdsForStorageSync({ userId, workspaceId }) {
    const [rows] = await this.pool.execute(
      `SELECT d.deck_id
       FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE d.workspace_id = ?
         AND wm.user_id = ?`,
      [String(workspaceId), String(userId)]
    );
    return (rows || []).map((row) => String(row.deck_id));
  }

  async setDeckSourceSize({ userId, workspaceId, deckId, sourceSizeBytes }) {
    const bytes = Math.max(0, Math.floor(Number(sourceSizeBytes) || 0));
    const [result] = await this.pool.execute(
      `UPDATE decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       SET d.source_size_bytes = ?
       WHERE d.workspace_id = ?
         AND d.deck_id = ?
         AND wm.user_id = ?`,
      [bytes, String(workspaceId), String(deckId), String(userId)]
    );
    return Number(result?.affectedRows || 0) > 0;
  }

  async reserveDeck({ userId, workspaceId, deckId, sessionId, sourceSizeBytes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [workspaces] = await connection.execute(
        `SELECT w.id, w.plan, w.pending_plan, w.pending_plan_request_id, w.pending_plan_deadline_at,
                w.pending_plan_requested_by_user_id, w.pending_plan_note
         FROM workspaces w
         INNER JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE w.id = ? AND wm.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      const workspace = workspaces?.[0];
      if (!workspace) throw new Error("Immersa workspace not found");
      if (workspace.pending_plan && new Date(workspace.pending_plan_deadline_at).getTime() <= Date.now()) {
        throw adjustmentRequiredError();
      }

      const [usageRows] = await connection.execute(
        `SELECT COUNT(*) AS deck_count,
                COALESCE(SUM(source_size_bytes), 0) AS storage_bytes
         FROM decks
         WHERE workspace_id = ?`,
        [String(workspaceId)]
      );
      const usage = summarizePlanUsage(workspace.plan, {
        decks: usageRows?.[0]?.deck_count,
        storageBytes: usageRows?.[0]?.storage_bytes
      });
      const bytes = assertCanReserveDeck(usage, sourceSizeBytes);

      await connection.execute(
        `INSERT INTO decks (deck_id, workspace_id, session_id, created_by_user_id, source_size_bytes)
         VALUES (?, ?, ?, ?, ?)`,
        [String(deckId), String(workspaceId), String(sessionId), String(userId), bytes]
      );
      await connection.commit();
      return summarizePlanUsage(workspace.plan, {
        decks: usage.usage.decks + 1,
        storageBytes: usage.usage.storageBytes + bytes
      });
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async registerDeck(payload) {
    return this.reserveDeck(payload);
  }

  async replaceDeckSource({ userId, workspaceId, deckId, sourceSizeBytes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [workspaces] = await connection.execute(
        `SELECT w.id, w.plan, w.pending_plan, w.pending_plan_deadline_at
         FROM workspaces w
         INNER JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE w.id = ? AND wm.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      const workspace = workspaces?.[0];
      if (!workspace) throw new Error("Immersa workspace not found");
      if (workspace.pending_plan && new Date(workspace.pending_plan_deadline_at).getTime() <= Date.now()) {
        throw adjustmentRequiredError();
      }

      const [deckRows] = await connection.execute(
        `SELECT d.source_size_bytes
         FROM decks d
         WHERE d.workspace_id = ? AND d.deck_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(deckId)]
      );
      const deck = deckRows?.[0];
      if (!deck) {
        const error = new Error("Deck not found");
        error.statusCode = 404;
        throw error;
      }

      const [usageRows] = await connection.execute(
        `SELECT COUNT(*) AS deck_count,
                COALESCE(SUM(source_size_bytes), 0) AS storage_bytes
         FROM decks
         WHERE workspace_id = ?`,
        [String(workspaceId)]
      );
      const usage = summarizePlanUsage(workspace.plan, {
        decks: usageRows?.[0]?.deck_count,
        storageBytes: usageRows?.[0]?.storage_bytes
      });
      const previousSourceSizeBytes = Math.max(0, Math.floor(Number(deck.source_size_bytes) || 0));
      const nextSourceSizeBytes = assertCanReplaceDeck(usage, previousSourceSizeBytes, sourceSizeBytes);

      await connection.execute(
        `UPDATE decks
         SET source_size_bytes = ?
         WHERE workspace_id = ? AND deck_id = ?`,
        [nextSourceSizeBytes, String(workspaceId), String(deckId)]
      );
      const nextUsage = {
        decks: usage.usage.decks,
        storageBytes: usage.usage.storageBytes - previousSourceSizeBytes + nextSourceSizeBytes
      };
      let resultingPlan = workspace.plan;
      const pending = pendingDowngrade(workspace, nextUsage);
      if (pending?.ready) {
        await connection.execute(
          "DELETE FROM plan_downgrade_notifications WHERE workspace_id = ? AND sent_at IS NULL",
          [workspace.id]
        );
        await connection.execute(
          `INSERT IGNORE INTO plan_downgrade_notifications
             (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
           VALUES (?, 'completed', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          [workspace.pending_plan_request_id, workspace.id, pending.targetPlan, workspace.pending_plan_deadline_at]
        );
        await connection.execute(
          `UPDATE workspaces
           SET plan = ?, pending_plan = NULL, pending_plan_request_id = NULL,
               pending_plan_requested_at = NULL, pending_plan_deadline_at = NULL,
               pending_plan_requested_by_user_id = NULL, pending_plan_note = NULL
           WHERE id = ?`,
          [pending.targetPlan, workspace.id]
        );
        await connection.execute(
          `INSERT INTO workspace_plan_changes
             (workspace_id, previous_plan, next_plan, source, changed_by_user_id, note)
           VALUES (?, ?, ?, 'pending_cleanup', ?, ?)`,
          [workspace.id, normalizePlan(workspace.plan), pending.targetPlan,
            String(workspace.pending_plan_requested_by_user_id || userId), workspace.pending_plan_note || null]
        );
        resultingPlan = pending.targetPlan;
      }
      await connection.commit();
      return {
        previousSourceSizeBytes,
        plan: summarizePlanUsage(resultingPlan, nextUsage)
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async unregisterDeck(userId, deckId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT w.id, w.plan, w.pending_plan, w.pending_plan_request_id, w.pending_plan_deadline_at,
                w.pending_plan_requested_by_user_id, w.pending_plan_note
         FROM decks d
         INNER JOIN workspaces w ON w.id = d.workspace_id
         INNER JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = ? AND d.deck_id = ? LIMIT 1 FOR UPDATE`,
        [String(userId), String(deckId)]
      );
      const workspace = rows?.[0];
      if (!workspace) { await connection.rollback(); return false; }
      await connection.execute("DELETE FROM decks WHERE workspace_id = ? AND deck_id = ?", [workspace.id, String(deckId)]);
      if (workspace.pending_plan) {
        const [usageRows] = await connection.execute(
          "SELECT COUNT(*) AS deck_count, COALESCE(SUM(source_size_bytes), 0) AS storage_bytes FROM decks WHERE workspace_id = ?",
          [workspace.id]
        );
        const pending = pendingDowngrade(workspace, {
          decks: usageRows?.[0]?.deck_count,
          storageBytes: usageRows?.[0]?.storage_bytes
        });
        if (pending?.ready) {
          await connection.execute(
            "DELETE FROM plan_downgrade_notifications WHERE workspace_id = ? AND sent_at IS NULL",
            [workspace.id]
          );
          await connection.execute(
            `INSERT IGNORE INTO plan_downgrade_notifications
               (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
             VALUES (?, 'completed', ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            [workspace.pending_plan_request_id, workspace.id, pending.targetPlan, workspace.pending_plan_deadline_at]
          );
          await connection.execute(
            `UPDATE workspaces
             SET plan = ?, pending_plan = NULL, pending_plan_request_id = NULL, pending_plan_requested_at = NULL, pending_plan_deadline_at = NULL,
                 pending_plan_requested_by_user_id = NULL, pending_plan_note = NULL
             WHERE id = ?`,
            [pending.targetPlan, workspace.id]
          );
          await connection.execute(
            `INSERT INTO workspace_plan_changes
               (workspace_id, previous_plan, next_plan, source, changed_by_user_id, note)
             VALUES (?, ?, ?, 'pending_cleanup', ?, ?)`,
            [workspace.id, normalizePlan(workspace.plan), pending.targetPlan,
              String(workspace.pending_plan_requested_by_user_id || userId), workspace.pending_plan_note || null]
          );
        }
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async cleanupStaleUnverifiedAccounts(options = {}) {
    const now = Number(options.now ?? Date.now());
    const retentionMs = Number(options.retentionMs ?? UNVERIFIED_RETENTION_MS);
    const cutoff = new Date(now - retentionMs);
    const [candidates] = await this.pool.execute(
      `SELECT DISTINCT u.id
       FROM \`user\` u
       INNER JOIN account a ON a.userId = u.id AND a.providerId = 'credential'
       WHERE u.emailVerified = 0
         AND u.createdAt < ?
         AND NOT EXISTS (SELECT 1 FROM session s WHERE s.userId = u.id)
         AND NOT EXISTS (
           SELECT 1 FROM workspaces w
           INNER JOIN decks d ON d.workspace_id = w.id
           WHERE w.personal_owner_user_id = u.id
         )
       LIMIT 100`,
      [cutoff]
    );

    let removed = 0;
    for (const candidate of candidates || []) {
      const userId = String(candidate.id);
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute(
          `SELECT id FROM \`user\`
           WHERE id = ? AND emailVerified = 0 AND createdAt < ?
           FOR UPDATE`,
          [userId, cutoff]
        );
        if (!users?.[0]) {
          await connection.rollback();
          continue;
        }
        const [proof] = await connection.execute(
          `SELECT
             EXISTS(SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential') AS credential_account,
             EXISTS(SELECT 1 FROM session WHERE userId = ?) AS has_session,
             EXISTS(
               SELECT 1 FROM workspaces w
               INNER JOIN decks d ON d.workspace_id = w.id
               WHERE w.personal_owner_user_id = ?
             ) AS has_decks`,
          [userId, userId, userId]
        );
        const state = proof?.[0] || {};
        if (!state.credential_account || state.has_session || state.has_decks) {
          await connection.rollback();
          continue;
        }
        await connection.execute("DELETE FROM workspaces WHERE personal_owner_user_id = ?", [userId]);
        const [result] = await connection.execute("DELETE FROM `user` WHERE id = ? AND emailVerified = 0", [userId]);
        await connection.commit();
        removed += Number(result?.affectedRows || 0);
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    }
    return removed;
  }
}

module.exports = { WorkspaceRepository, PERSONAL_WORKSPACE_KIND, FREE_PLAN, UNVERIFIED_RETENTION_MS, DOWNGRADE_GRACE_MS, pendingDowngrade, adjustmentRequiredError };
