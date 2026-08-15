const test = require("node:test");
const assert = require("node:assert/strict");
const { StripeBillingService, PAYMENT_RECOVERY_MS, subscriptionIdFromInvoice } = require("../billing/stripe-service");

function setup(overrides = {}) {
  const calls = [];
  const repository = {
    async getSubscription() { return overrides.subscription || null; },
    async findReusableCheckout() { return null; },
    async getCustomer() { return overrides.customerId || null; },
    async saveCustomer(_workspace, id) { calls.push(["saveCustomer", id]); return id; },
    async createCheckoutAttempt(payload) { calls.push(["attempt", payload]); return { id: "attempt-1", idempotencyKey: "idem-1" }; },
    async attachCheckoutSession(id, session) { calls.push(["attach", id, session.id]); },
    async workspaceForProvider() { return "workspace-1"; },
    async markCheckoutSession(...args) { calls.push(["mark", ...args]); },
    async upsertSubscription(_workspace, snapshot) { calls.push(["subscription", snapshot]); },
    async recalculateEntitlement(_workspace, options) { calls.push(["entitlement", options]); return { plan: "SPEAKER" }; },
    async recordWebhookEvent() { return overrides.duplicate ? false : true; },
    async finishWebhookEvent(...args) { calls.push(["finish", ...args]); },
    async accountStatus() { return { effectivePlan: "FREE", subscription: null, grants: [] }; }
  };
  const stripe = {
    customers: { async create() { return { id: "cus_1" }; } },
    checkout: { sessions: {
      async create(payload, request) { calls.push(["checkout", payload, request]); return { id: "cs_1", url: "https://checkout.stripe.test/1", expires_at: 1800000000 }; },
      async retrieve() { return null; }
    } },
    billingPortal: { sessions: { async create() { return { url: "https://billing.stripe.test/1" }; } } },
    subscriptions: { async retrieve() { return overrides.stripeSubscription || {
      id: "sub_1", customer: "cus_1", status: "active",
      items: { data: [{ price: { id: "price_speaker_month" }, current_period_start: 1786700000, current_period_end: 1789300000 }] }
    }; } },
    webhooks: { constructEvent() { return overrides.event; } }
  };
  const env = {
    IMMERSA_BILLING_ENABLED: "true",
    IMMERSA_BILLING_CHECKOUT_ENABLED: "true",
    IMMERSA_FOUNDERS_OFFER_END_AT: "2026-09-30T23:59:59-06:00",
    STRIPE_SECRET_KEY: "sk_test_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    STRIPE_SPEAKER_MONTHLY_PRICE_ID: "price_speaker_month",
    STRIPE_SPEAKER_ANNUAL_PRICE_ID: "price_speaker_year",
    STRIPE_SPEAKER_PRO_MONTHLY_PRICE_ID: "price_pro_month",
    STRIPE_SPEAKER_PRO_ANNUAL_PRICE_ID: "price_pro_year",
    STRIPE_FOUNDERS_SPEAKER_MONTHLY_COUPON_ID: "coupon_sm",
    STRIPE_FOUNDERS_SPEAKER_ANNUAL_COUPON_ID: "coupon_sy",
    STRIPE_FOUNDERS_SPEAKER_PRO_MONTHLY_COUPON_ID: "coupon_pm",
    STRIPE_FOUNDERS_SPEAKER_PRO_ANNUAL_COUPON_ID: "coupon_py",
    BETTER_AUTH_URL: "https://app.immersalive.com"
  };
  const service = new StripeBillingService({ repository, stripe, env, now: () => Date.parse("2026-08-15T12:00:00Z") });
  return { service, calls, repository };
}

test("Checkout resolves price and discount only from server configuration", async () => {
  const { service, calls } = setup();
  const result = await service.createCheckout({
    workspace: { id: "workspace-1" },
    user: { email: "speaker@example.com", name: "Speaker" }
  }, { plan: "SPEAKER_PRO", interval: "annual", offer: "founders", unitAmount: 1, priceId: "evil" });
  assert.equal(result.url, "https://checkout.stripe.test/1");
  const checkout = calls.find(([name]) => name === "checkout")[1];
  assert.equal(checkout.line_items[0].price, "price_pro_year");
  assert.deepEqual(checkout.discounts, [{ coupon: "coupon_py" }]);
  assert.equal(checkout.metadata.immersa_workspace_id, "workspace-1");
  assert.equal(JSON.stringify(checkout).includes("evil"), false);
});

test("an existing paid subscription cannot silently create a second Checkout", async () => {
  const { service } = setup({ subscription: { status: "active" } });
  await assert.rejects(
    () => service.createCheckout({ workspace: { id: "workspace-1" }, user: {} }, { plan: "SPEAKER", interval: "monthly" }),
    (error) => error.code === "SUBSCRIPTION_ALREADY_EXISTS" && error.statusCode === 409
  );
});

test("duplicate webhook is acknowledged without applying side effects twice", async () => {
  const event = { id: "evt_1", type: "invoice.paid", created: 1786795200, data: { object: { subscription: "sub_1" } } };
  const { service, calls } = setup({ event, duplicate: true });
  assert.deepEqual(await service.receiveWebhook(Buffer.from("{}"), "sig"), { duplicate: true });
  assert.equal(calls.some(([name]) => name === "subscription"), false);
});

test("out-of-order invoice events reconcile the current Stripe subscription snapshot", async () => {
  const event = { id: "evt_old", type: "invoice.payment_failed", created: 1786700000, data: { object: { subscription: "sub_1" } } };
  const { service, calls } = setup({ event });
  await service.receiveWebhook(Buffer.from("{}"), "sig");
  const snapshot = calls.find(([name]) => name === "subscription")[1];
  assert.equal(snapshot.status, "active");
  assert.equal(snapshot.plan, "SPEAKER");
  assert.equal(snapshot.accessUntil instanceof Date, true);
});

test("past_due access receives one explicit seven-day recovery boundary", async () => {
  const { service, calls } = setup({
    subscription: null,
    stripeSubscription: {
      id: "sub_1", customer: "cus_1", status: "past_due",
      items: { data: [{ price: { id: "price_speaker_month" }, current_period_end: 1789300000 }] }
    }
  });
  await service.reconcileSubscription(service.stripe ? await service.stripe.subscriptions.retrieve("sub_1") : null);
  const snapshot = calls.find(([name]) => name === "subscription")[1];
  assert.equal(snapshot.accessUntil.getTime(), Date.parse("2026-08-15T12:00:00Z") + PAYMENT_RECOVERY_MS);
});

test("invoice subscription id supports legacy and current Stripe invoice shapes", () => {
  assert.equal(subscriptionIdFromInvoice({ subscription: "sub_legacy" }), "sub_legacy");
  assert.equal(subscriptionIdFromInvoice({ parent: { subscription_details: { subscription: "sub_current" } } }), "sub_current");
});
