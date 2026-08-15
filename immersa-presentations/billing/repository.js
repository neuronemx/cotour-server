const crypto = require("node:crypto");
const { selectEffectiveEntitlement } = require("./entitlements");
const { PLAN_RANK } = require("./config");
const { normalizePlan } = require("../auth/plan-features");

function sqlDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

class BillingRepository {
  constructor(pool) {
    if (!pool) throw new Error("A MySQL pool is required for billing");
    this.pool = pool;
  }

  async getCustomer(workspaceId) {
    const [rows] = await this.pool.execute(
      "SELECT provider_customer_id FROM billing_customers WHERE workspace_id = ? LIMIT 1",
      [String(workspaceId)]
    );
    return rows?.[0]?.provider_customer_id ? String(rows[0].provider_customer_id) : null;
  }

  async saveCustomer(workspaceId, customerId) {
    await this.pool.execute(
      `INSERT INTO billing_customers (workspace_id, provider, provider_customer_id)
       VALUES (?, 'stripe', ?)
       ON DUPLICATE KEY UPDATE provider_customer_id = VALUES(provider_customer_id)`,
      [String(workspaceId), String(customerId)]
    );
    return String(customerId);
  }

  async findReusableCheckout({ workspaceId, plan, interval, offer }) {
    const [rows] = await this.pool.execute(
      `SELECT id, provider_checkout_session_id, checkout_url_expires_at
       FROM billing_checkout_attempts
       WHERE workspace_id = ? AND requested_plan = ? AND billing_interval = ? AND offer_source = ?
         AND status = 'open' AND checkout_url_expires_at > CURRENT_TIMESTAMP(3)
       ORDER BY created_at DESC LIMIT 1`,
      [String(workspaceId), plan, interval, offer]
    );
    return rows?.[0] || null;
  }

