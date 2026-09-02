const { normalizePlan } = require("../auth/plan-features");

const BILLING_INTERVALS = Object.freeze(["monthly", "annual"]);
const BILLING_PLANS = Object.freeze(["SPEAKER", "SPEAKER_PRO"]);
const BILLING_CURRENCIES = Object.freeze(["mxn", "usd"]);
const EVENT_PASS_DAYS = 7;
const PLAN_RANK = Object.freeze({ FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 });

const PUBLIC_PRICES_MXN = Object.freeze({
  SPEAKER: Object.freeze({
    monthly: Object.freeze({ official: 99900 }),
    annual: Object.freeze({ official: 999000, founders: 799000 })
  }),
  SPEAKER_PRO: Object.freeze({
    monthly: Object.freeze({ official: 249900 }),
    annual: Object.freeze({ official: 2499000, founders: 1999000 })
  })
});

// USD is a separate commercial catalogue, not a live exchange-rate conversion.
// That keeps the amount shown in IMMERSA identical to the amount Stripe charges.
const PUBLIC_PRICES_USD = Object.freeze({
  SPEAKER: Object.freeze({
    monthly: Object.freeze({ official: 5900 }),
    annual: Object.freeze({ official: 59900, founders: 47900 })
  }),
  SPEAKER_PRO: Object.freeze({
    monthly: Object.freeze({ official: 14900 }),
    annual: Object.freeze({ official: 149900, founders: 119900 })
  })
});

const PUBLIC_PRICES = Object.freeze({ mxn: PUBLIC_PRICES_MXN, usd: PUBLIC_PRICES_USD });

const PRICE_ENV_KEYS = Object.freeze({
  mxn: Object.freeze({
    SPEAKER: Object.freeze({ monthly: "STRIPE_SPEAKER_MONTHLY_PRICE_ID", annual: "STRIPE_SPEAKER_ANNUAL_PRICE_ID" }),
    SPEAKER_PRO: Object.freeze({ monthly: "STRIPE_SPEAKER_PRO_MONTHLY_PRICE_ID", annual: "STRIPE_SPEAKER_PRO_ANNUAL_PRICE_ID" })
  }),
  usd: Object.freeze({
    SPEAKER: Object.freeze({ monthly: "STRIPE_SPEAKER_USD_MONTHLY_PRICE_ID", annual: "STRIPE_SPEAKER_USD_ANNUAL_PRICE_ID" }),
    SPEAKER_PRO: Object.freeze({ monthly: "STRIPE_SPEAKER_PRO_USD_MONTHLY_PRICE_ID", annual: "STRIPE_SPEAKER_PRO_USD_ANNUAL_PRICE_ID" })
  })
});

const FOUNDERS_COUPON_ENV_KEYS = Object.freeze({
  mxn: Object.freeze({
    SPEAKER: Object.freeze({ annual: "STRIPE_FOUNDERS_SPEAKER_ANNUAL_COUPON_ID" }),
    SPEAKER_PRO: Object.freeze({ annual: "STRIPE_FOUNDERS_SPEAKER_PRO_ANNUAL_COUPON_ID" })
  }),
  usd: Object.freeze({
    SPEAKER: Object.freeze({ annual: "STRIPE_FOUNDERS_SPEAKER_USD_ANNUAL_COUPON_ID" }),
    SPEAKER_PRO: Object.freeze({ annual: "STRIPE_FOUNDERS_SPEAKER_PRO_USD_ANNUAL_COUPON_ID" })
  })
});

const EVENT_PASS_PRICES_MXN = Object.freeze({ SPEAKER: 79900, SPEAKER_PRO: 199900 });
const EVENT_PASS_PRICES_USD = Object.freeze({ SPEAKER: 4500, SPEAKER_PRO: 11500 });
const EVENT_PASS_PRICES = Object.freeze({ mxn: EVENT_PASS_PRICES_MXN, usd: EVENT_PASS_PRICES_USD });
const EVENT_PASS_PRICE_ENV_KEYS = Object.freeze({
  mxn: Object.freeze({ SPEAKER: "STRIPE_SPEAKER_7_DAY_PASS_PRICE_ID", SPEAKER_PRO: "STRIPE_SPEAKER_PRO_7_DAY_PASS_PRICE_ID" }),
  usd: Object.freeze({ SPEAKER: "STRIPE_SPEAKER_USD_7_DAY_PASS_PRICE_ID", SPEAKER_PRO: "STRIPE_SPEAKER_PRO_USD_7_DAY_PASS_PRICE_ID" })
});

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizeBillingPlan(plan) {
  const normalized = normalizePlan(plan);
  if (!BILLING_PLANS.includes(normalized)) throw publicError("INVALID_BILLING_PLAN", "Selecciona un plan de pago válido");
  return normalized;
}

function normalizeBillingInterval(interval) {
  const normalized = String(interval || "").trim().toLowerCase();
  if (!BILLING_INTERVALS.includes(normalized)) throw publicError("INVALID_BILLING_INTERVAL", "Selecciona pago mensual o anual");
  return normalized;
}

