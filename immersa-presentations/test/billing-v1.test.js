const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PUBLIC_PRICES_MXN,
  foundersOfferAvailable,
  resolveCatalogEntry,
  billingFlags,
  publicCatalog
} = require("../billing/config");
const {
  subscriptionEntitlement,
  grantEntitlement,
  selectEffectiveEntitlement
} = require("../billing/entitlements");
const { PLAN_LIMITS } = require("../auth/plan-limits");

const env = {
  IMMERSA_FOUNDERS_OFFER_END_AT: "2026-09-30T23:59:59-06:00",
  STRIPE_SPEAKER_MONTHLY_PRICE_ID: "price_speaker_month",
  STRIPE_SPEAKER_ANNUAL_PRICE_ID: "price_speaker_year",
  STRIPE_SPEAKER_PRO_MONTHLY_PRICE_ID: "price_pro_month",
  STRIPE_SPEAKER_PRO_ANNUAL_PRICE_ID: "price_pro_year",
  STRIPE_FOUNDERS_SPEAKER_ANNUAL_COUPON_ID: "coupon_speaker_year",
  STRIPE_FOUNDERS_SPEAKER_PRO_ANNUAL_COUPON_ID: "coupon_pro_year"
};

test("billing catalog freezes approved MXN tax-inclusive prices", () => {
  assert.deepEqual(PUBLIC_PRICES_MXN.SPEAKER.monthly, { official: 99900 });
  assert.deepEqual(PUBLIC_PRICES_MXN.SPEAKER.annual, { official: 999000, founders: 799000 });
  assert.deepEqual(PUBLIC_PRICES_MXN.SPEAKER_PRO.monthly, { official: 249900 });
  assert.deepEqual(PUBLIC_PRICES_MXN.SPEAKER_PRO.annual, { official: 2499000, founders: 1999000 });
  assert.equal(PLAN_LIMITS.SPEAKER_PRO.audience, 300);
  assert.equal(publicCatalog(env, Date.parse("2026-09-01T12:00:00Z")).taxIncluded, true);
});

test("founders offer has an explicit deadline and exact coupon per plan and interval", () => {
  const before = Date.parse("2026-09-01T12:00:00Z");
  const after = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(foundersOfferAvailable(env, before), true);
  assert.equal(foundersOfferAvailable(env, after), false);
  assert.deepEqual(resolveCatalogEntry({ plan: "speaker-pro", interval: "annual", offer: "founders", env, now: before }), {
    plan: "SPEAKER_PRO",
    interval: "annual",
    offer: "founders",
    currency: "mxn",
    unitAmount: 1999000,
    priceId: "price_pro_year",
    couponId: "coupon_pro_year"
  });
  assert.throws(
    () => resolveCatalogEntry({ plan: "SPEAKER", interval: "monthly", offer: "founders", env, now: before }),
    (error) => error.code === "BILLING_FOUNDERS_ANNUAL_ONLY" && error.statusCode === 409
  );
  assert.throws(
    () => resolveCatalogEntry({ plan: "SPEAKER", interval: "annual", offer: "founders", env, now: after }),
    (error) => error.code === "BILLING_OFFER_UNAVAILABLE" && error.statusCode === 409
  );
});

test("billing and checkout stay separately disabled by default", () => {
  assert.deepEqual(billingFlags({}), { enabled: false, checkoutEnabled: false });
  assert.deepEqual(billingFlags({ IMMERSA_BILLING_ENABLED: "true", IMMERSA_BILLING_CHECKOUT_ENABLED: "false" }), {
    enabled: true,
    checkoutEnabled: false
  });
});

test("paid access accepts active and past_due only during its explicit recovery window", () => {
  assert.equal(subscriptionEntitlement({ plan: "SPEAKER", status: "active", providerSubscriptionId: "sub_1" }).plan, "SPEAKER");
  assert.equal(subscriptionEntitlement({ plan: "SPEAKER", status: "past_due", accessUntil: "2026-08-20T00:00:00Z" }, Date.parse("2026-08-19T00:00:00Z")).plan, "SPEAKER");
  assert.equal(subscriptionEntitlement({ plan: "SPEAKER", status: "past_due", accessUntil: "2026-08-20T00:00:00Z" }, Date.parse("2026-08-21T00:00:00Z")), null);
  assert.equal(subscriptionEntitlement({ plan: "SPEAKER_PRO", status: "canceled" }), null);
});

test("grants expire, can be revoked, and never lower a paid subscription", () => {
  const now = Date.parse("2026-08-15T12:00:00Z");
  assert.equal(grantEntitlement({ id: "g1", plan: "SPEAKER_PRO", origin: "pilot", startsAt: "2026-08-01", endsAt: "2026-09-01" }, now).plan, "SPEAKER_PRO");
  assert.equal(grantEntitlement({ id: "g1", plan: "SPEAKER_PRO", origin: "pilot", endsAt: "2026-08-01" }, now), null);
  assert.equal(grantEntitlement({ id: "g1", plan: "SPEAKER_PRO", origin: "courtesy", revokedAt: "2026-08-10" }, now), null);
  assert.deepEqual(selectEffectiveEntitlement({
    subscription: { plan: "SPEAKER_PRO", status: "active", providerSubscriptionId: "sub_pro" },
    grants: [{ id: "g2", plan: "SPEAKER", origin: "manual" }],
    now
  }), { plan: "SPEAKER_PRO", source: "subscription", sourceId: "sub_pro" });
  assert.equal(selectEffectiveEntitlement({
    subscription: { plan: "SPEAKER", status: "active" },
    grants: [{ id: "g3", plan: "SPEAKER_PRO", origin: "courtesy" }],
    now
  }).plan, "SPEAKER_PRO");
});
