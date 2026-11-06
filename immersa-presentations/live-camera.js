const { createHmac, randomUUID } = require("node:crypto");

const ROLES = ["speaker", "screen", "stage"];
const ASSETS = '<link rel="stylesheet" href="/live-camera/pilot.css?v=3"><script src="/live-camera/pilot.js?v=4" defer></script>';
const LEASE_MS = 3500;
const START_TIMEOUT_MS = 15000;
const ACCESS_TOKEN = /^a_[a-z0-9]{10}$/;

function readLiveCameraPilot(env = process.env) {
  if (!env.IMMERSA_LIVE_CAMERA_PILOT) return null;
  try {
    const pilot = JSON.parse(env.IMMERSA_LIVE_CAMERA_PILOT);
    const origin = new URL(pilot.origin);
    const local = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    const stunUrls = pilot.stunUrls ?? [];
    const turnUrls = pilot.turnUrls ?? [];
    const turnSecret = env.IMMERSA_LIVE_CAMERA_TURN_SECRET;
    if ((!local && origin.protocol !== "https:") || origin.origin !== pilot.origin
      || ![pilot.eventWorkspaceId, pilot.activityId, pilot.deckId, pilot.sessionId].every(value => typeof value === "string" && value.trim())
      || !ROLES.every(role => ACCESS_TOKEN.test(pilot.links?.[role] || ""))
      || new Set(ROLES.map(role => pilot.links[role])).size !== ROLES.length
      || !Array.isArray(stunUrls) || !stunUrls.every(url => typeof url === "string" && /^stuns?:\S+$/.test(url))
      || !Array.isArray(turnUrls) || !turnUrls.every(url => typeof url === "string" && /^turns?:\S+$/.test(url))
      || ((turnUrls.length || pilot.forceRelay) && (!turnUrls.length || !turnSecret))) return null;
    return { ...pilot, stunUrls, turnUrls, turnSecret };
  } catch {
    return null;
  }
}

function matchesPilotLink(pilot, accessLink, deck) {
  return Boolean(pilot && accessLink && ROLES.includes(accessLink.role)
    && accessLink.access_token === pilot.links[accessLink.role]
    && accessLink.session_id === pilot.sessionId && deck?.deckId === pilot.deckId);
}

function liveCameraPageAssets(pilot, { req, accessLink, deck }) {
  if (!matchesPilotLink(pilot, accessLink, deck)) return null;
  if (req.query.session && req.query.session !== pilot.sessionId) return null;
  if (req.query.deck && req.query.deck !== pilot.deckId) return null;
  if (req.query.eventActivityId && req.query.eventActivityId !== pilot.activityId) return null;
  return ASSETS;
}

function rtcConfiguration(pilot) {
  const iceServers = [];
  if (pilot.stunUrls.length) iceServers.push({ urls: pilot.stunUrls });
  if (pilot.turnUrls.length) {
    const username = Math.floor(Date.now() / 1000 + 600) + ":" + randomUUID();
    const credential = createHmac("sha1", pilot.turnSecret).update(username).digest("base64");
    iceServers.push({ urls: pilot.turnUrls, username, credential });
  }
  return { iceServers, iceTransportPolicy: pilot.forceRelay ? "relay" : "all" };
}

function signalBody(role, message) {
  const description = message.description;
  if (description?.type === (role === "speaker" ? "offer" : "answer")
    && typeof description.sdp === "string" && description.sdp.length <= 24000
    && !/^m=(?!video\s)/m.test(description.sdp)
    && (description.sdp.match(/^m=video\s/gm) || []).length === 1) {
    return { description: { type: description.type, sdp: description.sdp } };
  }
  const candidate = message.candidate;
  if (typeof candidate?.candidate === "string" && candidate.candidate.length <= 2048
    && (candidate.sdpMid == null || (typeof candidate.sdpMid === "string" && candidate.sdpMid.length <= 64))
    && (candidate.sdpMLineIndex == null || candidate.sdpMLineIndex === 0)) {
    return { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } };
  }
  return null;
}

