const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createBetterAuthCompatibilityBridge } = require("../auth/better-auth-bridge");
const { createResendEmailSender, downgradeEmailCopy, RESEND_EMAILS_URL } = require("../auth/resend-email");
const { AccountActivationNotifier, adminNotificationEmails } = require("../auth/account-activation-notifier");
const { WorkspaceRepository, UNVERIFIED_RETENTION_MS } = require("../auth/workspace-repository");

const appDir = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
const authHtml = fs.readFileSync(path.join(appDir, "public", "auth", "index.html"), "utf8");
const authJs = fs.readFileSync(path.join(appDir, "public", "auth", "auth.js"), "utf8");
const authMigration = fs.readFileSync(path.join(appDir, "db", "migrations", "006_auth_workspaces.sql"), "utf8");
const emailLogoPath = path.join(appDir, "public", "home", "Logo-Immersa-gris.png");

async function withServer(app, operation) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Auth v1 config requires verified email, persists sessions, wires Google, and creates a personal workspace", async () => {
  const { createBetterAuthOptions } = await import("../auth/better-auth-runtime.mjs");
  const created = [];
  const notifications = [];
  const workspaces = { async ensurePersonalWorkspace(user) { created.push(user.id); } };
  const options = createBetterAuthOptions({
    database: {},
    workspaces,
    accountNotifier: { async notify(session) { notifications.push(session.userId); } },
    emailSender: async () => {},
    env: {
      BETTER_AUTH_URL: "https://app.immersalive.com",
      BETTER_AUTH_SECRET: "auth-v1-secret-that-is-at-least-32-characters",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret"
    }
  });

  assert.equal(options.emailAndPassword.enabled, true);
  assert.equal(options.emailAndPassword.requireEmailVerification, true);
  assert.equal(typeof options.emailAndPassword.sendResetPassword, "function");
  assert.equal(options.emailVerification.sendOnSignUp, true);
  assert.equal(options.emailVerification.autoSignInAfterVerification, true);
  assert.equal(options.socialProviders.google.clientId, "google-client-id");
  await options.databaseHooks.user.create.after({ id: "user-new" });
  options.databaseHooks.session.create.after({ userId: "user-new" });
  assert.deepEqual(created, ["user-new"]);
  assert.deepEqual(notifications, ["user-new"]);
});

test("Auth v1 schema starts personal workspaces on FREE and associates every user deck to a workspace", () => {
  assert.match(authMigration, /personal_owner_user_id[^\n]+NOT NULL/);
  assert.match(authMigration, /plan[^\n]+NOT NULL DEFAULT 'FREE'/);
  assert.match(authMigration, /UNIQUE KEY uq_workspaces_personal_owner/);
  assert.match(authMigration, /CREATE TABLE IF NOT EXISTS decks/);
  assert.match(authMigration, /workspace_id CHAR\(36\)/);
  assert.match(authMigration, /FOREIGN KEY \(workspace_id\) REFERENCES workspaces \(id\)/);
});

test("Resend transport keeps credentials server-side and sends the two Auth action URLs", async () => {
  const calls = [];
  const sender = createResendEmailSender({
    env: { RESEND_API_KEY: "re_test_secret", IMMERSA_EMAIL_FROM: "IMMERSA <access@auth.immersalive.com>" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { id: "email-1" }; } };
    }
  });
  await sender({ kind: "email-verification", to: "a@example.com", name: "A", url: "https://app.immersalive.com/api/auth/verify-email?token=secret" });
  await sender({ kind: "password-reset", to: "a@example.com", name: "A", url: "https://app.immersalive.com/api/auth/reset-password/token" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, RESEND_EMAILS_URL);
  assert.equal(calls[0].options.headers.Authorization, "Bearer re_test_secret");
  const verificationEmail = JSON.parse(calls[0].options.body);
  assert.match(verificationEmail.subject, /Confirma tu correo/);
  assert.match(verificationEmail.html, /<td bgcolor="#7057ff"/);
  assert.match(verificationEmail.html, /background-color:#7057ff/);
  assert.match(verificationEmail.html, /Logo-Immersa-gris\.png\?v=1/);
  assert.match(verificationEmail.html, /<td bgcolor="#ffffff"[^>]*><img[^>]+Logo-Immersa-gris/);
  assert.equal(fs.existsSync(emailLogoPath), true);
  assert.match(verificationEmail.html, />Hola A,<\/p>/);
  assert.match(JSON.parse(calls[1].options.body).subject, /Restablece tu contraseña/);
  assert.doesNotMatch(authHtml + authJs, /re_test_secret|RESEND_API_KEY/);
});

