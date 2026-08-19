const CLAIM_RETRY_MINUTES = 15;
const NOTIFICATION_INTERVAL_MS = 15 * 60 * 1000;

class BillingNotifier {
  constructor(pool, options = {}) {
    if (!pool) throw new Error("A MySQL pool is required for billing notifications");
    this.pool = pool;
    this.emailSender = options.emailSender || null;
    this.logger = options.logger || console;
    this.baseUrl = String(options.baseUrl || options.env?.BETTER_AUTH_URL || "https://app.immersalive.com").replace(/\/$/, "");
    this.timer = null;
  }

  async findDue(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const [rows] = await this.pool.execute(
      `SELECT n.id, n.kind, n.provider_object_id, n.plan, n.amount_total,
              n.currency, n.period_end, u.name, u.email
       FROM billing_email_notifications n
       INNER JOIN workspaces w ON w.id = n.workspace_id
       INNER JOIN \`user\` u ON u.id = w.personal_owner_user_id
       WHERE n.sent_at IS NULL
         AND n.available_at <= CURRENT_TIMESTAMP(3)
         AND (n.claimed_at IS NULL OR n.claimed_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${CLAIM_RETRY_MINUTES} MINUTE))
       ORDER BY n.available_at, n.id
       LIMIT ${safeLimit}`
    );
    return rows || [];
  }

  async deliver(row) {
    const [claim] = await this.pool.execute(
      `UPDATE billing_email_notifications
       SET claimed_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1
       WHERE id = ? AND sent_at IS NULL
         AND (claimed_at IS NULL OR claimed_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${CLAIM_RETRY_MINUTES} MINUTE))`,
      [row.id]
    );
    if (Number(claim?.affectedRows || 0) !== 1) return false;
    try {
      const emailUrl = row.kind === "payment-failed"
        ? this.baseUrl + "/home?billing=recovery"
        : this.baseUrl + "/home";
      await this.emailSender({
        kind: "billing-" + row.kind,
        to: row.email,
        name: row.name,
        url: emailUrl,
        billing: {
          plan: row.plan,
          amountTotal: row.amount_total,
          currency: row.currency,
          periodEnd: row.period_end
        }
      });
      await this.pool.execute(
        `UPDATE billing_email_notifications
         SET sent_at = CURRENT_TIMESTAMP(3), claimed_at = NULL, last_error = NULL
         WHERE id = ?`,
        [row.id]
      );
      return true;
    } catch (error) {
      await this.pool.execute(
        `UPDATE billing_email_notifications
         SET claimed_at = NULL, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${CLAIM_RETRY_MINUTES} MINUTE),
             last_error = ?
         WHERE id = ?`,
        [String(error?.message || error).slice(0, 500), row.id]
      ).catch(() => {});
      this.logger.error("[billing-email] Transactional notification failed", {
        kind: row.kind,
        notificationId: row.id,
        message: String(error?.message || error).slice(0, 200)
      });
      return false;
    }
  }

  async runDue(limit = 20) {
    if (!this.emailSender) return 0;
    const rows = await this.findDue(limit);
    let sent = 0;
    for (const row of rows) sent += await this.deliver(row) ? 1 : 0;
    return sent;
  }

  start() {
    if (!this.emailSender || this.timer) return;
    const run = () => this.runDue().then((sent) => {
      if (sent) this.logger.log("[billing-email] Sent transactional notifications", { count: sent });
    }).catch((error) => this.logger.error("[billing-email] Queue processing failed", {
      message: String(error?.message || error).slice(0, 200)
    }));
    run();
    this.timer = setInterval(run, NOTIFICATION_INTERVAL_MS);
    this.timer.unref?.();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { BillingNotifier, CLAIM_RETRY_MINUTES, NOTIFICATION_INTERVAL_MS };
