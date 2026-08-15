const { PLAN_RANK } = require("./config");
const { normalizePlan } = require("../auth/plan-features");

const PAID_ACCESS_STATUSES = new Set(["active"]);
const GRANT_ORIGINS = Object.freeze(["pilot", "courtesy", "manual", "support"]);

function dateValue(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function subscriptionEntitlement(subscription, now = Date.now()) {
  if (!subscription) return null;
  const plan = normalizePlan(subscription.plan);
  if (!PLAN_RANK[plan]) return null;
  const status = String(subscription.status || "").trim().toLowerCase();
  if (PAID_ACCESS_STATUSES.has(status)) {
    return { plan, source: "subscription", sourceId: String(subscription.providerSubscriptionId || subscription.provider_subscription_id || "") || null };
  }
  if (status === "past_due") {
    const accessUntil = dateValue(subscription.accessUntil || subscription.access_until);
    if (accessUntil && Number(now) < accessUntil) {
      return { plan, source: "subscription", sourceId: String(subscription.providerSubscriptionId || subscription.provider_subscription_id || "") || null };
    }
  }
  return null;
}

function grantEntitlement(grant, now = Date.now()) {
  if (!grant || grant.revokedAt || grant.revoked_at) return null;
  const plan = normalizePlan(grant.plan);
  const origin = String(grant.origin || "").trim().toLowerCase();
  if (!PLAN_RANK[plan] || !GRANT_ORIGINS.includes(origin)) return null;
  const startsAt = dateValue(grant.startsAt || grant.starts_at);
  const endsAt = dateValue(grant.endsAt || grant.ends_at);
  if (startsAt && Number(now) < startsAt) return null;
  if (endsAt && Number(now) >= endsAt) return null;
  return { plan, source: origin, sourceId: String(grant.id || "") || null, endsAt: endsAt ? new Date(endsAt) : null };
}

function selectEffectiveEntitlement({ subscription = null, grants = [], now = Date.now() } = {}) {
  const candidates = [
    { plan: "FREE", source: "free", sourceId: null },
    subscriptionEntitlement(subscription, now),
    ...(Array.isArray(grants) ? grants.map((grant) => grantEntitlement(grant, now)) : [])
  ].filter(Boolean);
  return candidates.reduce((selected, candidate) => {
    const selectedRank = PLAN_RANK[selected.plan] ?? 0;
    const candidateRank = PLAN_RANK[candidate.plan] ?? 0;
    if (candidateRank > selectedRank) return candidate;
    if (candidateRank < selectedRank) return selected;
    if (selected.source === "subscription") return selected;
    if (candidate.source === "subscription") return candidate;
    return selected;
  });
}

module.exports = {
  PAID_ACCESS_STATUSES,
  GRANT_ORIGINS,
  subscriptionEntitlement,
  grantEntitlement,
  selectEffectiveEntitlement
};