  async createCheckoutAttempt({ workspaceId, plan, interval, offer, priceId }) {
    const id = crypto.randomUUID();
    const idempotencyKey = `checkout:${workspaceId}:${id}`;
    await this.pool.execute(
      `INSERT INTO billing_checkout_attempts
         (id, workspace_id, requested_plan, billing_interval, offer_source, provider_price_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, String(workspaceId), plan, interval, offer, priceId, idempotencyKey]
    );
    return { id, idempotencyKey };
  }

  async attachCheckoutSession(attemptId, session) {
    await this.pool.execute(
      `UPDATE billing_checkout_attempts
       SET provider_checkout_session_id = ?, status = 'open', checkout_url_expires_at = ?
       WHERE id = ?`,
      [String(session.id), sqlDate(Number(session.expires_at) * 1000), String(attemptId)]
    );
  }

  async markCheckoutSession(sessionId, status, subscriptionId = null) {
    await this.pool.execute(
      `UPDATE billing_checkout_attempts
       SET status = ?, provider_subscription_id = COALESCE(?, provider_subscription_id),
           completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP(3) ELSE completed_at END
       WHERE provider_checkout_session_id = ?`,
      [String(status), subscriptionId ? String(subscriptionId) : null, String(status), String(sessionId)]
    );
  }

  async getSubscription(workspaceId) {
    const [rows] = await this.pool.execute(
      `SELECT provider_subscription_id, provider_price_id, plan, billing_interval, status,
              current_period_start, current_period_end, access_until, cancel_at_period_end,
              canceled_at, discount_id, synced_at
       FROM billing_subscriptions WHERE workspace_id = ? LIMIT 1`,
      [String(workspaceId)]
    );
    return rows?.[0] || null;
  }

  async getActiveGrants(workspaceId) {
    const [rows] = await this.pool.execute(
      `SELECT id, plan, origin, starts_at, ends_at, revoked_at
       FROM workspace_plan_grants
       WHERE workspace_id = ? AND revoked_at IS NULL
         AND starts_at <= CURRENT_TIMESTAMP(3)
         AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3))`,
      [String(workspaceId)]
    );
    return rows || [];
  }

  async workspaceForDeck(deckId) {
    const [rows] = await this.pool.execute(
      "SELECT workspace_id FROM decks WHERE deck_id = ? LIMIT 1",
      [String(deckId)]
    );
    return rows?.[0]?.workspace_id ? String(rows[0].workspace_id) : null;
  }

  async workspaceForProvider({ customerId = "", subscriptionId = "", checkoutSessionId = "" } = {}) {
    if (subscriptionId) {
      const [rows] = await this.pool.execute(
        "SELECT workspace_id FROM billing_subscriptions WHERE provider_subscription_id = ? LIMIT 1",
        [String(subscriptionId)]
      );
      if (rows?.[0]) return String(rows[0].workspace_id);
    }
    if (customerId) {
      const [rows] = await this.pool.execute(
        "SELECT workspace_id FROM billing_customers WHERE provider_customer_id = ? LIMIT 1",
        [String(customerId)]
      );
      if (rows?.[0]) return String(rows[0].workspace_id);
    }
    if (checkoutSessionId) {
      const [rows] = await this.pool.execute(
        "SELECT workspace_id FROM billing_checkout_attempts WHERE provider_checkout_session_id = ? LIMIT 1",
        [String(checkoutSessionId)]
      );
      if (rows?.[0]) return String(rows[0].workspace_id);
    }
    return null;
  }

  async upsertSubscription(workspaceId, snapshot) {
    await this.pool.execute(
      `INSERT INTO billing_subscriptions
         (workspace_id, provider, provider_subscription_id, provider_price_id, plan, billing_interval,
          status, current_period_start, current_period_end, access_until, cancel_at_period_end,
          canceled_at, discount_id, last_event_created_at, synced_at)
       VALUES (?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         provider_subscription_id = VALUES(provider_subscription_id),
         provider_price_id = VALUES(provider_price_id),
         plan = VALUES(plan),
         billing_interval = VALUES(billing_interval),
         status = VALUES(status),
         current_period_start = VALUES(current_period_start),
         current_period_end = VALUES(current_period_end),
         access_until = CASE
           WHEN VALUES(status) = 'past_due' THEN COALESCE(access_until, VALUES(access_until))
           ELSE VALUES(access_until)
         END,
         cancel_at_period_end = VALUES(cancel_at_period_end),
         canceled_at = VALUES(canceled_at),
         discount_id = VALUES(discount_id),
         last_event_created_at = GREATEST(COALESCE(last_event_created_at, '1970-01-01'), VALUES(last_event_created_at)),
         synced_at = CURRENT_TIMESTAMP(3)`,
      [
        String(workspaceId), snapshot.subscriptionId, snapshot.priceId, snapshot.plan, snapshot.interval,
        snapshot.status, sqlDate(snapshot.currentPeriodStart), sqlDate(snapshot.currentPeriodEnd),
        sqlDate(snapshot.accessUntil), snapshot.cancelAtPeriodEnd ? 1 : 0, sqlDate(snapshot.canceledAt),
        snapshot.discountId || null, sqlDate(snapshot.eventCreatedAt)
      ]
    );
  }

  async claimWebhookEvent(event) {
    const values = [
      String(event.id),
      String(event.type),
      String(event.data?.object?.id || "") || null,
      sqlDate(Number(event.created) * 1000)
    ];
    await this.pool.execute(
      `INSERT IGNORE INTO billing_webhook_events
         (event_id, event_type, provider_object_id, event_created_at)
       VALUES (?, ?, ?, ?)`,
      values
    );
    const [result] = await this.pool.execute(
      `UPDATE billing_webhook_events
       SET status = 'pending', claimed_at = CURRENT_TIMESTAMP(3), last_error = NULL
       WHERE event_id = ?
         AND status IN ('pending', 'failed')
         AND available_at <= CURRENT_TIMESTAMP(3)
         AND (claimed_at IS NULL OR claimed_at < CURRENT_TIMESTAMP(3) - INTERVAL 5 MINUTE)`,
      [String(event.id)]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async finishWebhookEvent(eventId, error = null) {
    await this.pool.execute(
      `UPDATE billing_webhook_events
       SET status = ?, attempts = attempts + 1, processed_at = ?, claimed_at = NULL, last_error = ?
       WHERE event_id = ?`,
      [error ? "failed" : "processed", error ? null : new Date(), error ? String(error.message || error).slice(0, 500) : null, String(eventId)]
    );
  }

  async accountStatus(workspaceId) {
    const [rows] = await this.pool.execute(
      `SELECT w.plan AS effective_plan, s.provider_subscription_id, s.plan AS subscribed_plan,
              s.billing_interval, s.status, s.current_period_end, s.access_until,
              s.cancel_at_period_end, s.discount_id, s.synced_at
       FROM workspaces w
       LEFT JOIN billing_subscriptions s ON s.workspace_id = w.id
       WHERE w.id = ? LIMIT 1`,
      [String(workspaceId)]
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      effectivePlan: normalizePlan(row.effective_plan) || "FREE",
      subscription: row.provider_subscription_id ? {
        id: String(row.provider_subscription_id),
        plan: normalizePlan(row.subscribed_plan),
        interval: String(row.billing_interval),
        status: String(row.status),
        currentPeriodEnd: row.current_period_end,
        accessUntil: row.access_until,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        discountId: row.discount_id || null,
        syncedAt: row.synced_at
      } : null,
      grants: await this.getActiveGrants(workspaceId)
    };
  }

  async recalculateEntitlement(workspaceId, options = {}) {
    const subscription = await this.getSubscription(workspaceId);
    const grants = await this.getActiveGrants(workspaceId);
    const entitlement = selectEffectiveEntitlement({ subscription, grants, now: options.now || Date.now() });
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT plan FROM workspaces WHERE id = ? FOR UPDATE", [String(workspaceId)]);
      const previousPlan = normalizePlan(rows?.[0]?.plan) || "FREE";
      if (!rows?.[0]) throw new Error("Immersa workspace not found");
      if ((PLAN_RANK[entitlement.plan] || 0) < (PLAN_RANK[previousPlan] || 0) && options.protectDowngrade) {
        await connection.execute(
          `INSERT INTO billing_audit_log (workspace_id, event_type, previous_plan, next_plan, source, note)
           VALUES (?, 'plan_change_deferred', ?, ?, ?, 'Presentación activa')`,
          [String(workspaceId), previousPlan, entitlement.plan, entitlement.source]
        );
        await connection.commit();
        return { ...entitlement, plan: previousPlan, deferredPlan: entitlement.plan };
      }
      if (previousPlan !== entitlement.plan) {
        await connection.execute("UPDATE workspaces SET plan = ? WHERE id = ?", [entitlement.plan, String(workspaceId)]);
        await connection.execute(
          `INSERT INTO workspace_plan_changes
             (workspace_id, previous_plan, next_plan, source, changed_by_user_id, note)
           VALUES (?, ?, ?, 'billing', 'system:stripe', ?)`,
          [String(workspaceId), previousPlan, entitlement.plan, `Origen efectivo: ${entitlement.source}`]
        );
        await connection.execute(
          `INSERT INTO billing_audit_log
             (workspace_id, event_type, previous_plan, next_plan, source, provider_object_id)
           VALUES (?, 'effective_plan_changed', ?, ?, ?, ?)`,
          [String(workspaceId), previousPlan, entitlement.plan, entitlement.source, entitlement.sourceId]
        );
      }
      await connection.commit();
      return entitlement;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = { BillingRepository, sqlDate };