function attachLiveCamera(io, { pilot, accessLinks, eventHub, canProject = () => true }) {
  if (!pilot || !eventHub) return;
  const channel = io.of("/live-camera");
  let screen = null;
  let active = null;
  let pending = null;

  function status() {
    return { phase: active?.phase || "idle", id: active?.id || null, screenReady: Boolean(screen) };
  }

  function publishStatus(reason) {
    channel.emit("live:status", { ...status(), reason });
  }

  function stop(attempt, reason) {
    if (active !== attempt) return;
    active = null;
    clearTimeout(attempt.startTimeout);
    clearInterval(attempt.leaseTimer);
    publishStatus(reason);
  }

  async function currentEvent() {
    const control = await eventHub.getStageControlForDeck(pilot.deckId, pilot.activityId);
    if (!control?.liveSessionId || control.eventWorkspaceId !== pilot.eventWorkspaceId || control.activityId !== pilot.activityId) return null;
    const live = await eventHub.getLiveSession(control.liveSessionId);
    return live.status === "LIVE" && live.event_workspace_id === pilot.eventWorkspaceId
      && live.event_activity_id === pilot.activityId && live.event_stage_id === control.stageId
      && live.deck_id === pilot.deckId ? live : null;
  }

  async function authorizedLink(socket, role) {
    const token = socket.handshake.auth?.accessToken;
    if (token !== pilot.links[role]) return false;
    const resolved = await accessLinks.resolveRoleLink(token, role);
    return matchesPilotLink(pilot, resolved?.accessLink, resolved?.deck);
  }

  async function renew(attempt) {
    if (active !== attempt) return;
    if (Date.now() >= attempt.expiresAt) return stop(attempt, "signal");
    if (attempt.checking) return;
    attempt.checking = true;
    try {
      const [live, speakerAllowed, screenAllowed] = await Promise.all([
        currentEvent(), authorizedLink(attempt.speaker, "speaker"), authorizedLink(attempt.screen, "screen")
      ]);
      if (active !== attempt) return;
      if (!speakerAllowed) return stop(attempt, "speaker-access");
      if (!screenAllowed) return stop(attempt, "screen-access");
      if (live?.id !== attempt.eventLiveSessionId) return stop(attempt, "event");
      if (!canProject()) return stop(attempt, "production");
      attempt.expiresAt = Date.now() + LEASE_MS;
      for (const peer of [attempt.speaker, attempt.screen]) peer.emit("live:lease", { id: attempt.id, duration: LEASE_MS });
    } catch {
      stop(attempt, "service");
    } finally {
      attempt.checking = false;
    }
  }

  channel.use(async (socket, next) => {
    const role = socket.handshake.auth?.role;
    const denied = new Error("LIVE no disponible");
    try {
      if (!ROLES.includes(role) || socket.handshake.headers.origin !== pilot.origin || !await authorizedLink(socket, role)) return next(denied);
      if (role === "stage") {
        const control = await eventHub.getStageControlForDeck(pilot.deckId, pilot.activityId);
        if (control?.eventWorkspaceId !== pilot.eventWorkspaceId) return next(denied);
        await eventHub.authorizeStageOperation({ eventStageId: control.stageId, accessSecret: pilot.links.stage });
      }
      socket.data.liveCameraRole = role;
      return next();
    } catch {
      return next(denied);
    }
  });

  channel.on("connection", socket => {
    const role = socket.data.liveCameraRole;
    if (role === "screen") {
      if (screen) return socket.disconnect();
      screen = socket;
    }
    publishStatus();

    socket.on("live:start", async ack => {
      if (typeof ack !== "function" || role !== "speaker") return;
      if (active || pending || !screen) return ack({ ok: false, reason: "busy" });
      const reservation = {};
      pending = reservation;
      const expires = setTimeout(() => {
        if (pending !== reservation) return;
        pending = null;
        ack({ ok: false, reason: "timeout" });
      }, 5000);
      const receiver = screen;
      try {
        const [live, speakerAllowed, screenAllowed] = await Promise.all([
          currentEvent(), authorizedLink(socket, role), authorizedLink(receiver, "screen")
        ]);
        if (pending !== reservation) return;
        if (!speakerAllowed) return ack({ ok: false, reason: "speaker-access" });
        if (!screenAllowed) return ack({ ok: false, reason: "screen-access" });
        if (!live) return ack({ ok: false, reason: "event" });
        if (!socket.connected || receiver !== screen || !receiver.connected) return ack({ ok: false, reason: "busy" });
        if (!canProject()) return ack({ ok: false, reason: "production" });
        const attempt = {
          id: randomUUID(), eventLiveSessionId: live.id, phase: "starting", expiresAt: Date.now() + LEASE_MS,
          speaker: socket, screen: receiver, signalCounts: { speaker: 0, screen: 0 }
        };
        active = attempt;
        attempt.startTimeout = setTimeout(() => stop(attempt, "timeout"), START_TIMEOUT_MS);
        attempt.leaseTimer = setInterval(() => void renew(attempt), 1000);
        for (const peer of [receiver, socket]) {
          peer.emit("live:prepare", { id: attempt.id, rtc: rtcConfiguration(pilot), duration: LEASE_MS });
        }
        publishStatus();
        return ack({ ok: true });
      } catch {
        if (pending === reservation) ack({ ok: false, reason: "service" });
      } finally {
        clearTimeout(expires);
        if (pending === reservation) pending = null;
      }
    });

    socket.on("live:signal", message => {
      const attempt = active;
      if (!attempt || attempt.phase !== "starting" || message?.id !== attempt.id
        || !["speaker", "screen"].includes(role) || attempt[role] !== socket
        || ++attempt.signalCounts[role] > 80) return;
      const body = signalBody(role, message);
      if (body) (role === "speaker" ? attempt.screen : attempt.speaker).emit("live:signal", { id: attempt.id, ...body });
    });

    socket.on("live:ready", id => {
      const attempt = active;
      if (!attempt || attempt.id !== id || attempt.screen !== socket || attempt.phase !== "starting") return;
      if (!canProject()) return stop(attempt, "production");
      attempt.phase = "live";
      clearTimeout(attempt.startTimeout);
      publishStatus();
    });

    socket.on("live:camera-switch", message => {
      const attempt = active;
      if (!attempt || attempt.phase !== "live" || attempt.speaker !== socket
        || message?.id !== attempt.id || typeof message.switching !== "boolean") return;
      attempt.screen.emit("live:camera-switch", { id: attempt.id, switching: message.switching });
    });

    socket.on("live:stop", async message => {
      const attempt = active;
      if (!attempt || message?.id !== attempt.id) return;
      if (attempt.speaker === socket || attempt.screen === socket) {
        const reason = ["signal", "production", "camera"].includes(message.reason) ? message.reason : "stopped";
        return stop(attempt, reason);
      }
      if (role !== "stage") return;
      try {
        const live = await currentEvent();
        if (live?.id !== attempt.eventLiveSessionId) return stop(attempt, "event");
        if (!await authorizedLink(socket, role)) return;
        await eventHub.authorizeStageOperation({ eventStageId: live.event_stage_id, accessSecret: pilot.links.stage });
        stop(attempt, "stage");
      } catch {
        // The existing Event Stage grant is required to cut a camera.
      }
    });

    socket.on("disconnect", () => {
      const wasScreen = screen === socket;
      if (wasScreen) screen = null;
      if (active && (active.screen === socket || active.speaker === socket)) stop(active, "signal");
      else if (wasScreen) publishStatus();
    });
  });
}

module.exports = { readLiveCameraPilot, liveCameraPageAssets, attachLiveCamera };
