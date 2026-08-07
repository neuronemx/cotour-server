const crypto = require("node:crypto");

const PERSONAL_WORKSPACE_KIND = "personal";
const FREE_PLAN = "FREE";

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
}

module.exports = { WorkspaceRepository, PERSONAL_WORKSPACE_KIND, FREE_PLAN };
