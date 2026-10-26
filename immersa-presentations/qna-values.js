const QNA_SUBMISSION_COOLDOWN_MS = 10_000;

class QnaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QnaError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new QnaError("QNA_INVALID_INPUT", `${field} is required`);
  if (normalized.length > maxLength) throw new QnaError("QNA_INVALID_INPUT", `${field} is too long`);
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new QnaError("QNA_INVALID_INPUT", "name is too long");
  return normalized;
}

module.exports = { QNA_SUBMISSION_COOLDOWN_MS, QnaError, requiredText, optionalText };
