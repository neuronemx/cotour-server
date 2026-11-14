const { randomBytes, randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { isSystemDemoDeckId } = require("./system-demo-deck");

const INVITE = /^[a-f0-9]{64}\.[a-f0-9]{64}$/;
const ROLE_TOKEN = /^a_[a-z0-9]{10}$/;
const LEASE_MS = 8000;
const ASSETS = '<link rel="stylesheet" href="/live-guests/client.css?v=4"><script src="/live-guests/event-audio.js?v=1" defer></script><script src="/live-guests/client.js?v=5" defer></script>';

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function createLiveGuests({ io, dataDir, publicDir, origin, enabled, authorizeRole, getRtcConfiguration, projection, canProject, getPresentationSlide }) {
  const rooms = new Map();
  const directory = path.join(dataDir, "live-guests");
  const scopeKey = (deckId, sessionId) => createHash("sha256").update(JSON.stringify([deckId, sessionId])).digest("hex");

  async function saveInvite(key, record) {
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, key + ".json");
    const temporary = filename + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
      await fs.rename(temporary, filename);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async function resolveGuest(token) {
    if (!INVITE.test(token || "")) return null;
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(directory, token.slice(0, 64) + ".json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const expected = Buffer.from(String(record.token || ""));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || record.expiresAt <= Date.now()) return null;
    const stage = await authorizeRole("stage", record.stageToken);
    if (!stage || stage.deck.deckId !== record.deckId || stage.accessLink.session_id !== record.sessionId) return null;
    return { ...record, deckTitle: String(stage.deck.title || "Presentación").slice(0, 200) };
  }

  function pageAssets({ accessLink, deck }) {
    return enabled && !isSystemDemoDeckId(deck?.deckId) && ["stage", "screen"].includes(accessLink.role) ? ASSETS : null;
  }

  async function openGuest(req, res) {
    if (!enabled) return res.sendStatus(404);
    try {
      const record = await resolveGuest(req.params.token);
      if (!record) return res.status(404).send("Este enlace de invitado ya no está disponible.");
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      const html = await fs.readFile(path.join(publicDir, "live-guests", "guest.html"), "utf8");
      return res.type("html").send(html.replace(/\{\{(GUEST_NAME|DECK_TITLE)\}\}/g, (_, field) =>
        escapeHtml(field === "GUEST_NAME" ? record.name || "Invitado" : record.deckTitle)));
    } catch {
      return res.status(503).send("No se pudo comprobar el enlace. Intenta nuevamente.");
    }
  }

  if (!enabled) return { pageAssets, openGuest, endSession: async () => {}, updatePresentation() {} };
  const namespace = io.of("/live-guests");

  namespace.use(async (socket, next) => {
    try {
      const { role, token } = socket.handshake.auth || {};
      if (socket.handshake.headers.origin !== origin) throw new Error();
      let record;
      if (role === "guest") record = await resolveGuest(token);
      else if (["stage", "screen"].includes(role) && ROLE_TOKEN.test(token || "")) {
        const resolved = await authorizeRole(role, token);
        if (resolved) record = { deckId: resolved.deck.deckId, sessionId: resolved.accessLink.session_id };
      }
      if (!record?.deckId || !record.sessionId) throw new Error();
      socket.data.guestRole = role;
      socket.data.guestScope = scopeKey(record.deckId, record.sessionId);
      socket.data.guestRecord = record;
      next();
    } catch { next(new Error("Enlace LIVE no disponible")); }
  });

  function newRoom(key, record) {
    const room = { key, deckId: record.deckId, sessionId: record.sessionId, peers: {}, invite: null, call: null, creating: false };
    rooms.set(key, room);
    return room;
  }

  function state(room) {
    return {
      phase: room.call?.phase || (room.invite?.endedAt ? "ended" : "waiting"),
      id: room.call?.id || null,
      guestName: room.invite?.name || "Invitado",
      guestConnected: Boolean(room.peers.guest?.data.mediaReady),
      stageReady: Boolean(room.peers.stage?.data.mediaReady),
      screenReady: Boolean(room.peers.screen?.data.mediaReady),
      muted: Boolean(room.call?.muted),
      countdown: room.call?.countdown || null,
      returnReady: Boolean(room.peers.screen?.data.returnReady)
    };
  }

  function publish(room, reason = "") {
    const payload = { ...state(room), reason };
    for (const peer of Object.values(room.peers)) peer.emit("guest:state", payload);
  }

  function clearCall(room, reason) {
    const call = room.call;
    if (call) {
      clearInterval(call.timer);
      clearTimeout(call.timeout);
      clearInterval(call.countdownTimer);
      projection.release(room.sessionId, room.deckId, call.id);
      room.call = null;
    }
    publish(room, reason);
  }

  async function stillAuthorized(socket) {
    if (!socket?.connected) return false;
    const { role, token } = socket.handshake.auth;
    const record = socket.data.guestRecord;
    if (role === "guest") {
      const current = await resolveGuest(token);
      return Boolean(current && !current.endedAt);
    }
    const resolved = await authorizeRole(role, token);
    return resolved?.deck.deckId === record.deckId && resolved.accessLink.session_id === record.sessionId;
  }

  async function sendSlide(room, snapshot) {
    const guest = room.peers.guest;
    if (!getPresentationSlide || !guest?.data.mediaReady || room.invite?.endedAt) return;
    const revision = room.slideRevision = (room.slideRevision || 0) + 1;
    let slide = null;
    try {
      if (await stillAuthorized(guest)) {
        slide = await getPresentationSlide(room, snapshot);
        if (!await stillAuthorized(guest)) slide = null;
      }
    } catch { /* Keep the call running when a slide cannot be loaded. */ }
    if (revision === room.slideRevision && room.peers.guest === guest
      && guest.connected && guest.data.mediaReady && !room.invite?.endedAt) guest.emit("guest:slide", slide);
  }

  function updatePresentation(snapshot) {
    const room = rooms.get(scopeKey(snapshot.deckId, snapshot.sessionId));
    if (!room) return;
    const key = JSON.stringify([snapshot.liveSlideIndex ?? snapshot.slideIndex ?? 0, snapshot.operationalLocale || "es"]);
    if (room.presentationKey === key) return;
    room.presentationKey = key;
    return sendSlide(room, snapshot);
  }

  async function renew(room, call) {
    if (room.call !== call || call.checking) return;
    if (Date.now() > call.deadline) return clearCall(room, "signal");
    call.checking = true;
    try {
      const peers = [room.peers.stage, room.peers.guest];
      if (["starting", "countdown", "live"].includes(call.phase)) peers.push(room.peers.screen);
      const checks = await Promise.all(peers.map(stillAuthorized));
      if (room.call !== call) return;
      if (checks.some(valid => !valid)) {
        return clearCall(room, "signal");
      }
      call.deadline = Date.now() + LEASE_MS;
      for (const peer of Object.values(room.peers)) peer.emit("guest:lease", { id: call.id, duration: LEASE_MS });
    } catch { if (room.call === call) clearCall(room, "service"); }
    finally { call.checking = false; }
  }

  function sendPrepare(room, channel, rtc) {
    const roles = channel === "monitor" ? ["guest", "stage"] : ["stage", "screen"];
    for (const role of roles) room.peers[role].emit("guest:prepare", {
      id: room.call.id, channel, rtc, duration: LEASE_MS, offer: role === roles[0]
    });
  }

  function countdown(room, call) {
    if (room.call !== call || call.phase !== "starting" || !call.screenReady || !call.returnReady) return;
    clearTimeout(call.timeout);
    call.phase = "countdown";
    call.countdown = 3;
    publish(room);
    call.countdownTimer = setInterval(() => {
      if (room.call !== call || call.phase !== "countdown") return clearInterval(call.countdownTimer);
      if (!canProject(room.sessionId, room.deckId)) return clearCall(room, "production");
      call.countdown--;
      if (!call.countdown) { clearInterval(call.countdownTimer); call.phase = "live"; }
      publish(room);
    }, 1000);
  }

  namespace.on("connection", socket => {
    const role = socket.data.guestRole;
    const record = socket.data.guestRecord;
    const room = rooms.get(socket.data.guestScope) || newRoom(socket.data.guestScope, record);
    if (room.peers[role]) return socket.disconnect(true);
    if (role === "guest") room.invite = record;
    room.peers[role] = socket;
    publish(room);

    socket.on("guest:invite", async (input, ack) => {
      if (role !== "stage" || typeof ack !== "function") return;
      if (room.creating || room.call) return ack({ ok: false, reason: "busy" });
      room.creating = true;
      try {
        if (!await stillAuthorized(socket)) return ack({ ok: false, reason: "access" });
        const name = String(input?.name || "Invitado").trim().slice(0, 100) || "Invitado";
        const invite = {
          deckId: room.deckId, sessionId: room.sessionId, stageToken: socket.handshake.auth.token,
          token: room.key + "." + randomBytes(32).toString("hex"), name, expiresAt: Date.now() + 86400000
        };
        await saveInvite(room.key, invite);
        room.invite = invite;
        room.peers.guest?.emit("guest:state", { ...state(room), id: null, phase: "ended", reason: "ended" });
        room.peers.guest?.disconnect(true);
        publish(room);
        ack({ ok: true, url: origin + "/guest/" + invite.token });
      } catch { ack({ ok: false, reason: "service" }); }
      finally { room.creating = false; }
    });

    socket.on("guest:media-ready", value => {
      socket.data.mediaReady = value !== false;
      let slideUpdate;
      if (role === "guest") {
        if (socket.data.mediaReady) slideUpdate = sendSlide(room);
        else room.slideRevision = (room.slideRevision || 0) + 1;
      }
      publish(room);
      return slideUpdate;
    });

    socket.on("guest:return-ready", value => {
      if (role !== "screen" || typeof value !== "boolean") return;
      socket.data.returnReady = value;
      if (!value && ["starting", "countdown", "live"].includes(room.call?.phase)) clearCall(room, "signal");
      else publish(room);
    });

    socket.on("guest:wait", async ack => {
      if (role !== "stage" || typeof ack !== "function") return;
      const call = room.call;
      if (!call || !["starting", "countdown", "live"].includes(call.phase) || !await stillAuthorized(socket)) return ack({ ok: false, reason: "busy" });
      if (room.call !== call) return ack({ ok: false, reason: "signal" });
      clearTimeout(call.timeout);
      clearInterval(call.countdownTimer);
      projection.release(room.sessionId, room.deckId, call.id);
      call.phase = "ready";
      call.countdown = null;
      publish(room);
      ack({ ok: true });
    });

    socket.on("guest:connect", async ack => {
      if (role !== "stage" || typeof ack !== "function") return;
      if (room.call || room.creating || !room.peers.guest?.data.mediaReady || !socket.data.mediaReady) {
        return ack({ ok: false, reason: "busy" });
      }
      const call = { id: randomUUID(), phase: "preparing", deadline: Date.now() + LEASE_MS, counts: {}, preparingProgram: false };
      room.call = call;
      call.timeout = setTimeout(() => { if (room.call === call) clearCall(room, "timeout"); }, 15000);
      publish(room);
      try {
        const rtc = await getRtcConfiguration();
        if (room.call !== call) return ack({ ok: false, reason: "signal" });
        if (!(await Promise.all([socket, room.peers.guest].map(stillAuthorized))).every(Boolean)) {
          clearCall(room, "access");
          return ack({ ok: false, reason: "access" });
        }
        if (room.call !== call) return ack({ ok: false, reason: "signal" });
        call.timer = setInterval(() => void renew(room, call), 2000);
        sendPrepare(room, "monitor", rtc);
        ack({ ok: true });
      } catch {
        if (room.call === call) clearCall(room, "service");
        ack({ ok: false, reason: "service" });
      }
    });

    socket.on("guest:take", async ack => {
      if (role !== "stage" || typeof ack !== "function") return;
      const call = room.call;
      if (call?.phase !== "ready" || call.preparingProgram || !room.peers.screen?.data.mediaReady || !room.peers.screen?.data.returnReady) return ack({ ok: false, reason: "busy" });
      call.preparingProgram = true;
      const guest = room.peers.guest;
      const screen = room.peers.screen;
      try {
        const rtc = await getRtcConfiguration();
        const valid = await Promise.all([socket, guest, screen].map(stillAuthorized));
        if (room.call !== call) return ack({ ok: false, reason: "signal" });
        if (!valid.every(Boolean) || !socket.connected || !guest?.connected || !screen?.connected
          || room.peers.guest !== guest || room.peers.screen !== screen
          || !canProject(room.sessionId, room.deckId)) return ack({ ok: false, reason: "busy" });
        if (!projection.acquire(room.sessionId, room.deckId, call.id)) return ack({ ok: false, reason: "production" });
        call.phase = "starting";
        call.screenReady = call.returnReady = false;
        call.timeout = setTimeout(() => { if (room.call === call) clearCall(room, "timeout"); }, 15000);
        sendPrepare(room, "program", rtc);
        publish(room);
        ack({ ok: true });
      } catch {
        if (room.call === call && call.phase === "starting") clearCall(room, "service");
        ack({ ok: false, reason: "service" });
      } finally { call.preparingProgram = false; }
    });

    socket.on("guest:ready", message => {
      const call = room.call;
      if (!call || message?.id !== call.id) return;
      if (message.channel === "monitor" && role === "stage" && call.phase === "preparing") {
        call.phase = "ready";
      } else if (message.channel === "program" && role === "screen" && call.phase === "starting") {
        if (!canProject(room.sessionId, room.deckId)) return clearCall(room, "production");
        call.screenReady = true;
        return countdown(room, call);
      } else if (message.channel === "program" && role === "stage" && call.phase === "starting") {
        call.returnReady = true;
        return countdown(room, call);
      } else return;
      clearTimeout(call.timeout);
      publish(room);
    });

    socket.on("guest:signal", message => {
      const call = room.call;
      if (!call || message?.id !== call.id || !["monitor", "program"].includes(message.channel)) return;
      const roles = message.channel === "monitor" ? ["guest", "stage"] : ["stage", "screen"];
      if (!roles.includes(role) || (message.channel === "program" && !["ready", "starting", "countdown", "live"].includes(call.phase))) return;
      const counter = role + message.channel;
      call.counts[counter] = (call.counts[counter] || 0) + 1;
      if (call.counts[counter] > 200) return;
      let body;
      if (message.description) {
        const { type, sdp } = message.description;
        if (type !== (role === roles[0] ? "offer" : "answer") || typeof sdp !== "string" || sdp.length > 64000
          || /^m=(?!audio\s|video\s)/m.test(sdp)
          || (sdp.match(/^m=audio\s/gm) || []).length !== 1
          || (sdp.match(/^m=video\s/gm) || []).length !== 1) return;
        body = { description: { type, sdp } };
      } else if (typeof message.candidate?.candidate === "string" && message.candidate.candidate.length <= 2048
        && (message.candidate.sdpMid == null || (typeof message.candidate.sdpMid === "string" && message.candidate.sdpMid.length <= 64))
        && (message.candidate.sdpMLineIndex == null || [0, 1].includes(message.candidate.sdpMLineIndex))) {
        body = { candidate: { candidate: message.candidate.candidate, sdpMid: message.candidate.sdpMid, sdpMLineIndex: message.candidate.sdpMLineIndex } };
      }
      if (body) room.peers[roles.find(value => value !== role)]?.emit("guest:signal", { id: call.id, channel: message.channel, ...body });
    });

    socket.on("guest:mute", value => {
      if (role !== "stage" || room.call?.phase !== "live" || typeof value !== "boolean") return;
      room.call.muted = value;
      publish(room);
    });

    socket.on("guest:end", async ack => {
      if (role !== "stage" || typeof ack !== "function") return;
      if (room.creating) return ack({ ok: false, reason: "busy" });
      room.creating = true;
      try {
        if (!await stillAuthorized(socket)) return ack({ ok: false, reason: "access" });
        const invite = room.invite;
        if (invite) invite.endedAt = Date.now();
        clearCall(room, "ended");
        if (invite) await saveInvite(room.key, invite);
        ack({ ok: true });
      } catch { ack({ ok: false, reason: "service" }); }
      finally { room.creating = false; }
    });

    socket.on("guest:failed", message => {
      if (room.call?.id === message?.id) clearCall(room, "signal");
    });

    socket.on("disconnect", () => {
      if (room.peers[role] !== socket) return;
      delete room.peers[role];
      if (role === "stage" || role === "guest" || room.call?.screenReady || ["starting", "countdown", "live"].includes(room.call?.phase)) clearCall(room, "signal");
      else publish(room);
      if (!Object.keys(room.peers).length) rooms.delete(room.key);
    });
  });

  async function endSession({ deckId, sessionId }) {
    const room = rooms.get(scopeKey(deckId, sessionId));
    if (!room) return;
    const invite = room.invite;
    if (invite) invite.endedAt = Date.now();
    clearCall(room, "ended");
    if (invite) {
      try { await saveInvite(room.key, invite); }
      catch { console.error("[live-guests] Unable to persist finished invitation"); }
    }
  }

  return { pageAssets, openGuest, endSession, updatePresentation };
}

module.exports = { createLiveGuests };
