const { isDeepStrictEqual } = require("node:util");

const CAPABILITIES = Object.freeze({
  ACCESS_PUBLIC: "access.public",
  ACCESS_SCREEN: "access.screen",
  ACCESS_BACKSTAGE: "access.backstage",
  POLLS_CONFIGURE: "polls.configure",
  POLLS_RUN: "polls.run",
  QNA_RUN: "qna.run",
  METRICS_BASIC: "metrics.basic",
  RAFFLES_RUN: "raffles.run",
  TRIVIA_RUN: "trivia.run",
  ASSESSMENTS_RUN: "assessments.run",
  METRICS_EXPORT: "metrics.export",
  BRANDING_CUSTOM: "branding.custom",
  GAMES_RUN: "games.run"
});

const MANAGED_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));
const PLAN_CAPABILITIES = Object.freeze({
  FREE: Object.freeze([
    CAPABILITIES.ACCESS_PUBLIC,
    CAPABILITIES.ACCESS_SCREEN
  ]),
  SPEAKER: Object.freeze([
    CAPABILITIES.ACCESS_PUBLIC,
    CAPABILITIES.ACCESS_SCREEN,
    CAPABILITIES.ACCESS_BACKSTAGE,
    CAPABILITIES.POLLS_CONFIGURE,
    CAPABILITIES.POLLS_RUN,
    CAPABILITIES.QNA_RUN,
    CAPABILITIES.METRICS_BASIC
  ]),
  SPEAKER_PRO: Object.freeze(MANAGED_CAPABILITIES.filter((capability) => capability !== CAPABILITIES.GAMES_RUN)),
  DEMO: Object.freeze(MANAGED_CAPABILITIES)
});

const PAID_FEATURES = Object.freeze(["interactions", "metrics"]);
const PAID_DECK_CONTENT_FIELDS = Object.freeze(["interactions", "contests", "assessments"]);
const DECK_FIELD_CAPABILITIES = Object.freeze({
  interactions: CAPABILITIES.POLLS_CONFIGURE,
  contests: CAPABILITIES.TRIVIA_RUN,
  assessments: CAPABILITIES.ASSESSMENTS_RUN
});

function normalizePlan(plan) {
  return String(plan || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function featureAccessForPlan(plan, options = {}) {
  const requested = normalizePlan(plan);
  const normalizedPlan = PLAN_CAPABILITIES[requested]
    ? requested
    : (options.allowWhenUnknown ? "DEMO" : "FREE");
  const enabled = new Set(PLAN_CAPABILITIES[normalizedPlan]);
  const capabilities = Object.fromEntries(MANAGED_CAPABILITIES.map((capability) => [capability, enabled.has(capability)]));
  const interactions = capabilities[CAPABILITIES.POLLS_RUN]
    || capabilities[CAPABILITIES.QNA_RUN]
    || capabilities[CAPABILITIES.RAFFLES_RUN]
    || capabilities[CAPABILITIES.TRIVIA_RUN]
    || capabilities[CAPABILITIES.ASSESSMENTS_RUN];
  return {
    plan: normalizedPlan,
    capabilities,
    features: {
      ...capabilities,
      interactions: Boolean(interactions),
      metrics: capabilities[CAPABILITIES.METRICS_BASIC]
    }
  };
}

function canUseFeature(access, feature) {
  const capability = String(feature || "");
  if (MANAGED_CAPABILITIES.includes(capability)) {
    return access?.capabilities?.[capability] === true || access?.features?.[capability] === true;
  }
  if (PAID_FEATURES.includes(capability)) return access?.features?.[capability] === true;
  return true;
}

function requiredCapabilityForControllerEvent(eventName) {
  const event = String(eventName || "");
  if (event.startsWith("qna:")) return CAPABILITIES.QNA_RUN;
  if (event.startsWith("raffle:")) return CAPABILITIES.RAFFLES_RUN;
  if (event.startsWith("interaction:execution:") || event.startsWith("interaction:participant:")) {
    return CAPABILITIES.TRIVIA_RUN;
  }
  if (event.startsWith("interaction:")) return CAPABILITIES.POLLS_RUN;
  if (event.startsWith("games:queue:") || event.startsWith("pong:") || event.startsWith("breakout:") || event === "time:command") {
    return CAPABILITIES.GAMES_RUN;
  }
  if (event === "presentation:lifecycle:start" || event === "presentation:lifecycle:finish") {
    return CAPABILITIES.METRICS_BASIC;
  }
  return "";
}

function isPaidControllerEvent(eventName) {
  const capability = requiredCapabilityForControllerEvent(eventName);
  return Boolean(capability && capability !== CAPABILITIES.METRICS_BASIC);
}

function isPaidMetricsEvent(eventName) {
  return requiredCapabilityForControllerEvent(eventName) === CAPABILITIES.METRICS_BASIC;
}

function changedDeckCapabilities(body = {}, current = {}) {
  return Object.entries(DECK_FIELD_CAPABILITIES)
    .filter(([field]) => body[field] !== undefined
      && !isDeepStrictEqual(body[field], Array.isArray(current[field]) ? current[field] : []))
    .map(([, capability]) => capability);
}

function changesPaidDeckContent(body = {}, current = {}) {
  return changedDeckCapabilities(body, current).length > 0;
}

module.exports = {
  CAPABILITIES,
  MANAGED_CAPABILITIES,
  PLAN_CAPABILITIES,
  PAID_FEATURES,
  PAID_DECK_CONTENT_FIELDS,
  DECK_FIELD_CAPABILITIES,
  normalizePlan,
  featureAccessForPlan,
  canUseFeature,
  requiredCapabilityForControllerEvent,
  isPaidControllerEvent,
  isPaidMetricsEvent,
  changedDeckCapabilities,
  changesPaidDeckContent
};