test("Resend sends the active-account alert to every Immersa administrator", async () => {
  const calls = [];
  const sender = createResendEmailSender({
    env: { RESEND_API_KEY: "re_test_secret", IMMERSA_EMAIL_FROM: "IMMERSA <access@auth.immersalive.com>" },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, async json() { return { id: "email-admin" }; } };
    }
  });
  await sender({
    kind: "account-activation",
    to: ["rocha.arturo@gmail.com", "ops@immersalive.com"],
    user: { name: "Ana Pérez", email: "ana@example.com", plan: "FREE" },
    activatedAt: new Date("2026-08-11T20:00:00.000Z")
  });
  assert.deepEqual(calls[0].to, ["rocha.arturo@gmail.com", "ops@immersalive.com"]);
  assert.match(calls[0].subject, /Nueva cuenta activa/);
  assert.match(calls[0].html, /Ana Pérez/);
  assert.match(calls[0].html, /ana@example\.com/);
  assert.match(calls[0].html, /FREE/);
});

test("downgrade emails explain the deadline, consequences, and completion without threatening deletion", () => {
  const downgrade = {
    targetPlan: "FREE",
    deadlineAt: "2026-08-20T18:00:00.000Z",
    limits: { decks: 2, storageBytes: 50 * 1024 * 1024 },
    excess: { decks: 3, storageBytes: 20 * 1024 * 1024 }
  };
  const requested = downgradeEmailCopy("downgrade-requested", "Ana", "https://app.immersalive.com/home", downgrade);
  const reminder = downgradeEmailCopy("downgrade-reminder", "Ana", "https://app.immersalive.com/home", downgrade);
  const expired = downgradeEmailCopy("downgrade-expired", "Ana", "https://app.immersalive.com/home", downgrade);
  const completed = downgradeEmailCopy("downgrade-completed", "Ana", "https://app.immersalive.com/home", downgrade);
  assert.match(requested.subject, /cambio a FREE está pendiente/);
  assert.match(requested.html, /eliminar 3 Decks/);
  assert.match(reminder.subject, /2 días/);
  assert.match(expired.html, /No podrás iniciar ni modificar presentaciones/);
  assert.match(completed.subject, /ya está en el plan FREE/);
  for (const email of [requested, reminder, expired, completed]) assert.match(email.html, /nunca eliminará tus Decks automáticamente/);
});

