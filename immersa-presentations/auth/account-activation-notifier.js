const ACTIVATION_WINDOW_MS = 48 * 60 * 60 * 1000;

function adminNotificationEmails(env = process.env) {
  return [...new Set(
    [env.IMMERSA_ADMIN_EMAIL, env.IMMERSA_ADMIN_EMAILS]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[;,\s]+/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
}

class AccountActivationNotifier {
  constructor(pool, options = {}) {
    if (!pool) throw new Error("A MySQL pool is required for account activation notifications");
    this.pool = pool;
    this.emailSender = options.emailSender || null;
    this.recipients = options.recipients || adminNotificationEmails(options.env);
    this.logger = options.logger || console;
    this.now = typeof options.now === "function" ? options.now : Date.now;
  }

  async notify(session) {
    if (!this.emailSender || !this.recipients.length) return false;
    const userId = String(session?.userId || "").trim();
    if (!userId) return false;

    let claimed = false;
    let delivered = false;
    try {
      const [rows] = await this.pool.execute(
        `SELECT u.id, u.name, u.email, u.emailVerified, u.createdAt,
                COALESCE(w.plan, 'FREE') AS plan
         FROM \`user\` u
         LEFT JOIN workspaces w ON w.personal_owner_user_id = u.id
         WHERE u.id = ?
         LIMIT 1`,
        [userId]
      );
      const user = rows?.[0];
      if (!user || !Boolean(user.emailVerified ?? user.email_verified)) return false;

      const createdAt = new Date(user.createdAt ?? user.created_at).getTime();
      const activatedAt = new Date(session.createdAt || this.now()).getTime();
      if (!Number.isFinite(createdAt) || !Number.isFinite(activatedAt) || activatedAt - createdAt > ACTIVATION_WINDOW_MS) {
        return false;
      }

      const [claim] = await this.pool.execute(
        `INSERT IGNORE INTO account_activation_notifications (user_id)
         VALUES (?)`,
        [userId]
      );
      claimed = Number(claim?.affectedRows || 0) === 1;
      if (!claimed) return false;

      await this.emailSender({
        kind: "account-activation",
        to: this.recipients,
        user: { id: user.id, name: user.name, email: user.email, plan: user.plan || "FREE" },
        activatedAt: new Date(activatedAt)
      });
      delivered = true;
      await this.pool.execute(
        `UPDATE account_activation_notifications
         SET notified_at = CURRENT_TIMESTAMP(3)
         WHERE user_id = ?`,
        [userId]
      ).catch((error) => {
        this.logger.error("Unable to timestamp an Immersa account activation notification", error);
      });
      return true;
    } catch (error) {
      if (claimed && !delivered) {
        await this.pool.execute("DELETE FROM account_activation_notifications WHERE user_id = ?", [userId]).catch(() => {});
      }
      this.logger.error("Unable to notify Immersa administrators about an active account", error);
      return false;
    }
  }
}

module.exports = { AccountActivationNotifier, ACTIVATION_WINDOW_MS, adminNotificationEmails };
