const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createBetterAuthCompatibilityBridge } = require("../auth/better-auth-bridge");
const { createResendEmailSender, RESEND_EMAILS_URL } = require("../auth/resend-email");

const appDir = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
const authHtml = fs.readFileSync(path.join(appDir, "public", "auth", "index.html"), "utf8");
const authJs = fs.readFileSync(path.join(appDir, "public", "auth", "auth.js"), "utf8");
const authMigration = fs.readFileSync(path.join(appDir, "db", "migrations", "006_auth_workspaces.sql"), "utf8");

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
  const workspaces = { async ensurePersonalWorkspace(user) { created.push(user.id); } };
  const options = createBetterAuthOptions({
    database: {},
    workspaces,
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
  assert.deepEqual(created, ["user-new"]);
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
    env: { RESEND_API_KEY: "re_test_secret", IMMERSA_EMAIL_FROM: "IMMERSA <acceso@auth.immersalive.com>" },
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
  assert.match(JSON.parse(calls[0].options.body).subject, /Confirma tu correo/);
  assert.match(JSON.parse(calls[1].options.body).subject, /Restablece tu contraseña/);
  assert.doesNotMatch(authHtml + authJs, /re_test_secret|RESEND_API_KEY/);
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

test("server protects Home and deck administration while Público and Screen stay account-public", () => {
  assert.match(serverSource, /app\.get\("\/home", betterAuthCompatibilityBridge\.requirePageAuth\(\)/);
  assert.match(serverSource, /app\.get\("\/api\/decks\/:deckId\/interactions", deckInteractionHandlers\.getInteractions\)/);
  assert.match(serverSource, /app\.put\("\/api\/decks\/:deckId\/interactions", requireAccountOrControllerDeck/);
  assert.match(serverSource, /app\.get\("\/api\/decks\/:deckId\/brand-mentions", \.\.\.requireDeckAccount/);
  assert.match(serverSource, /app\.post\("\/api\/upload-pptx", requireAccount/);
  assert.match(serverSource, /app\.post\("\/api\/access-links", requireAccount, betterAuthCompatibilityBridge\.requireOwnedSession/);
  assert.match(serverSource, /app\.get\("\/audience\/:access_token", accessLinkHandlers\.openRole/);
  assert.match(serverSource, /app\.get\("\/screen\/:access_token", accessLinkHandlers\.openRole/);
  assert.match(serverSource, /app\.get\("\/:public_id", accessLinkHandlers\.openPublicAudience\)/);
});

test("Auth UI keeps onboarding plan-free and exposes Google, email verification, reset, and logout", () => {
  const homeHtml = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const homeAccount = fs.readFileSync(path.join(appDir, "public", "home", "home-account.js"), "utf8");
  assert.match(authHtml, /Continuar con Google/);
  assert.match(authHtml, /Crear cuenta/);
  assert.match(authHtml, /Olvidé mi contraseña/);
  assert.match(authJs, /sign-up\/email/);
  assert.match(authJs, /request-password-reset/);
  assert.match(authJs, /reset-password/);
  assert.doesNotMatch(authHtml + authJs, /elegir plan|selecciona.*plan|workspace/i);
  assert.match(homeHtml, /id="logoutButton"/);
  assert.match(homeAccount, /api\/auth\/sign-out/);
});
