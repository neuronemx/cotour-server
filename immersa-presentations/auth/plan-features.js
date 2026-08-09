const PAID_FEATURES = Object.freeze(["interactions", "metrics"]);

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

module.exports = {
  PAID_FEATURES,
  normalizePlan,
  featureAccessForPlan,
  canUseFeature,
  isPaidControllerEvent
};
