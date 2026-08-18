const test = require("node:test");
const assert = require("node:assert/strict");
const {
  StripeBillingService,
  PAYMENT_RECOVERY_MS,
  subscriptionIdFromInvoice,
  invoiceRequestDeadline,
  fiscalData
} = require("../billing/stripe-service");

function setup(overrides = {}) {
  const calls = [];
  const repository = {
    async getSubscription() { return overrides.subscription || null; },
    async findReusableCheckout() { return null; },
    async getCustomer() { return overrides.customerId || null; },
    async saveCustomer(_workspace, id) { calls.push(["saveCustomer", id]); return id; },
    async clearCustomer(_workspace, id) { calls.push(["clearCustomer", id]); },
    async createCheckoutAttempt(payload) { calls.push(["attempt", payload]); return { id: "attempt-1", idempotencyKey: "idem-1" }; },
    async attachCheckoutSession(id, session) { calls.push(["attach", id, session.id]); },
    async workspaceForProvider() { return "workspace-1"; },
    async markCheckoutSession(...args) { calls.push(["mark", ...args]); },
    async upsertSubscription(_workspace, snapshot) { calls.push(["subscription", snapshot]); },
    async recalculateEntitlement(_workspace, options) { calls.push(["entitlement", options]); return { plan: "SPEAKER" }; },
    async claimWebhookEvent() {
      if (Array.isArray(overrides.claims)) return overrides.claims.shift();
      return overrides.duplicate ? false : true;
    },
    async finishWebhookEvent(...args) { calls.push(["finish", ...args]); },
    async getActiveGrants() { return []; },
    async listInvoiceRequests() { return overrides.invoiceRequests || []; },
    async getInvoiceRequest() { return overrides.existingInvoiceRequest || null; },
    async createInvoiceRequest(payload) { calls.push(["invoiceRequest", payload]); return { id: "request-1", ...payload, status: "pending" }; },
    async listAdminInvoiceRequests() { return []; },
    async updateInvoiceRequest(payload) { calls.push(["invoiceRequestUpdate", payload]); return payload; },
    async queueBillingEmail(payload) { calls.push(["billingEmail", payload]); return true; },
    async createPlanGrant(payload) { calls.push(["grant", payload]); return { id: "grant-1", ...payload }; },
    async accountStatus() { return { effectivePlan: "FREE", subscription: null, grants: [], history: [] }; }
  };
  const stripe = {
    customers: {
      async create() { calls.push(["customerCreate"]); return { id: "cus_1" }; },
      ...(overrides.customerRetrieve ? { async retrieve(id) { calls.push(["customerRetrieve", id]); return overrides.customerRetrieve(id); } } : {})
    },
    checkout: { sessions: {
      async create(payload, request) { calls.push(["checkout", payload, request]); return { id: "cs_1", url: "https://checkout.stripe.test/1", expires_at: 1800000000 }; },
      async retrieve() { return null; }
    } },
    billingPortal: { sessions: {
      async create(payload) { calls.push(["portal", payload]); return { url: "https://billing.stripe.test/1" }; }
    } },
    invoices: {
      async list() { return { data: overrides.stripeInvoices || [] }; },
      async retrieve(id) {
        return (overrides.stripeInvoices || []).find((invoice) => invoice.id === id) || null;
      }
    },
    subscriptions: {
      async retrieve() { return overrides.stripeSubscription || {
        id: "sub_1", customer: "cus_1", status: "active",
        discounts: overrides.stripeDiscounts || (overrides.subscription?.discount_id
          ? [{ coupon: { id: overrides.subscription.discount_id } }]
          : []),
        items: { data: [{ id: "si_1", price: { id: "price_speaker_month" }, current_period_start: 1786700000, current_period_end: 1789300000 }] }
      }; },
      async update(id, payload, request) {
        calls.push(["subscriptionUpdate", id, payload, request]);
        return {
          id,
          latest_invoice: {
            id: "in_1",
            hosted_invoice_url: "https://invoice.stripe.test/1",
            payment_intent: { status: "succeeded" }
          }
        };
      }
    },
    subscriptionSchedules: {
      async create(payload, request) {
        calls.push(["scheduleCreate", payload, request]);
        return overrides.stripeSchedule || {
          id: "sub_sched_1",
          phases: [{
            start_date: 1786700000,
            end_date: 1789300000,
            items: [{ price: "price_speaker_month", quantity: 1 }]
          }]
        };
      },
      async update(id, payload, request) {
        calls.push(["scheduleUpdate", id, payload, request]);
        if (overrides.scheduleUpdateError) throw overrides.scheduleUpdateError;
        return { id };
      }
    },
    webhooks: { constructEvent() { return overrides.event; } }
  };
  const env = {
    IMMERSA_BILLING_ENABLED: "true",
    IMMERSA_BILLING_CHECKOUT_ENABLED: "true",
    IMMERSA_FOUNDERS_OFFER_END_AT: "2026-10-31T23:59:59-06:00",
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
  const service = new StripeBillingService({
    repository,
    stripe,
    env,
    now: overrides.now || (() => Date.parse("2026-08-15T12:00:00Z"))
  });
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

test("Checkout replaces a stored Stripe customer that was deleted from the test environment", async () => {
  const { service, calls } = setup({
    customerId: "cus_deleted",
    customerRetrieve: async () => {
      const error = new Error("No such customer: 'cus_deleted'");
      error.code = "resource_missing";
      error.param = "customer";
      throw error;
    }
  });
  await service.createCheckout({
    workspace: { id: "workspace-1" },
    user: { email: "speaker@example.com", name: "Speaker" }
  }, { plan: "SPEAKER", interval: "monthly", offer: "official" });
  assert.deepEqual(calls.find(([name]) => name === "clearCustomer"), ["clearCustomer", "cus_deleted"]);
  assert.deepEqual(calls.find(([name]) => name === "customerCreate"), ["customerCreate"]);
  assert.equal(calls.find(([name]) => name === "checkout")[1].customer, "cus_1");
});

test("admin cannot lower an active paid subscription with a manual action", async () => {
  const { service } = setup({ subscription: { status: "active", plan: "SPEAKER_PRO" } });
  await assert.rejects(
    () => service.assertManualPlanChangeAllowed("workspace-1", "SPEAKER"),
    (error) => error.code === "PAID_SUBSCRIPTION_PROTECTED" && error.statusCode === 409
  );
});

test("plan grants preserve their commercial origin without creating Stripe data", async () => {
  const { service, calls } = setup();
  const result = await service.createPlanGrant(
    { user: { id: "admin-1" } },
    "workspace-1",
    { plan: "SPEAKER", origin: "pilot", endsAt: "2026-09-01T00:00:00Z", note: "Piloto de evento" }
  );
  const grant = calls.find(([name]) => name === "grant")[1];
  assert.equal(grant.origin, "pilot");
  assert.equal(grant.plan, "SPEAKER");
  assert.equal(result.entitlement.plan, "SPEAKER");
  assert.equal(calls.some(([name]) => name === "saveCustomer"), false);
});

test("a commercial grant cannot bypass downgrade validations", async () => {
  const { service } = setup();
  service.repository.accountStatus = async () => ({ effectivePlan: "SPEAKER_PRO", subscription: null, grants: [] });
  await assert.rejects(
    () => service.createPlanGrant(
      { user: { id: "admin-1" } },
      "workspace-1",
      { plan: "SPEAKER", origin: "courtesy" }
    ),
    (error) => error.code === "GRANT_CANNOT_DOWNGRADE" && error.statusCode === 409
  );
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

test("a failed webhook can be claimed again without replaying a processed event", async () => {
  const event = { id: "evt_retry", type: "invoice.paid", created: 1786795200, data: { object: { subscription: "sub_1" } } };
  const { service, calls } = setup({ event, claims: [true, true, false] });
  await service.receiveWebhook(Buffer.from("{}"), "sig");
  await service.receiveWebhook(Buffer.from("{}"), "sig");
  assert.deepEqual(await service.receiveWebhook(Buffer.from("{}"), "sig"), { duplicate: true });
  assert.equal(calls.filter(([name]) => name === "subscription").length, 2);
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


test("invoice request deadline gives purchases through month end until day three", () => {
  assert.equal(
    invoiceRequestDeadline("2026-10-31T23:59:00-06:00").toISOString(),
    "2026-11-04T05:59:59.000Z"
  );
  assert.equal(
    invoiceRequestDeadline("2026-12-31T12:00:00-06:00").toISOString(),
    "2027-01-04T05:59:59.000Z"
  );
});

test("fiscal request accepts only the five required SAT fields", () => {
  assert.deepEqual(fiscalData({
    rfc: "  ABC010203AB1 ",
    legalName: "Empresa Demo SA de CV",
    fiscalPostalCode: "01000",
    fiscalRegime: "601",
    cfdiUse: "g03",
    constancia: "ignored"
  }), {
    rfc: "ABC010203AB1",
    legalName: "Empresa Demo SA de CV",
    fiscalPostalCode: "01000",
    fiscalRegime: "601",
    cfdiUse: "G03"
  });
  assert.throws(() => fiscalData({}), (error) => error.code === "INVALID_FISCAL_RFC");
});

test("invoice requests validate Stripe ownership and become extemporaneous after the deadline", async () => {
  const paidAt = Math.floor(Date.parse("2026-10-31T18:00:00-06:00") / 1000);
  const { service, calls } = setup({
    customerId: "cus_1",
    now: () => Date.parse("2026-11-04T00:00:00-06:00"),
    stripeInvoices: [{
      id: "in_1",
      customer: "cus_1",
      status: "paid",
      status_transitions: { paid_at: paidAt },
      amount_paid: 50000,
      currency: "mxn"
    }]
  });
  const result = await service.requestInvoice(
    { workspace: { id: "workspace-1" }, user: { id: "user-1" } },
    {
      invoiceId: "in_1",
      rfc: "ABC010203AB1",
      legalName: "Empresa Demo SA de CV",
      fiscalPostalCode: "01000",
      fiscalRegime: "601",
      cfdiUse: "G03"
    }
  );
  assert.equal(result.request.timing, "late");
  assert.equal(calls.find(([name]) => name === "invoiceRequest")[1].amountTotal, 50000);
});

test("invoice request cannot use a Stripe invoice from another customer", async () => {
  const { service } = setup({
    customerId: "cus_1",
    stripeInvoices: [{
      id: "in_other",
      customer: "cus_other",
      status: "paid",
      created: 1786700000,
      amount_paid: 50000,
      currency: "mxn"
    }]
  });
  await assert.rejects(
    () => service.requestInvoice(
      { workspace: { id: "workspace-1" }, user: { id: "user-1" } },
      { invoiceId: "in_other", rfc: "ABC010203AB1", legalName: "Demo", fiscalPostalCode: "01000", fiscalRegime: "601", cfdiUse: "G03" }
    ),
    (error) => error.code === "INVOICE_NOT_ELIGIBLE" && error.statusCode === 404
  );
});


test("successful Checkout queues one transactional activation email after reconciliation", async () => {
  const event = {
    id: "evt_checkout",
    type: "checkout.session.completed",
    created: 1786795200,
    data: { object: { id: "cs_paid", customer: "cus_1", subscription: "sub_1" } }
  };
  const { service, calls } = setup({ event });
  await service.receiveWebhook(Buffer.from("{}"), "sig");
  const notification = calls.find(([name]) => name === "billingEmail")[1];
  assert.equal(notification.kind, "subscription-active");
  assert.equal(notification.objectId, "cs_paid");
  assert.equal(notification.plan, "SPEAKER");
});

test("payment failure queues a transactional email without changing Stripe truth", async () => {
  const event = {
    id: "evt_failed",
    type: "invoice.payment_failed",
    created: 1786795200,
    data: { object: { id: "in_failed", subscription: "sub_1", amount_due: 50000, currency: "mxn" } }
  };
  const { service, calls } = setup({
    event,
    stripeSubscription: {
      id: "sub_1", customer: "cus_1", status: "past_due",
      items: { data: [{ price: { id: "price_speaker_month" }, current_period_end: 1789300000 }] }
    }
  });
  await service.receiveWebhook(Buffer.from("{}"), "sig");
  const notification = calls.find(([name]) => name === "billingEmail")[1];
  assert.equal(notification.kind, "payment-failed");
  assert.equal(notification.objectId, "in_failed");
  assert.equal(notification.amountTotal, 50000);
});


test("plan change recognizes Stripe's nested subscription discount shape", async () => {
  const { service, calls } = setup({
    customerId: "cus_1",
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER",
      billing_interval: "monthly",
      status: "active"
    },
    stripeDiscounts: [{
      source: { coupon: "coupon_sm", type: "coupon" },
      promotion_code: null
    }]
  });
  const result = await service.createPlanChangePortal(
    { workspace: { id: "workspace-1" } },
    { plan: "SPEAKER_PRO", interval: "monthly", offer: "official" }
  );
  assert.equal(result.offer, "founders");
  const update = calls.find(([name]) => name === "subscriptionUpdate");
  assert.deepEqual(update[2].discounts, [{ coupon: "coupon_pm" }]);
  assert.equal(update[2].metadata.immersa_offer, "founders");
});

test("plan change uses a Stripe-hosted confirmation flow and preserves founders pricing", async () => {
  const { service, calls } = setup({
    customerId: "cus_1",
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER",
      billing_interval: "monthly",
      status: "active",
      discount_id: "coupon_sm"
    }
  });
  const result = await service.createPlanChangePortal(
    { workspace: { id: "workspace-1" } },
    { plan: "SPEAKER_PRO", interval: "annual", offer: "official" }
  );
  assert.equal(result.timing, "immediate");
  assert.equal(result.offer, "founders");
  const update = calls.find(([name]) => name === "subscriptionUpdate");
  assert.equal(update[1], "sub_1");
  assert.deepEqual(update[2].items, [{ id: "si_1", price: "price_pro_year", quantity: 1 }]);
  assert.equal(update[2].proration_behavior, "always_invoice");
  assert.equal(update[2].payment_behavior, "pending_if_incomplete");
  assert.deepEqual(update[2].discounts, [{ coupon: "coupon_py" }]);
  assert.equal(update[3].idempotencyKey, "plan-change:sub_1:price_pro_year");
  assert.equal(result.url, "https://invoice.stripe.test/1");
});

test("downgrades and annual to monthly changes keep the paid period intact before scheduling the next price", async () => {
  const { service, calls } = setup({
    customerId: "cus_1",
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER_PRO",
      billing_interval: "annual",
      status: "active",
      discount_id: "coupon_py"
    },
    stripeSubscription: {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      discounts: [{ coupon: { id: "coupon_py" } }],
      items: { data: [{ id: "si_1", price: { id: "price_pro_year" }, current_period_end: 1789300000 }] }
    },
    stripeSchedule: {
      id: "sub_sched_1",
      phases: [{
        start_date: 1757756000,
        end_date: 1789300000,
        items: [{ price: "price_pro_year", quantity: 1 }]
      }]
    }
  });
  const result = await service.createPlanChangePortal(
    { workspace: { id: "workspace-1" } },
    { plan: "SPEAKER", interval: "monthly" }
  );
  assert.equal(result.timing, "period_end");
  assert.equal(result.scheduled, true);
  assert.equal(calls.some(([name]) => name === "portal"), false);
  assert.equal(calls.some(([name]) => name === "subscriptionUpdate"), false);
  const scheduleCreate = calls.find(([name]) => name === "scheduleCreate");
  assert.equal(scheduleCreate[1].from_subscription, "sub_1");
  const scheduleUpdate = calls.find(([name]) => name === "scheduleUpdate");
  assert.equal(scheduleUpdate[2].end_behavior, "release");
  assert.equal(scheduleUpdate[2].proration_behavior, "none");
  assert.equal(scheduleUpdate[2].phases[0].items[0].price, "price_pro_year");
  assert.equal(scheduleUpdate[2].phases[0].end_date, 1789300000);
  assert.deepEqual(scheduleUpdate[2].phases[0].discounts, [{ coupon: "coupon_py" }]);
  assert.equal(scheduleUpdate[2].phases[1].items[0].price, "price_speaker_month");
  assert.equal(scheduleUpdate[2].phases[1].duration.interval, "month");
  assert.deepEqual(scheduleUpdate[2].phases[1].discounts, [{ coupon: "coupon_sm" }]);
});

test("a retired founders coupon returns a clear IMMERSA message instead of Stripe internals", async () => {
  const couponError = new Error("Phase 1 has a coupon that would be deleted, expired, or fully redeemed.");
  const { service } = setup({
    customerId: "cus_1",
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER_PRO",
      billing_interval: "annual",
      status: "active",
      discount_id: "coupon_py"
    },
    stripeSubscription: {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      discounts: [{ coupon: { id: "coupon_py" } }],
      items: { data: [{ id: "si_1", price: { id: "price_pro_year" }, current_period_end: 1789300000 }] }
    },
    stripeSchedule: {
      id: "sub_sched_1",
      phases: [{ start_date: 1757756000, end_date: 1789300000, items: [{ price: "price_pro_year", quantity: 1 }] }]
    },
    scheduleUpdateError: couponError
  });
  await assert.rejects(
    () => service.createPlanChangePortal(
      { workspace: { id: "workspace-1" } },
      { plan: "SPEAKER_PRO", interval: "monthly" }
    ),
    (error) => error.code === "FOUNDERS_COUPON_UNAVAILABLE" && /Precio Fundadores configurado/.test(error.publicMessage)
  );
});

test("past due subscriptions must recover payment before changing membership", async () => {
  const { service } = setup({
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER",
      billing_interval: "monthly",
      status: "past_due"
    }
  });
  await assert.rejects(
    () => service.createPlanChangePortal(
      { workspace: { id: "workspace-1" } },
      { plan: "SPEAKER_PRO", interval: "monthly" }
    ),
    (error) => error.code === "ACTIVE_SUBSCRIPTION_REQUIRED" && error.statusCode === 409
  );
});

test("an existing Stripe schedule opens general management instead of stacking changes", async () => {
  const { service, calls } = setup({
    customerId: "cus_1",
    subscription: {
      provider_subscription_id: "sub_1",
      plan: "SPEAKER_PRO",
      billing_interval: "annual",
      status: "active"
    },
    stripeSubscription: {
      id: "sub_1",
      customer: "cus_1",
      schedule: "sub_sched_1",
      items: { data: [{ id: "si_1", price: { id: "price_pro_year" } }] }
    }
  });
  const result = await service.createPlanChangePortal(
    { workspace: { id: "workspace-1" } },
    { plan: "SPEAKER", interval: "monthly" }
  );
  assert.equal(result.timing, "scheduled_exists");
  assert.equal("flow_data" in calls.find(([name]) => name === "portal")[1], false);
});
