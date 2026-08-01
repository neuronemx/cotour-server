const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const mysql = require("mysql2/promise");
const {
  createBetterAuthCompatibilityBridge,
  isEnabled
} = require("../auth/better-auth-bridge");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const validEnv = {
  IMMERSA_AUTH_SPIKE_ENABLED: "true",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "compatibility-spike-secret-32-characters"
};

async function request(app, pathname) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await fetch(`http://127.0.0.1:${address.port}${pathname}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("compatibility spike is explicit opt-in", () => {
  assert.equal(isEnabled("true"), true);
  assert.equal(isEnabled("1"), true);
  assert.equal(isEnabled("false"), false);
  assert.equal(isEnabled(undefined), false);
});

test("disabled bridge does not claim Better Auth routes", async () => {
  const bridge = createBetterAuthCompatibilityBridge({ enabled: false });
  const app = express();
  app.all("/api/auth/*", bridge.handler);
  app.get("/api/auth/ok", (_req, res) => res.status(418).json({ fallback: true }));
  const response = await request(app, "/api/auth/ok");
  assert.equal(response.status, 418);
  assert.deepEqual(await response.json(), { fallback: true });
});

test("CommonJS bridge loads the real ESM Better Auth handler", async () => {
  const database = mysql.createPool({
    host: "127.0.0.1",
    port: 1,
    user: "compatibility_spike",
    password: "unused",
    database: "unused",
    connectTimeout: 50,
    timezone: "Z"
  });
  const bridge = createBetterAuthCompatibilityBridge({
    env: validEnv,
    enabled: true,
    databaseFactory: () => database
  });
  const app = express();
  app.all("/api/auth/*", bridge.handler);
  app.use(express.json());

  try {
    const response = await request(app, "/api/auth/ok");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await bridge.close();
  }
});

test("bridge can attach an account session to a Socket.IO handshake", async () => {
  const expectedSession = { user: { id: "user-1" }, session: { id: "session-1" } };
  const bridge = createBetterAuthCompatibilityBridge({
    enabled: true,
    databaseFactory: () => ({ end: async () => {} }),
    loadRuntime: async () => ({
      createBetterAuthRuntime: () => ({
        handler() {},
        async getSession(headers) {
          assert.equal(headers.cookie, "better-auth.session_token=test-token");
          return expectedSession;
        }
      })
    })
  });
  const socket = {
    data: {},
    handshake: { headers: { cookie: "better-auth.session_token=test-token" } }
  };

  await new Promise((resolve, reject) => {
    bridge.socketMiddleware(socket, (error) => error ? reject(error) : resolve());
  });
  assert.deepEqual(socket.data.accountSession, expectedSession);
  await bridge.close();
});

test("Better Auth handler is mounted before express.json and socket connections", () => {
  const authRoute = serverSource.indexOf('app.all("/api/auth/*"');
  const jsonParser = serverSource.indexOf("app.use(express.json");
  const socketAuth = serverSource.indexOf("io.use(betterAuthCompatibilityBridge.socketMiddleware)");
  const socketConnections = serverSource.indexOf('io.on("connection"');
  assert.ok(authRoute >= 0 && authRoute < jsonParser);
  assert.ok(socketAuth >= 0 && socketAuth < socketConnections);
});

test("compatibility migration requires two explicit opt-ins", async () => {
  const { runCompatibilityMigration } = await import("../auth/migrate-compatibility-spike.mjs");
  const database = { end: async () => {} };
  const getMigrations = async () => {
    throw new Error("migration must not run");
  };

  await assert.rejects(
    runCompatibilityMigration({
      env: { ...validEnv },
      database,
      getMigrations
    }),
    /IMMERSA_AUTH_SPIKE_MIGRATE=true/
  );
});

test("compatibility migration delegates schema creation to Better Auth", async () => {
  const { runCompatibilityMigration } = await import("../auth/migrate-compatibility-spike.mjs");
  let ran = false;
  const database = { end: async () => {} };
  const result = await runCompatibilityMigration({
    env: {
      ...validEnv,
      IMMERSA_AUTH_SPIKE_MIGRATE: "true"
    },
    database,
    getMigrations: async (options) => {
      assert.equal(options.database, database);
      assert.equal(options.emailAndPassword.enabled, true);
      return {
        toBeCreated: [{ table: "user" }, { table: "session" }],
        toBeAdded: [],
        async runMigrations() {
          ran = true;
        }
      };
    }
  });

  assert.equal(ran, true);
  assert.deepEqual(result, { created: ["user", "session"], updated: [] });
});
