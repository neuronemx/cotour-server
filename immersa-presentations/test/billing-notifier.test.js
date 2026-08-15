const assert = require("node:assert/strict");
const test = require("node:test");
const { BillingNotifier } = require("../billing/notifier");
const { billingEmailCopy } = require("../auth/resend-email");

test("billing email copy remains transactional and explains required actions", () => {
  const failed = billingEmailCopy("billing-payment-failed", "Arturo", "https://app.immersalive.com/home", {
    plan: "SPEAKER", periodEnd: "2026-09-15T12:00:00Z"
  });
  assert.match(failed.subject, /pago/i);
  assert.match(failed.html, /forma de pago/i);
  assert.match(failed.html, /Correo transaccional/);
  assert.doesNotMatch(failed.html, /promoción|campaña|cupón/i);
});

test("billing notifier releases a failed claim for a later retry", async () => {
  const calls = [];
  const pool = {
    async execute(sql, values) {
      calls.push([String(sql), values]);
      if (/SET claimed_at = CURRENT_TIMESTAMP/.test(sql)) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const notifier = new BillingNotifier(pool, {
    emailSender: async () => { throw new Error("temporary resend outage"); },
    logger: { error() {}, log() {} }
  });
  const sent = await notifier.deliver({
    id: 7,
    kind: "payment-failed",
    email: "speaker@example.com",
    name: "Speaker",
    plan: "SPEAKER"
  });
  assert.equal(sent, false);
  assert.ok(calls.some(([sql]) => /available_at = DATE_ADD/.test(sql)));
  assert.ok(calls.some(([sql]) => /last_error/.test(sql)));
});
