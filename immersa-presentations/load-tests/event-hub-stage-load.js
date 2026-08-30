const { io } = require("socket.io-client");

const TARGET = String(process.env.IMMERSA_TEMP_URL || "").replace(/\/$/, "");
const PUBLIC_ID = String(process.env.IMMERSA_EVENT_PUBLIC_ID || "");
const REGISTRATION_KEY = String(process.env.IMMERSA_TEST_REGISTRATION_KEY || "github-load");
const LIVE_SESSION_ID = String(process.env.IMMERSA_LIVE_SESSION_ID || "");
const USERS = Math.min(Math.max(Number(process.env.USERS || 25), 1), 2500);
const RAMP_MS = Math.max(Number(process.env.RAMP_MS || 1000), 0);
const HOLD_MS = Math.min(Math.max(Number(process.env.HOLD_MS || 60000), 1000), 600000);

if (!TARGET || !PUBLIC_ID || !LIVE_SESSION_ID) {
  throw new Error("Required: IMMERSA_TEMP_URL, IMMERSA_EVENT_PUBLIC_ID, IMMERSA_LIVE_SESSION_ID");
}

const stats = { http: 0, httpErrors: 0, userErrors: 0, socketErrors: 0, audienceLimitHits: 0, connected: 0, reconnects: 0, disconnected: 0, uniqueConnectedUsers: [], latencies: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(socket, event, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

async function request(path, options = {}) {
  const started = performance.now();
  stats.http++;
  let response;
  try {
    response = await fetch(`${TARGET}${path}`, options);
  } catch (error) {
    stats.httpErrors++;
    throw new Error(`Request failed ${path}: ${error.message}`);
  }
  stats.latencies.push(performance.now() - started);
  if (!response.ok) {
    stats.httpErrors++;
    throw new Error(`HTTP ${response.status} ${path}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json();
}

async function user(index) {
  let socket = null;
  try {
    const registration = await request(`/api/event/public/${encodeURIComponent(PUBLIC_ID)}/registration`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ registrationKey: `${REGISTRATION_KEY}-${index}` })
    });
    await request(`/api/event/public/${encodeURIComponent(PUBLIC_ID)}/activities`);
    const entry = await request(`/api/event/live-sessions/${encodeURIComponent(LIVE_SESSION_ID)}/enter`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: registration.participantId })
    });
    const bootstrap = await (await fetch(`${TARGET}${entry.audiencePath}`)).text();
    const session = bootstrap.match(/session":"([^"]+)/)?.[1];
    const deck = bootstrap.match(/deck":"([^"]+)/)?.[1];
    if (!session || !deck) throw new Error("Audience bootstrap did not expose session/deck");

    socket = io(TARGET, { transports: ["websocket", "polling"], reconnection: false, timeout: 30000 });
    socket.on("connect", () => {
      stats.connected++;
      stats.uniqueConnectedUsers.push(index);
      socket.emit("join_presentation", { session, deck, role: "audience", audienceId: registration.participantId, audienceName: `load-${index}`, label: "github-load" });
    });
    socket.on("connect_error", () => { stats.socketErrors++; });
    socket.on("plan:audience_limit", () => { stats.audienceLimitHits++; socket.disconnect(); });
    socket.on("disconnect", () => { stats.disconnected++; });
    await waitFor(socket, "connect");
    await sleep(HOLD_MS);
  } catch (error) {
    stats.userErrors++;
    console.error(`[user ${index}] ${error.message}`);
  } finally {
    socket?.disconnect();
  }
}

(async () => {
  console.log(JSON.stringify({ target: TARGET, users: USERS, rampMs: RAMP_MS, holdMs: HOLD_MS, startedAt: new Date().toISOString() }));
  await Promise.all(Array.from({ length: USERS }, async (_, index) => { if (index) await sleep(index * RAMP_MS); return user(index + 1); }));
  stats.uniqueConnectedUsers.sort((a, b) => a - b);
  const latencies = stats.latencies.sort((a, b) => a - b);
  const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
  console.log(JSON.stringify({ ...stats, uniqueConnectedCount: stats.uniqueConnectedUsers.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), finishedAt: new Date().toISOString() }, null, 2));
})();