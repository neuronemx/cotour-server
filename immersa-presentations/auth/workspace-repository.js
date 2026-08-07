const crypto = require("node:crypto");

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

  async registerDeck({ userId, workspaceId, deckId, sessionId }) {
    await this.pool.execute(
      `INSERT INTO decks (deck_id, workspace_id, session_id, created_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [String(deckId), String(workspaceId), String(sessionId), String(userId)]
    );
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
