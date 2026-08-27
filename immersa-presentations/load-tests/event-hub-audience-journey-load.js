const { io } = require("socket.io-client");

const TARGET = String(process.env.IMMERSA_TEMP_URL || "").replace(/\/$/, "");
const PUBLIC_ID = String(process.env.IMMERSA_EVENT_PUBLIC_ID || "");
const REGISTRATION_KEY = String(process.env.IMMERSA_TEST_REGISTRATION_KEY || "github-load");
const LIVE_SESSION_ID = String(process.env.IMMERSA_LIVE_SESSION_ID || "");
const USERS = Math.min(Math.max(Number(process.env.USERS || 25), 1), 2500);
const RAMP_MS = Math.max(Number(process.env.RAMP_MS || 1000), 0);
const HOLD_MS = Math.min(Math.max(Number(process.env.HOLD_MS || 60000), 1000), 1800000);
const SLIDES_PER_USER = Math.min(Math.max(Number(process.env.SLIDES_PER_USER || 0), 0), 50);
const SLIDE_INTERVAL_MS = Math.max(Number(process.env.SLIDE_INTERVAL_MS || 1000), 0);
const QNA_BURST_AFTER_MS = Math.max(Number(process.env.QNA_BURST_AFTER_MS || 0), 0);

if (!TARGET || !PUBLIC_ID || !LIVE_SESSION_ID) {
  throw new Error("Required: IMMERSA_TEMP_URL, IMMERSA_EVENT_PUBLIC_ID, IMMERSA_LIVE_SESSION_ID");
}