function normalizeBillingCurrency(currency) {
  const normalized = String(currency || "mxn").trim().toLowerCase();
  if (!BILLING_CURRENCIES.includes(normalized)) throw publicError("INVALID_BILLING_CURRENCY", "Selecciona MXN o USD");
  return normalized;
}

function publicError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function foundersOfferEndsAt(env = process.env) {
  const value = String(env.IMMERSA_FOUNDERS_OFFER_END_AT || "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("IMMERSA_FOUNDERS_OFFER_END_AT must be an ISO date");
  return date;
}

function foundersOfferAvailable(env = process.env, now = Date.now()) {
  const endsAt = foundersOfferEndsAt(env);
  return Boolean(endsAt && Number(now) < endsAt.getTime());
}

function resolveCatalogEntry({ plan, interval, currency = "mxn", offer = "official", env = process.env, now = Date.now(), retainFounders = false }) {
  const normalizedPlan = normalizeBillingPlan(plan);
  const normalizedInterval = normalizeBillingInterval(interval);
  const normalizedCurrency = normalizeBillingCurrency(currency);
  const normalizedOffer = String(offer || "official").trim().toLowerCase();
  if (!["official", "founders"].includes(normalizedOffer)) throw publicError("INVALID_BILLING_OFFER", "La promoción seleccionada no es válida");
  if (normalizedOffer === "founders" && normalizedInterval !== "annual") {
    throw publicError("BILLING_FOUNDERS_ANNUAL_ONLY", "El Precio Fundadores sólo está disponible en la membresía anual", 409);
  }
  if (normalizedOffer === "founders" && !retainFounders && !foundersOfferAvailable(env, now)) {
    throw publicError("BILLING_OFFER_UNAVAILABLE", "El Precio Fundadores ya no está disponible", 409);
  }
  const priceId = String(env[PRICE_ENV_KEYS[normalizedCurrency][normalizedPlan][normalizedInterval]] || "").trim();
  if (!priceId) throw publicError("BILLING_CURRENCY_UNAVAILABLE", "Los precios en esta moneda todavía no están disponibles", 409);
  const couponId = normalizedOffer === "founders"
    ? String(env[FOUNDERS_COUPON_ENV_KEYS[normalizedCurrency][normalizedPlan][normalizedInterval]] || "").trim()
    : "";
  if (normalizedOffer === "founders" && !couponId) throw new Error(`Missing founders coupon for ${normalizedPlan} ${normalizedInterval}`);
  return {
    plan: normalizedPlan,
    interval: normalizedInterval,
    offer: normalizedOffer,
    currency: normalizedCurrency,
    unitAmount: PUBLIC_PRICES[normalizedCurrency][normalizedPlan][normalizedInterval][normalizedOffer],
    priceId,
    couponId: couponId || null
  };
}

function billingFlags(env = process.env) {
  return {
    enabled: enabled(env.IMMERSA_BILLING_ENABLED),
    checkoutEnabled: enabled(env.IMMERSA_BILLING_CHECKOUT_ENABLED)
  };
}

function publicCatalog(env = process.env, now = Date.now()) {
  const currencyAvailable = (currency) => BILLING_PLANS.every((plan) => (
    BILLING_INTERVALS.every((interval) => Boolean(String(env[PRICE_ENV_KEYS[currency][plan][interval]] || "").trim()))
    && Boolean(String(env[EVENT_PASS_PRICE_ENV_KEYS[currency][plan]] || "").trim())
  ));
  return {
    currency: "MXN",
    currencies: BILLING_CURRENCIES.map((currency) => ({ code: currency.toUpperCase(), available: currencyAvailable(currency) })),
    taxIncluded: true,
    foundersAvailable: foundersOfferAvailable(env, now),
    foundersOfferEndsAt: foundersOfferEndsAt(env)?.toISOString() || null,
    plans: PUBLIC_PRICES,
    eventPass: {
      durationDays: EVENT_PASS_DAYS,
      plans: EVENT_PASS_PRICES,
      available: currencyAvailable("mxn")
    }
  };
}

module.exports = {
  BILLING_INTERVALS,
  BILLING_PLANS,
  BILLING_CURRENCIES,
  EVENT_PASS_DAYS,
  PLAN_RANK,
  PUBLIC_PRICES_MXN,
  PUBLIC_PRICES_USD,
  PUBLIC_PRICES,
  PRICE_ENV_KEYS,
  FOUNDERS_COUPON_ENV_KEYS,
  EVENT_PASS_PRICES_MXN,
  EVENT_PASS_PRICES_USD,
  EVENT_PASS_PRICES,
  EVENT_PASS_PRICE_ENV_KEYS,
  normalizeBillingPlan,
  normalizeBillingInterval,
  normalizeBillingCurrency,
  foundersOfferEndsAt,
  foundersOfferAvailable,
  resolveCatalogEntry,
  billingFlags,
  publicCatalog,
  publicError
};