test("active-account notification is verified, recent, deduplicated, and non-blocking", async () => {
  const sent = [];
  const calls = [];
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT u\.id/.test(sql)) return [[{
        id: "user-new",
        name: "Ana Pérez",
        email: "ana@example.com",
        emailVerified: 1,
        createdAt,
        plan: "FREE"
      }]];
      if (/INSERT IGNORE/.test(sql)) return [{ affectedRows: sent.length ? 0 : 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  assert.deepEqual(adminNotificationEmails({ IMMERSA_ADMIN_EMAILS: "ROCHA.ARTURO@gmail.com, ops@immersalive.com" }), [
    "rocha.arturo@gmail.com",
    "ops@immersalive.com"
  ]);
  const notifier = new AccountActivationNotifier(pool, {
    recipients: ["rocha.arturo@gmail.com"],
    emailSender: async (message) => sent.push(message)
  });
  const session = { userId: "user-new", createdAt: new Date("2026-08-11T18:05:00.000Z") };
  assert.equal(await notifier.notify(session), true);
  assert.equal(await notifier.notify(session), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "account-activation");
  assert.deepEqual(sent[0].to, ["rocha.arturo@gmail.com"]);
  assert.equal(calls.some((call) => /notified_at = CURRENT_TIMESTAMP/.test(call.sql)), true);

  const unverified = new AccountActivationNotifier({
    async execute() {
      return [[{ id: "user-pending", email: "pending@example.com", emailVerified: 0, createdAt }]];
    }
  }, {
    recipients: ["rocha.arturo@gmail.com"],
    emailSender: async () => { throw new Error("must not send"); }
  });
  assert.equal(await unverified.notify({ userId: "user-pending", createdAt }), false);
});

test("account notification failures are released for retry without rejecting sign-in", async () => {
  const calls = [];
  const errors = [];
  const pool = {
    async execute(sql) {
      calls.push(sql);
      if (/SELECT u\.id/.test(sql)) return [[{
        id: "user-new",
        name: "Ana",
        email: "ana@example.com",
        emailVerified: 1,
        createdAt: new Date("2026-08-11T18:00:00.000Z"),
        plan: "FREE"
      }]];
      return [{ affectedRows: 1 }];
    }
  };
  const notifier = new AccountActivationNotifier(pool, {
    recipients: ["rocha.arturo@gmail.com"],
    emailSender: async () => { throw new Error("Resend unavailable"); },
    logger: { error: (...args) => errors.push(args) }
  });
  assert.equal(await notifier.notify({ userId: "user-new", createdAt: new Date("2026-08-11T18:05:00.000Z") }), false);
  assert.equal(calls.some((sql) => /DELETE FROM account_activation_notifications/.test(sql)), true);
  assert.equal(errors.length, 1);
});

test("account and ownership guards reject anonymous users and another user's deck", async () => {
  const runtime = {
    async getAccountContext(headers) {
      if (!headers.cookie) return null;
      const id = headers.cookie.includes("user-b") ? "user-b" : "user-a";
      return { user: { id }, workspace: { id: `workspace-${id}` }, session: {} };
    },
    workspaces: {
      async ownsDeck(userId, deckId) { return userId === "user-a" && deckId === "deck-a"; }
    }
  };
  const bridge = createBetterAuthCompatibilityBridge({
    enabled: true,
    databaseFactory: () => ({ end: async () => {} }),
    emailSenderFactory: () => null,
    loadRuntime: async () => ({ createBetterAuthRuntime: () => runtime })
  });
  const app = express();
  app.get("/api/decks/:deckId", bridge.requireApiAuth(), bridge.requireDeckOwnership(), (req, res) => res.json({ deckId: req.params.deckId }));

  await withServer(app, async (origin) => {
    assert.equal((await fetch(origin + "/api/decks/deck-a")).status, 401);
    assert.equal((await fetch(origin + "/api/decks/deck-b", { headers: { cookie: "user-a" } })).status, 404);
    assert.equal((await fetch(origin + "/api/decks/deck-a", { headers: { cookie: "user-b" } })).status, 404);
    const owned = await fetch(origin + "/api/decks/deck-a", { headers: { cookie: "user-a" } });
    assert.equal(owned.status, 200);
    assert.deepEqual(await owned.json(), { deckId: "deck-a" });
  });
  await bridge.close();
});

test("a pending downgrade confirms its immediate email before the admin response", async () => {
  const calls = [];
  const runtime = {
    workspaces: {
      async changePlan(payload) {
        calls.push({ type: "plan", payload });
        return {
          plan: "SPEAKER",
          usage: { decks: 5, storageBytes: 0 },
          limits: { decks: 5, storageBytes: 200 * 1024 * 1024 },
          pendingDowngrade: { targetPlan: "FREE" }
        };
      }
    },
    downgradeNotifier: {
      async runDueForWorkspace(workspaceId, kind) {
        calls.push({ type: "email", workspaceId, kind });
        return 1;
      }
    }
  };
  const bridge = createBetterAuthCompatibilityBridge({
    enabled: true,
    databaseFactory: () => ({ end: async () => {} }),
    emailSenderFactory: () => null,
    loadRuntime: async () => ({ createBetterAuthRuntime: () => runtime })
  });
  const result = await bridge.changeWorkspacePlan({ accountContext: { user: { id: "admin-1" } } }, {
    workspaceId: "workspace-1",
    plan: "FREE",
    note: "Piloto"
  });
  assert.deepEqual(result.emailNotification, { status: "sent" });
  assert.deepEqual(calls.map((call) => call.type), ["plan", "email"]);
  assert.deepEqual(calls[1], { type: "email", workspaceId: "workspace-1", kind: "requested" });
  await bridge.close();
});

test("server protects Home and deck administration while Público and Screen stay account-public", () => {
  assert.match(serverSource, /app\.get\("\/home", betterAuthCompatibilityBridge\.requirePageAuth\(\)/);
  assert.match(serverSource, /app\.get\("\/api\/decks\/:deckId\/interactions", deckInteractionHandlers\.getInteractions\)/);
  assert.match(serverSource, /app\.put\("\/api\/decks\/:deckId\/interactions", requireAccountOrControllerDeck/);
  assert.match(serverSource, /app\.get\("\/api\/decks\/:deckId\/brand-mentions", \.\.\.requireDeckAccount/);
  assert.match(serverSource, /app\.post\("\/api\/upload-pptx", requireAccount/);
  assert.match(serverSource, /app\.post\("\/api\/access-links", requireAccount, requireAccountAdjustmentCleared, requireOwnedOrPublishedSession/);
  assert.match(serverSource, /app\.get\("\/audience\/:access_token", accessLinkHandlers\.openRole/);
  assert.match(serverSource, /app\.get\("\/screen\/:access_token", accessLinkHandlers\.openRole/);
  assert.match(serverSource, /app\.get\("\/:public_id", accessLinkHandlers\.openPublicAudience\)/);
});

test("Auth UI keeps onboarding plan-free and exposes Google, email verification, reset, and logout", () => {
  const homeHtml = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const homeAccount = fs.readFileSync(path.join(appDir, "public", "home", "home-account.js"), "utf8");
  assert.match(authHtml, /Continuar con Google/);
  assert.match(authHtml, /Crear cuenta/);
  assert.match(authHtml, /Presenta e interactúa/);
  assert.match(authHtml, /Conecta con tu audiencia <span>en vivo\.<\/span>/);
  assert.match(authHtml, /Pregunta, premia, mide y evalúa mientras hablas\./);
  assert.match(authHtml, /Logo-Immersa\.png\?v=2/);
  assert.match(authHtml, /id="name"[^>]+autocomplete="name"/);
  assert.match(authJs, /name: nameInput\.value\.trim\(\)/);
  assert.match(authHtml, /Olvidé mi contraseña/);
  assert.match(authJs, /sign-up\/email/);
  assert.match(authHtml, /Corregir correo/);
  assert.match(authJs, /send-verification-email/);
  assert.match(authJs, /Reenviar correo/);
  assert.match(authJs, /request-password-reset/);
  assert.match(authJs, /reset-password/);
  assert.doesNotMatch(authHtml + authJs, /elegir plan|selecciona.*plan|workspace/i);
  assert.match(homeHtml, /id="logoutButton"/);
  assert.match(homeAccount, /api\/auth\/sign-out/);
});

test("Auth and Home expose the official square IMMERSA M for favicons and link previews", () => {
  const homeHtml = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const previewIconPath = path.join(appDir, "public", "icon-512.png");
  for (const html of [authHtml, homeHtml]) {
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/app\.immersalive\.com\/icon-512\.png">/);
    assert.match(html, /<meta property="og:image:width" content="512">/);
    assert.match(html, /<meta property="og:image:height" content="512">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
  }
  assert.equal(fs.existsSync(previewIconPath), true);
});

test("stale unverified credential accounts are eligible for 48-hour cleanup only without sessions or Decks", async () => {
  const calls = [];
  const candidateId = "user-stale";
  const connection = {
    async beginTransaction() { calls.push({ sql: "BEGIN" }); },
    async rollback() { calls.push({ sql: "ROLLBACK" }); },
    async commit() { calls.push({ sql: "COMMIT" }); },
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id FROM `user`/.test(sql)) return [[{ id: candidateId }]];
      if (/AS credential_account/.test(sql)) return [[{ credential_account: 1, has_session: 0, has_decks: 0 }]];
      if (/DELETE FROM `user`/.test(sql)) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ id: candidateId }]];
    },
    async getConnection() { return connection; }
  };
  const repository = new WorkspaceRepository(pool);
  const now = Date.UTC(2026, 7, 6, 12, 0, 0);
  assert.equal(UNVERIFIED_RETENTION_MS, 48 * 60 * 60 * 1000);
  assert.equal(await repository.cleanupStaleUnverifiedAccounts({ now }), 1);
  assert.match(calls[0].sql, /emailVerified = 0/);
  assert.match(calls[0].sql, /providerId = 'credential'/);
  assert.match(calls[0].sql, /NOT EXISTS \(SELECT 1 FROM session/);
  assert.match(calls[0].sql, /INNER JOIN decks/);
  assert.equal(calls.some((call) => /DELETE FROM workspaces/.test(call.sql)), true);
  assert.equal(calls.some((call) => /DELETE FROM `user`/.test(call.sql)), true);
});

test("unverified cleanup rechecks account activity before deleting anything", async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {},
    async rollback() { calls.push("ROLLBACK"); },
    async commit() { calls.push("COMMIT"); },
    release() {},
    async execute(sql) {
      calls.push(sql);
      if (/SELECT id FROM `user`/.test(sql)) return [[{ id: "user-now-active" }]];
      if (/AS credential_account/.test(sql)) return [[{ credential_account: 1, has_session: 1, has_decks: 0 }]];
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new WorkspaceRepository({
    async execute() { return [[{ id: "user-now-active" }]]; },
    async getConnection() { return connection; }
  });

  assert.equal(await repository.cleanupStaleUnverifiedAccounts({ now: Date.UTC(2026, 7, 6, 12, 0, 0) }), 0);
  assert.equal(calls.includes("ROLLBACK"), true);
  assert.equal(calls.some((sql) => typeof sql === "string" && /^DELETE FROM/.test(sql)), false);
});