const stats = {
  http: 0, httpErrors: 0, userErrors: 0, socketErrors: 0, audienceLimitHits: 0,
  connected: 0, reconnects: 0, disconnected: 0, uniqueConnectedUsers: [], latencies: [],
  registrationsCreated: 0, liveSessionEntries: 0,
  manifestsFetched: 0, slidesFetched: 0,
  manifestBodyBytes: 0, manifestContentLengthBytes: 0,
  slideBodyBytes: 0, slideContentLengthBytes: 0,
  qnaSubmitted: 0, qnaRejected: 0, qnaTimeouts: 0
};
const startedAt = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(socket, event, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

function waitForOneOf(socket, events, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const listeners = new Map();
    const cleanup = () => {
      clearTimeout(timer);
      listeners.forEach((listener, event) => socket.off(event, listener));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${events.join(" or ")}`)); }, timeoutMs);
    events.forEach((event) => {
      const listener = (payload) => { cleanup(); resolve({ event, payload }); };
      listeners.set(event, listener);
      socket.on(event, listener);
    });
  });
}

async function request(path, options = {}, parse = "json") {
  const requestStartedAt = performance.now();
  stats.http++;
  let response;
  try {
    response = await fetch(`${TARGET}${path}`, options);
  } catch (error) {
    stats.httpErrors++;
    throw new Error(`Request failed ${path}: ${error.message}`);
  }
  stats.latencies.push(performance.now() - requestStartedAt);
  if (!response.ok) {
    stats.httpErrors++;
    throw new Error(`HTTP ${response.status} ${path}: ${(await response.text()).slice(0, 240)}`);
  }
  if (parse === "text") return response.text();
  if (parse === "buffer") return response.arrayBuffer();
  return response.json();
}

async function requestDeckAsset(path) {
  const requestStartedAt = performance.now();
  stats.http++;
  let response;
  try {
    response = await fetch(`${TARGET}${path}`);
  } catch (error) {
    stats.httpErrors++;
    throw new Error(`Request failed ${path}: ${error.message}`);
  }
  stats.latencies.push(performance.now() - requestStartedAt);
  if (!response.ok) {
    stats.httpErrors++;
    throw new Error(`HTTP ${response.status} ${path}: ${(await response.text()).slice(0, 240)}`);
  }
  const body = await response.arrayBuffer();
  const contentLength = Number(response.headers.get("content-length") || 0);
  return {
    body,
    bodyBytes: body.byteLength,
    contentLengthBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0
  };
}

function recordDeckTransfer(kind, transfer) {
  stats[`${kind}BodyBytes`] += transfer.bodyBytes;
  stats[`${kind}ContentLengthBytes`] += transfer.contentLengthBytes;
}

async function waitUntil(timestamp) {
  const delay = timestamp - Date.now();
  if (delay > 0) await sleep(delay);
}

async function fetchSlides(deck, manifest) {
  const slides = Array.isArray(manifest?.slides) ? manifest.slides.slice(0, SLIDES_PER_USER) : [];
  for (const slide of slides) {
    const source = String(slide?.src || "");
    if (!source) continue;
    const transfer = await requestDeckAsset(`/decks/${encodeURIComponent(deck)}/${source.split("/").map(encodeURIComponent).join("/")}`);
    recordDeckTransfer("slide", transfer);
    stats.slidesFetched++;
    if (SLIDE_INTERVAL_MS) await sleep(SLIDE_INTERVAL_MS);
  }
}

async function submitQnaBurst(socket, index) {
  if (!QNA_BURST_AFTER_MS) return;
  await waitUntil(startedAt + QNA_BURST_AFTER_MS);
  const result = waitForOneOf(socket, ["qna:submitted", "qna:rejected"], 30000);
  socket.emit("qna:submit", {
    question: `Pregunta de carga ${index}: ¿cómo responde IMMERSA bajo concurrencia?`,
    name: `load-${index}`,
    allowNameOnScreen: false
  });
  try {
    const response = await result;
    if (response.event === "qna:submitted") stats.qnaSubmitted++;
    else stats.qnaRejected++;
  } catch (_error) {
    stats.qnaTimeouts++;
  }
}

async function user(index) {
  let socket = null;
  try {
    const registration = await request(`/api/event/public/${encodeURIComponent(PUBLIC_ID)}/registration`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ registrationKey: `${REGISTRATION_KEY}-${index}` })
    });
    stats.registrationsCreated++;
    await request(`/api/event/public/${encodeURIComponent(PUBLIC_ID)}/activities`);
    const entry = await request(`/api/event/live-sessions/${encodeURIComponent(LIVE_SESSION_ID)}/enter`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: registration.participantId })
    });
    stats.liveSessionEntries++;
    const bootstrap = await request(entry.audiencePath, {}, "text");
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
    const slideJourney = SLIDES_PER_USER
      ? requestDeckAsset(`/decks/${encodeURIComponent(deck)}/manifest.json`)
        .then((transfer) => {
          recordDeckTransfer("manifest", transfer);
          stats.manifestsFetched++;
          return fetchSlides(deck, JSON.parse(Buffer.from(transfer.body).toString("utf8")));
        })
      : Promise.resolve();
    const qnaJourney = submitQnaBurst(socket, index);
    const remainingHoldMs = Math.max(0, startedAt + (index - 1) * RAMP_MS + HOLD_MS - Date.now());
    await Promise.all([slideJourney, qnaJourney, sleep(remainingHoldMs)]);
  } catch (error) {
    stats.userErrors++;
    console.error(`[user ${index}] ${error.message}`);
  } finally {
    socket?.disconnect();
  }
}

(async () => {
  console.log(JSON.stringify({ target: TARGET, users: USERS, rampMs: RAMP_MS, holdMs: HOLD_MS, slidesPerUser: SLIDES_PER_USER, slideIntervalMs: SLIDE_INTERVAL_MS, qnaBurstAfterMs: QNA_BURST_AFTER_MS, startedAt: new Date(startedAt).toISOString() }));
  await Promise.all(Array.from({ length: USERS }, async (_, index) => { if (index) await sleep(index * RAMP_MS); return user(index + 1); }));
  stats.uniqueConnectedUsers.sort((a, b) => a - b);
  const latencies = stats.latencies.sort((a, b) => a - b);
  const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
  const estimatedDeckTransferBytes =
    (stats.manifestContentLengthBytes || stats.manifestBodyBytes)
    + (stats.slideContentLengthBytes || stats.slideBodyBytes);
  console.log(JSON.stringify({
    ...stats,
    estimatedDeckTransferBytes,
    estimatedDeckTransferMiB: Number((estimatedDeckTransferBytes / 1024 / 1024).toFixed(3)),
    uniqueConnectedCount: stats.uniqueConnectedUsers.length,
    p50Ms: percentile(.5),
    p95Ms: percentile(.95),
    p99Ms: percentile(.99),
    finishedAt: new Date().toISOString()
  }, null, 2));
})();
