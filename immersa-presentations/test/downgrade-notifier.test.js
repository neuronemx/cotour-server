const assert = require("node:assert/strict");
const test = require("node:test");
const { DowngradeNotifier } = require("../auth/downgrade-notifier");

test("due downgrade notifications are claimed, recalculated, delivered, and marked sent", async () => {
  const calls = [];
  const sent = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT n\.request_id/.test(sql)) return [[{
        request_id: "request-1",
        kind: "reminder",
        workspace_id: "workspace-1",
        target_plan: "FREE",
        deadline_at: "2026-08-20T18:00:00.000Z",
        pending_plan_request_id: "request-1",
        name: "Ana",
        email: "ana@example.com",
        deck_count: 5,
        storage_bytes: 70 * 1024 * 1024
      }]];
      if (/SET claimed_at = CURRENT_TIMESTAMP/.test(sql)) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  const notifier = new DowngradeNotifier(pool, {
    baseUrl: "https://app.immersalive.com",
    emailSender: async (message) => sent.push(message)
  });
  assert.equal(await notifier.runDue(), 1);
  assert.equal(sent[0].kind, "downgrade-reminder");
  assert.equal(sent[0].downgrade.excess.decks, 3);
  assert.equal(sent[0].downgrade.excess.storageBytes, 20 * 1024 * 1024);
  assert.equal(sent[0].url, "https://app.immersalive.com/home");
  assert.ok(calls.some((call) => /SET sent_at = CURRENT_TIMESTAMP/.test(call.sql)));
});

test("notifications from a cancelled downgrade are removed without sending", async () => {
  let sent = false;
  const pool = {
    async execute(sql) {
      if (/SELECT n\.request_id/.test(sql)) return [[{
        request_id: "old-request",
        kind: "expired",
        workspace_id: "workspace-1",
        target_plan: "FREE",
        deadline_at: new Date(),
        pending_plan_request_id: "new-request",
        email: "ana@example.com"
      }]];
      return [{ affectedRows: 1 }];
    }
  };
  const notifier = new DowngradeNotifier(pool, { emailSender: async () => { sent = true; } });
  assert.equal(await notifier.runDue(), 0);
  assert.equal(sent, false);
});
