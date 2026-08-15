const Stripe = require("stripe");
const {
  PRICE_ENV_KEYS,
  FOUNDERS_COUPON_ENV_KEYS,
  billingFlags,
  publicCatalog,
  resolveCatalogEntry,
  publicError
} = require("./config");

const PAYMENT_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired"
]);

function subscriptionIdFromInvoice(invoice = {}) {
  const value = invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || invoice.lines?.data?.find((line) => line.parent?.subscription_item_details)?.parent?.subscription_item_details?.subscription;
  return typeof value === "string" ? value : value?.id || "";
}

function stripeId(value) {
  return typeof value === "string" ? value : value?.id || "";
}

class StripeBillingService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.env = options.env || process.env;
    this.logger = options.logger || console;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.isWorkspaceActive = options.isWorkspaceActive || (async () => false);
    this.flags = billingFlags(this.env);
    this.baseUrl = String(this.env.BETTER_AUTH_URL || "https://app.immersalive.com").replace(/\/$/, "");
    this.webhookSecret = String(this.env.STRIPE_WEBHOOK_SECRET || "").trim();
    this.stripe = options.stripe || (this.flags.enabled ? new Stripe(String(this.env.STRIPE_SECRET_KEY || "").trim(), {
      maxNetworkRetries: 2
    }) : null);
  }

  assertEnabled() {
    if (!this.flags.enabled || !this.stripe || !this.repository) throw publicError("BILLING_DISABLED", "Los cobros todavía no están habilitados", 503);
  }

  catalog() {
    return { enabled: this.flags.enabled, checkoutEnabled: this.flags.checkoutEnabled, ...publicCatalog(this.env, this.now()) };
  }

  async status(workspaceId) {
    if (!this.repository) return { ...this.catalog(), effectivePlan: "FREE", subscription: null, grants: [] };
    return { ...this.catalog(), ...(await this.repository.accountStatus(workspaceId)) };
  }

  async createCheckout(accountContext, payload = {}, options = {}) {
    this.assertEnabled();
    if (!this.flags.checkoutEnabled && !options.admin) throw publicError("BILLING_CHECKOUT_DISABLED", "La contratación todavía no está disponible", 503);
    const workspaceId = String(accountContext?.workspace?.id || "");
    if (!workspaceId) throw publicError("BILLING_ACCOUNT_REQUIRED", "Inicia sesión para contratar", 401);
    const entry = resolveCatalogEntry({ ...payload, env: this.env, now: this.now() });
    const current = await this.repository.getSubscription(workspaceId);
    if (current && ["active", "past_due"].includes(String(current.status))) {
      throw publicError("SUBSCRIPTION_ALREADY_EXISTS", "Administra tu suscripción actual para cambiar de plan", 409);
    }
    const reusable = await this.repository.findReusableCheckout({
      workspaceId, plan: entry.plan, interval: entry.interval, offer: entry.offer
    });
    if (reusable?.provider_checkout_session_id) {
      const session = await this.stripe.checkout.sessions.retrieve(String(reusable.provider_checkout_session_id));
      if (session?.url) return { url: session.url, reused: true };
    }
    let customerId = await this.repository.getCustomer(workspaceId);
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: String(accountContext.user?.email || "") || undefined,
        name: String(accountContext.user?.name || "") || undefined,
        metadata: { immersa_workspace_id: workspaceId }
      }, { idempotencyKey: `customer:${workspaceId}` });
      customerId = await this.repository.saveCustomer(workspaceId, customer.id);
    }
    const attempt = await this.repository.createCheckoutAttempt({
      workspaceId, plan: entry.plan, interval: entry.interval, offer: entry.offer, priceId: entry.priceId
    });
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: entry.priceId, quantity: 1 }],
      ...(entry.couponId ? { discounts: [{ coupon: entry.couponId }] } : { allow_promotion_codes: true }),
      success_url: `${this.baseUrl}/home?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.baseUrl}/home?billing=cancelled`,
      metadata: {
        immersa_workspace_id: workspaceId,
        immersa_checkout_attempt_id: attempt.id,
        immersa_plan: entry.plan,
        immersa_interval: entry.interval,
        immersa_offer: entry.offer
      },
      subscription_data: {
        metadata: { immersa_workspace_id: workspaceId, immersa_checkout_attempt_id: attempt.id }
      }
    }, { idempotencyKey: attempt.idempotencyKey });
    await this.repository.attachCheckoutSession(attempt.id, session);
    return { url: session.url, reused: false };
  }

  async createPortal(accountContext) {
    this.assertEnabled();
    const workspaceId = String(accountContext?.workspace?.id || "");
    const customerId = await this.repository.getCustomer(workspaceId);
    if (!customerId) throw publicError("BILLING_CUSTOMER_NOT_FOUND", "Todavía no tienes una suscripción para administrar", 404);
    const configuration = String(this.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID || "").trim();
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.baseUrl}/home?billing=portal-return`,
      ...(configuration ? { configuration } : {})
    });
    return { url: session.url };
  }

  catalogForPrice(priceId) {
    for (const [plan, intervals] of Object.entries(PRICE_ENV_KEYS)) {
      for (const [interval, key] of Object.entries(intervals)) {
        if (String(this.env[key] || "") === String(priceId)) {
          return {
            plan,
            interval,
            foundersCouponIds: Object.values(FOUNDERS_COUPON_ENV_KEYS[plan]).map((couponKey) => String(this.env[couponKey] || "")).filter(Boolean)
          };
        }
      }
    }
    return null;
  }

  async reconcileSubscription(subscription, eventCreatedAt = new Date(this.now())) {
    const customerId = stripeId(subscription.customer);
    const subscriptionId = String(subscription.id || "");
    const workspaceId = await this.repository.workspaceForProvider({ customerId, subscriptionId });
    if (!workspaceId) throw new Error(`No Immersa workspace found for Stripe subscription ${subscriptionId}`);
    const item = subscription.items?.data?.[0] || {};
    const priceId = stripeId(item.price);
    const catalog = this.catalogForPrice(priceId);
    if (!catalog) throw new Error(`Unknown Stripe price ${priceId}`);
    const periodStart = item.current_period_start || subscription.current_period_start;
    const periodEnd = item.current_period_end || subscription.current_period_end;
    const status = String(subscription.status || "");
    const existing = await this.repository.getSubscription(workspaceId);
    const accessUntil = status === "past_due"
      ? (existing?.access_until || new Date(this.now() + PAYMENT_RECOVERY_MS))
      : (status === "active" ? new Date(Number(periodEnd || 0) * 1000) : null);
    const discount = subscription.discounts?.[0] || subscription.discount || null;
    await this.repository.upsertSubscription(workspaceId, {
      subscriptionId,
      priceId,
      plan: catalog.plan,
      interval: catalog.interval,
      status,
      currentPeriodStart: periodStart ? new Date(Number(periodStart) * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(Number(periodEnd) * 1000) : null,
      accessUntil,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      canceledAt: subscription.canceled_at ? new Date(Number(subscription.canceled_at) * 1000) : null,
      discountId: stripeId(discount?.promotion_code || discount?.coupon || discount),
      eventCreatedAt
    });
    const protectDowngrade = await this.isWorkspaceActive(workspaceId);
    return this.repository.recalculateEntitlement(workspaceId, { now: this.now(), protectDowngrade });
  }

  async processEvent(event) {
    if (!RELEVANT_EVENTS.has(event.type)) return { ignored: true };
    const object = event.data?.object || {};
    if (event.type === "checkout.session.expired") {
      await this.repository.markCheckoutSession(object.id, "expired");
      return { expired: true };
    }
    if (event.type === "checkout.session.completed") {
      const customerId = stripeId(object.customer);
      const workspaceId = await this.repository.workspaceForProvider({
        customerId,
        checkoutSessionId: object.id
      });
      if (workspaceId && customerId) await this.repository.saveCustomer(workspaceId, customerId);
      const subscriptionId = stripeId(object.subscription);
      await this.repository.markCheckoutSession(object.id, "completed", subscriptionId);
      if (!subscriptionId) return { pending: true };
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
      return this.reconcileSubscription(subscription, new Date(Number(event.created) * 1000));
    }
    let subscriptionId = event.type.startsWith("invoice.") ? subscriptionIdFromInvoice(object) : String(object.id || "");
    if (!subscriptionId) return { ignored: true };
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
    return this.reconcileSubscription(subscription, new Date(Number(event.created) * 1000));
  }

  async receiveWebhook(rawBody, signature) {
    this.assertEnabled();
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is required when billing is enabled");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const inserted = await this.repository.recordWebhookEvent(event);
    if (!inserted) return { duplicate: true };
    try {
      const result = await this.processEvent(event);
      await this.repository.finishWebhookEvent(event.id);
      return result;
    } catch (error) {
      await this.repository.finishWebhookEvent(event.id, error).catch(() => {});
      throw error;
    }
  }
}

module.exports = {
  StripeBillingService,
  PAYMENT_RECOVERY_MS,
  RELEVANT_EVENTS,
  subscriptionIdFromInvoice,
  stripeId
};
