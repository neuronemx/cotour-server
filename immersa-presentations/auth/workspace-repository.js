const crypto = require("node:crypto");
const { summarizePlanUsage, assertCanReserveDeck, assertCanReplaceDeck } = require("./plan-limits");
const { DEMO_PLAN, createDemoBinding } = require("./deck-demo");

const PERSONAL_WORKSPACE_KIND = "personal";
const FREE_PLAN = "FREE";
const UNVERIFIED_RETENTION_MS = 48 * 60 * 60 * 1000;

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

  async ensureDemoDeck({ userId, workspaceId }) {
    const find = async (executor) => {
      const [rows] = await executor.execute(
        `SELECT ds.workspace_id, ds.deck_id, ds.session_id, ds.reset_count
         FROM workspace_demo_sessions ds
         INNER JOIN workspace_members wm ON wm.workspace_id = ds.workspace_id
         WHERE ds.workspace_id = ? AND wm.user_id = ?
         LIMIT 1`,
        [String(workspaceId), String(userId)]
      );
      const row = rows?.[0];
      return row ? {
        workspaceId: String(row.workspace_id),
        deckId: String(row.deck_id),
        sessionId: String(row.session_id),
        resetCount: Number(row.reset_count || 0)
      } : null;
    };

    const existing = await find(this.pool);
    if (existing) return existing;

    const binding = createDemoBinding(workspaceId);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [memberships] = await connection.execute(
        `SELECT 1 AS member
         FROM workspace_members
         WHERE workspace_id = ? AND user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      if (!memberships?.[0]) throw new Error("Immersa workspace not found");
      await connection.execute(
        `INSERT INTO workspace_demo_sessions (workspace_id, deck_id, session_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE workspace_id = workspace_id`,
        [binding.workspaceId, binding.deckId, binding.sessionId]
      );
      const resolved = await find(connection);
      if (!resolved) throw new Error("Unable to provision the IMMERSA Demo");
      await connection.commit();
      return resolved;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async findDemoBySessionId(sessionId) {
    const [rows] = await this.pool.execute(
      `SELECT workspace_id, deck_id, session_id, reset_count
       FROM workspace_demo_sessions
       WHERE session_id = ?
       LIMIT 1`,
      [String(sessionId)]
    );
    const row = rows?.[0];
    return row ? {
      workspaceId: String(row.workspace_id),
      deckId: String(row.deck_id),
      sessionId: String(row.session_id),
      resetCount: Number(row.reset_count || 0)
    } : null;
  }

  async resetDemoDeck({ userId, workspaceId }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT ds.deck_id, ds.session_id, ds.reset_count
         FROM workspace_demo_sessions ds
         INNER JOIN workspace_members wm ON wm.workspace_id = ds.workspace_id
         WHERE ds.workspace_id = ? AND wm.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      const current = rows?.[0];
      if (!current) throw new Error("IMMERSA Demo not found");
      const next = createDemoBinding(workspaceId);
      await connection.execute("DELETE FROM presentation_sessions WHERE deck_id = ?", [String(current.deck_id)]);
      await connection.execute(
        `UPDATE workspace_demo_sessions
         SET deck_id = ?, session_id = ?, reset_count = reset_count + 1
         WHERE workspace_id = ?`,
        [next.deckId, next.sessionId, String(workspaceId)]
      );
      await connection.commit();
      return {
        previous: {
          deckId: String(current.deck_id),
          sessionId: String(current.session_id),
          resetCount: Number(current.reset_count || 0)
        },
        current: {
          ...next,
          resetCount: Number(current.reset_count || 0) + 1
        }
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async clearDemoPractice({ deckId, sessionId }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT deck_id, session_id
         FROM workspace_demo_sessions
         WHERE deck_id = ? AND session_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(deckId), String(sessionId)]
      );
      if (!rows?.[0]) return false;
      await connection.execute("DELETE FROM presentation_sessions WHERE deck_id = ?", [String(deckId)]);
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
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
    if (rows?.[0]) return true;
    const [demoRows] = await this.pool.execute(
      `SELECT 1 AS owned
       FROM workspace_demo_sessions ds
       INNER JOIN workspace_members wm ON wm.workspace_id = ds.workspace_id
       WHERE wm.user_id = ? AND ds.deck_id = ?
       LIMIT 1`,
      [String(userId), String(deckId)]
    );
    return Boolean(demoRows?.[0]);
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
    if (rows?.[0]) return String(rows[0].deck_id);
    const [demoRows] = await this.pool.execute(
      `SELECT ds.deck_id
       FROM workspace_demo_sessions ds
       INNER JOIN workspace_members wm ON wm.workspace_id = ds.workspace_id
       WHERE wm.user_id = ? AND ds.session_id = ?
       LIMIT 1`,
      [String(userId), String(sessionId)]
    );
    return demoRows?.[0] ? String(demoRows[0].deck_id) : null;
  }

  async getDeckPlan(deckId) {
    const [rows] = await this.pool.execute(
      `SELECT w.plan
       FROM decks d
       INNER JOIN workspaces w ON w.id = d.workspace_id
       WHERE d.deck_id = ?
       LIMIT 1`,
      [String(deckId)]
    );
    if (rows?.[0]?.plan) return String(rows[0].plan).trim().toUpperCase();
    const [demoRows] = await this.pool.execute(
      `SELECT 1 AS demo
       FROM workspace_demo_sessions
       WHERE deck_id = ?
       LIMIT 1`,
      [String(deckId)]
    );
    return demoRows?.[0] ? DEMO_PLAN : null;
  }

  async getPlanUsage({ userId, workspaceId }) {
    const [rows] = await this.pool.execute(
      `SELECT w.plan,
              COUNT(d.deck_id) AS deck_count,
              COALESCE(SUM(d.source_size_bytes), 0) AS storage_bytes
       FROM workspaces w
       INNER JOIN workspace_members wm ON wm.workspace_id = w.id
       LEFT JOIN decks d ON d.workspace_id = w.id
       WHERE w.id = ? AND wm.user_id = ?
       GROUP BY w.id, w.plan
       LIMIT 1`,
      [String(workspaceId), String(userId)]
    );
    const row = rows?.[0];
    if (!row) throw new Error("Immersa workspace not found");
    return summarizePlanUsage(row.plan, {
      decks: row.deck_count,
      storageBytes: row.storage_bytes
    });
  }

  async listUnmeteredDeckIds({ userId, workspaceId }) {
    const [rows] = await this.pool.execute(
      `SELECT d.deck_id
       FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE d.workspace_id = ?
         AND wm.user_id = ?
         AND d.source_size_bytes IS NULL`,
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
         AND wm.user_id = ?
         AND d.source_size_bytes IS NULL`,
      [bytes, String(workspaceId), String(deckId), String(userId)]
    );
    return Number(result?.affectedRows || 0) > 0;
  }

  async reserveDeck({ userId, workspaceId, deckId, sessionId, sourceSizeBytes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [workspaces] = await connection.execute(
        `SELECT w.id, w.plan
         FROM workspaces w
         INNER JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE w.id = ? AND wm.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      const workspace = workspaces?.[0];
      if (!workspace) throw new Error("Immersa workspace not found");

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
        `SELECT w.id, w.plan
         FROM workspaces w
         INNER JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE w.id = ? AND wm.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(workspaceId), String(userId)]
      );
      const workspace = workspaces?.[0];
      if (!workspace) throw new Error("Immersa workspace not found");

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
      await connection.commit();
      return {
        previousSourceSizeBytes,
        plan: summarizePlanUsage(workspace.plan, {
          decks: usage.usage.decks,
          storageBytes: usage.usage.storageBytes - previousSourceSizeBytes + nextSourceSizeBytes
        })
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async unregisterDeck(userId, deckId) {
    const [result] = await this.pool.execute(
      `DELETE d FROM decks d
       INNER JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
       WHERE wm.user_id = ? AND d.deck_id = ?`,
      [String(userId), String(deckId)]
    );
    return Number(result?.affectedRows || 0) > 0;
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

module.exports = { WorkspaceRepository, PERSONAL_WORKSPACE_KIND, FREE_PLAN, UNVERIFIED_RETENTION_MS };
