const BYTES_PER_MEGABYTE = 1024 * 1024;

const PLAN_LIMITS = Object.freeze({
  FREE: Object.freeze({
    decks: 2,
    storageBytes: 100 * BYTES_PER_MEGABYTE
  })
});

class PlanLimitError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "PlanLimitError";
    this.code = code;
    this.statusCode = 409;
    this.publicMessage = message;
    this.details = details;
  }
}

function normalizePlan(plan) {
  return String(plan || "").trim().toUpperCase();
}

function getPlanLimits(plan) {
  const normalizedPlan = normalizePlan(plan);
  const limits = PLAN_LIMITS[normalizedPlan];
  if (!limits) throw new Error(`Unsupported Immersa plan: ${normalizedPlan || "missing"}`);
  return { plan: normalizedPlan, ...limits };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function summarizePlanUsage(plan, usage = {}) {
  const limits = getPlanLimits(plan);
  const decks = nonNegativeInteger(usage.decks);
  const storageBytes = nonNegativeInteger(usage.storageBytes);
  const remainingDecks = Math.max(0, limits.decks - decks);
  const remainingStorageBytes = Math.max(0, limits.storageBytes - storageBytes);
  return {
    plan: limits.plan,
    usage: { decks, storageBytes },
    limits: { decks: limits.decks, storageBytes: limits.storageBytes },
    remaining: { decks: remainingDecks, storageBytes: remainingStorageBytes },
    canCreateDeck: remainingDecks > 0 && remainingStorageBytes > 0
  };
}

function assertCanReserveDeck(summary, sourceSizeBytes) {
  const bytes = nonNegativeInteger(sourceSizeBytes);
  if (summary.remaining.decks < 1) {
    throw new PlanLimitError(
      "DECK_LIMIT_REACHED",
      `Tu plan ${summary.plan} incluye hasta ${summary.limits.decks} presentaciones. Elimina una para subir otra.`,
      summary
    );
  }
  if (bytes > summary.remaining.storageBytes) {
    throw new PlanLimitError(
      "STORAGE_LIMIT_REACHED",
      `El archivo supera el almacenamiento disponible de tu plan ${summary.plan}.`,
      summary
    );
  }
  return bytes;
}

module.exports = {
  BYTES_PER_MEGABYTE,
  PLAN_LIMITS,
  PlanLimitError,
  getPlanLimits,
  summarizePlanUsage,
  assertCanReserveDeck
};
