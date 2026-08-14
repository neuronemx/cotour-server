const { getPlanLimits } = require("./plan-limits");

const CLAIM_RETRY_MS = 15 * 60 * 1000;

class DowngradeNotifier {
  constructor(pool, options = {}) {
    if (!pool) throw new Error("A MySQL pool is required for downgrade notifications");
    this.pool = pool;
    this.emailSender = options.emailSender || null;
    this.logger = options.logger || console;
    this.baseUrl = String(options.baseUrl || options.env?.BETTER_AUTH_URL || "https://app.immersalive.com").replace(/\/$/, "");
  }

  async runDue(limit = 20) {
    if (!this.emailSender) return 0;
    const [rows] = await this.pool.execute(
      `SELECT n.request_id, n.kind, n.workspace_id, n.target_plan, n.deadline_at,
              u.name, u.email, w.pending_plan_request_id,
              COUNT(d.deck_id) AS deck_count,
              COALESCE(SUM(d.source_size_bytes), 0) AS storage_bytes
       FROM plan_downgrade_notifications n
       INNER JOIN workspaces w ON w.id = n.workspace_id
       INNER JOIN \`user\` u ON u.id = w.personal_owner_user_id
       LEFT JOIN decks d ON d.workspace_id = w.id
       WHERE n.sent_at IS NULL
         AND n.available_at <= CURRENT_TIMESTAMP(3)
         AND (n.claimed_at IS NULL OR n.claimed_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))
       GROUP BY n.request_id, n.kind, n.workspace_id, n.target_plan, n.deadline_at,
                u.name, u.email, w.pending_plan_request_id
       ORDER BY n.available_at, n.request_id
       LIMIT ?`,
      [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    let sent = 0;
    for (const row of rows || []) sent += await this.deliver(row) ? 1 : 0;
    return sent;
  }

  async deliver(row) {
    const activeRequest = String(row.pending_plan_request_id || "") === String(row.request_id || "");
    if (row.kind !== "completed" && !activeRequest) {
      await this.pool.execute(
        "DELETE FROM plan_downgrade_notifications WHERE request_id = ? AND kind = ? AND sent_at IS NULL",
        [row.request_id, row.kind]
      );
      return false;
    }
    const [claim] = await this.pool.execute(
      `UPDATE plan_downgrade_notifications
       SET claimed_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1
       WHERE request_id = ? AND kind = ? AND sent_at IS NULL
         AND (claimed_at IS NULL OR claimed_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))`,
      [row.request_id, row.kind]
    );
    if (Number(claim?.affectedRows || 0) !== 1) return false;
    try {
      const limits = getPlanLimits(row.target_plan);
      const usage = {
        decks: Number(row.deck_count || 0),
        storageBytes: Number(row.storage_bytes || 0)
      };
      await this.emailSender({
        kind: `downgrade-${row.kind}`,
        to: row.email,
        name: row.name,
        url: `${this.baseUrl}/home`,
        downgrade: {
          targetPlan: limits.plan,
          deadlineAt: row.deadline_at,
          limits: { decks: limits.decks, storageBytes: limits.storageBytes },
          usage,
          excess: {
            decks: Math.max(0, usage.decks - limits.decks),
            storageBytes: Math.max(0, usage.storageBytes - limits.storageBytes)
          }
        }
      });
      await this.pool.execute(
        `UPDATE plan_downgrade_notifications
         SET sent_at = CURRENT_TIMESTAMP(3), claimed_at = NULL, last_error = NULL
         WHERE request_id = ? AND kind = ?`,
        [row.request_id, row.kind]
      );
      return true;
    } catch (error) {
      await this.pool.execute(
        `UPDATE plan_downgrade_notifications
         SET claimed_at = NULL, last_error = ?
         WHERE request_id = ? AND kind = ?`,
        [String(error?.message || error).slice(0, 500), row.request_id, row.kind]
      ).catch(() => {});
      this.logger.error("Unable to send an Immersa downgrade notification", error);
      return false;
    }
  }
}

module.exports = { DowngradeNotifier, CLAIM_RETRY_MS };
