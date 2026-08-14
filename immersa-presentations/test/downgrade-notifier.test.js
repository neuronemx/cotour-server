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

test("an immediate downgrade email can be delivered for one workspace", async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT n\.request_id/.test(sql)) return [[{
        request_id: "request-2",
        kind: "requested",
        workspace_id: "workspace-2",
        target_plan: "FREE",
        deadline_at: "2026-08-20T18:00:00.000Z",
        pending_plan_request_id: "request-2",
        name: "Arturo",
        email: "arturo@example.com",
        deck_count: 5,
        storage_bytes: 40 * 1024 * 1024
      }]];
      return [{ affectedRows: 1 }];
    }
  };
  const sent = [];
  const notifier = new DowngradeNotifier(pool, { emailSender: async (message) => sent.push(message) });
  assert.equal(await notifier.runDueForWorkspace("workspace-2"), 1);
  assert.equal(sent[0].kind, "downgrade-requested");
  assert.match(calls[0].sql, /n\.workspace_id = \?/);
  assert.match(calls[0].sql, /n\.kind = \?/);
  assert.doesNotMatch(calls[0].sql, /GROUP BY n\.request_id/);
  assert.match(calls[0].sql, /LIMIT 1/);
  assert.deepEqual(calls[0].params, ["workspace-2", "requested"]);
});

test("an administrator can reset and resend the current downgrade email", async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE plan_downgrade_notifications n/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT n\.request_id/.test(sql)) return [[{
        request_id: "request-3", kind: "requested", workspace_id: "workspace-3", target_plan: "FREE",
        deadline_at: "2026-08-20T18:00:00.000Z", pending_plan_request_id: "request-3",
        name: "Ana", email: "ana@example.com", deck_count: 4, storage_bytes: 0
      }]];
      return [{ affectedRows: 1 }];
    }
  };
  const notifier = new DowngradeNotifier(pool, { emailSender: async () => ({ id: "email-3" }) });
  assert.deepEqual(await notifier.retryRequestedForWorkspace("workspace-3"), { status: "sent" });
  assert.match(calls[0].sql, /n\.request_id = w\.pending_plan_request_id/);
  assert.deepEqual(calls[0].params, ["workspace-3"]);
});

test("manual retry does not duplicate an email already sent by the worker", async () => {
  let delivered = false;
  const pool = {
    async execute(sql) {
      if (/UPDATE plan_downgrade_notifications n/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT n\.sent_at/.test(sql)) return [[{ sent_at: new Date("2026-08-14T05:19:00.000Z") }]];
      throw new Error("unexpected query");
    }
  };
  const notifier = new DowngradeNotifier(pool, { emailSender: async () => { delivered = true; } });
  assert.deepEqual(await notifier.retryRequestedForWorkspace("workspace-3"), { status: "already_sent" });
  assert.equal(delivered, false);
});
