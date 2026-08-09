const { isDeepStrictEqual } = require("node:util");

const PAID_FEATURES = Object.freeze(["interactions", "metrics"]);
const PAID_DECK_CONTENT_FIELDS = Object.freeze(["interactions", "contests", "assessments"]);

function normalizePlan(plan) {
  return String(plan || "").trim().toUpperCase();
}

function featureAccessForPlan(plan, options = {}) {
  const normalizedPlan = normalizePlan(plan);
  const enabled = normalizedPlan ? normalizedPlan !== "FREE" : Boolean(options.allowWhenUnknown);
  return {
    plan: normalizedPlan || (enabled ? "DEMO" : "FREE"),
    features: {
      interactions: enabled,
      metrics: enabled
    }
  };
}

function canUseFeature(access, feature) {
  if (!PAID_FEATURES.includes(feature)) return true;
  return access?.features?.[feature] !== false;
}

function isPaidControllerEvent(eventName) {
  const event = String(eventName || "");
  return event.startsWith("interaction:")
    || event.startsWith("raffle:")
    || event.startsWith("qna:")
    || event.startsWith("games:queue:")
    || event.startsWith("pong:")
    || event.startsWith("breakout:")
    || event === "time:command";
}

function changesPaidDeckContent(body = {}, current = {}) {
  return PAID_DECK_CONTENT_FIELDS.some((field) =>
    body[field] !== undefined
      && !isDeepStrictEqual(body[field], Array.isArray(current[field]) ? current[field] : [])
  );
}

module.exports = {
  PAID_FEATURES,
  PAID_DECK_CONTENT_FIELDS,
  normalizePlan,
  featureAccessForPlan,
  canUseFeature,
  isPaidControllerEvent,
  changesPaidDeckContent
};
