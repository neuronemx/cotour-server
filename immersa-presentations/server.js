const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const sessions = new Map();
const deckSlideCounts = { demo: 3 };
const allowedReactions = new Set(["❤️", "👏", "🔥"]);

function createSession(deckId) {
  return {
    deckId,
    slideIndex: 0,
    presenterSlideIndex: 0,
    liveSlideIndex: 0,
    transmissionPaused: false,
    presenterConnected: false,
    screenConnected: false,
    stageConnected: false,
    audience: new Map(),
    overlays: {
      reactionsOnScreen: false,
      qrVisible: false,
      messageVisible: false,
      messageText: "",
      standbyMode: false,
      selectedQuestion: null,
      questionVisible: false
    }
  };
}

function getSession(sessionId, deckId = "demo") {
  if (!sessions.has(sessionId)) sessions.set(sessionId, createSession(deckId));
  const session = sessions.get(sessionId);
  if (deckId && session.deckId !== deckId) {
    session.deckId = deckId;
    session.slideIndex = 0;
    session.presenterSlideIndex = 0;
    session.liveSlideIndex = 0;
  }
  return session;
}

function publicState(session) {
  return {
    deckId: session.deckId,
    slideIndex: session.slideIndex,
    presenterSlideIndex: session.presenterSlideIndex,
    liveSlideIndex: session.liveSlideIndex,
    transmissionPaused: session.transmissionPaused,
    presenterConnected: session.presenterConnected,
    screenConnected: session.screenConnected,
    stageConnected: session.stageConnected,
    audienceCount: session.audience.size,
    overlays: session.overlays
  };
}

function emitState(sessionId, session) {
  io.to(sessionId).emit("presentation_state", publicState(session));
  io.to(sessionId).emit("audience_count", session.audience.size);
}

function clampSlide(deckId, slideIndex) {
  const lastSlide = (deckSlideCounts[deckId] || 1) - 1;
  const numeric = Number.isFinite(slideIndex) ? slideIndex : 0;
  return Math.max(0, Math.min(numeric, lastSlide));
}

function setPresenterSlide(session, nextIndex) {
  session.presenterSlideIndex = clampSlide(session.deckId, nextIndex);
  session.slideIndex = session.presenterSlideIndex;
  if (!session.transmissionPaused) session.liveSlideIndex = session.presenterSlideIndex;
}

function emitReaction(sessionId, session, emoji) {
  if (!allowedReactions.has(emoji)) return;
  io.to(sessionId).emit("reaction", { emoji, target: "presenter", at: Date.now() });
  if (session.overlays.reactionsOnScreen) {
    io.to(sessionId).emit("reaction", { emoji, target: "screen", at: Date.now() });
  }
}

app.use(express.static(PUBLIC_DIR));
app.get("/presenter", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "presenter", "index.html")));
app.get("/screen", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/stage", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "stage", "index.html")));
app.get("/audience", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "audience", "index.html")));

io.on("connection", (socket) => {
  let currentSessionId = null;
  let currentRole = null;
  let currentAudienceId = null;

  socket.on("join_presentation", ({ session: sessionId, deck: deckId, role }) => {
    if (!sessionId || !role) return;
    currentSessionId = sessionId;
    currentRole = role;
    const session = getSession(sessionId, deckId || "demo");
    socket.join(sessionId);

    if (role === "presenter") {
      session.presenterConnected = true;
      io.to(sessionId).emit("presenter_connected");
    }
    if (role === "screen") session.screenConnected = true;
    if (role === "stage") session.stageConnected = true;
    if (role === "audience") {
      currentAudienceId = socket.id;
      session.audience.set(socket.id, { joinedAt: Date.now() });
    }
    emitState(sessionId, session);
  });

  socket.on("transmission_pause", () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    session.transmissionPaused = true;
    emitState(currentSessionId, session);
  });

  socket.on("transmission_play", () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    session.transmissionPaused = false;
    session.liveSlideIndex = session.presenterSlideIndex;
    session.slideIndex = session.presenterSlideIndex;
    emitState(currentSessionId, session);
  });

  socket.on("slide_next", () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    setPresenterSlide(session, session.presenterSlideIndex + 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_prev", () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    setPresenterSlide(session, session.presenterSlideIndex - 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_go", ({ slideIndex }) => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    setPresenterSlide(session, Number(slideIndex));
    emitState(currentSessionId, session);
  });

  socket.on("reaction", ({ emoji }) => {
    if (!currentSessionId || currentRole !== "audience") return;
    emitReaction(currentSessionId, getSession(currentSessionId), emoji);
  });

  socket.on("reaction_burst", ({ emoji, count }) => {
    if (!currentSessionId || currentRole !== "audience") return;
    const session = getSession(currentSessionId);
    const total = Math.max(1, Math.min(Number(count) || 8, 24));
    for (let i = 0; i < total; i++) setTimeout(() => emitReaction(currentSessionId, session, emoji), i * 80);
  });

  socket.on("overlay_update", ({ overlays }) => {
    if (!currentSessionId || currentRole !== "stage") return;
    const session = getSession(currentSessionId);
    session.overlays = { ...session.overlays, ...overlays };
    io.to(currentSessionId).emit("overlay_update", session.overlays);
    emitState(currentSessionId, session);
  });

  socket.on("clear_message", () => {
    if (!currentSessionId || currentRole !== "stage") return;
    const session = getSession(currentSessionId);
    session.overlays = { ...session.overlays, messageVisible: false, messageText: "" };
    io.to(currentSessionId).emit("overlay_update", session.overlays);
    emitState(currentSessionId, session);
  });

  socket.on("clear_screen", () => {
    if (!currentSessionId || currentRole !== "stage") return;
    const session = getSession(currentSessionId);
    session.overlays = { ...session.overlays, standbyMode: true, messageVisible: false, messageText: "", qrVisible: false };
    io.to(currentSessionId).emit("overlay_update", session.overlays);
    emitState(currentSessionId, session);
  });

  socket.on("clear_overlays", () => {
    if (!currentSessionId || currentRole !== "stage") return;
    const session = getSession(currentSessionId);
    session.overlays = { ...session.overlays, reactionsOnScreen: false, qrVisible: false, messageVisible: false, messageText: "", standbyMode: false, selectedQuestion: null, questionVisible: false };
    io.to(currentSessionId).emit("clear_overlays");
    io.to(currentSessionId).emit("overlay_update", session.overlays);
    emitState(currentSessionId, session);
  });

  socket.on("disconnect", () => {
    if (!currentSessionId) return;
    const session = getSession(currentSessionId);
    if (currentRole === "presenter") {
      session.presenterConnected = false;
      socket.to(currentSessionId).emit("presenter_disconnected");
    }
    if (currentRole === "screen") session.screenConnected = false;
    if (currentRole === "stage") session.stageConnected = false;
    if (currentRole === "audience" && currentAudienceId) session.audience.delete(currentAudienceId);
    emitState(currentSessionId, session);
  });
});

server.listen(PORT, () => {
  console.log("Immersa Presentations running at http://localhost:" + PORT);
});
