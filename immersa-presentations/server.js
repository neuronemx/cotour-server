const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DECKS_DIR = path.join(PUBLIC_DIR, "decks");
const UPLOADS_DIR = path.join(__dirname, "uploads", "original-pptx");
const sessions = new Map();
const deckSlideCounts = { demo: 3 };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

function normalizeId(value, fallback = "deck") {
  const normalized = String(value || fallback)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

async function uniqueDeckId(baseId) {
  const base = normalizeId(baseId);
  let candidate = base;
  let suffix = 2;

  while (fs.existsSync(path.join(DECKS_DIR, candidate))) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }

  return candidate;
}

async function uniqueUploadName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const base = normalizeId(path.basename(originalName, ext), "presentacion");
  let candidate = base + ext;
  let suffix = 2;

  while (fs.existsSync(path.join(UPLOADS_DIR, candidate))) {
    candidate = base + "-" + suffix + ext;
    suffix += 1;
  }

  return candidate;
}

function placeholderSvg(title) {
  const safeTitle = String(title || "Presentación cargada")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="PPTX cargado, conversión pendiente">',
    '  <defs>',
    '    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">',
    '      <stop offset="0" stop-color="#06070a"/>',
    '      <stop offset="0.58" stop-color="#111820"/>',
    '      <stop offset="1" stop-color="#0b0d0f"/>',
    '    </linearGradient>',
    '    <radialGradient id="glow" cx="72%" cy="20%" r="58%">',
    '      <stop offset="0" stop-color="#68d8cc" stop-opacity="0.22"/>',
    '      <stop offset="1" stop-color="#68d8cc" stop-opacity="0"/>',
    '    </radialGradient>',
    '  </defs>',
    '  <rect width="1600" height="900" fill="url(#bg)"/>',
    '  <rect width="1600" height="900" fill="url(#glow)"/>',
    '  <rect x="120" y="110" width="1360" height="680" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>',
    '  <text x="160" y="178" fill="#f3d27a" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="7">IMMERSA</text>',
    '  <text x="800" y="382" fill="#f7f2e8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="74" font-weight="850" text-anchor="middle">PPTX cargado</text>',
    '  <text x="800" y="468" fill="#68d8cc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="38" font-weight="700" text-anchor="middle">Conversión pendiente</text>',
    '  <text x="800" y="548" fill="#c8d2ce" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" text-anchor="middle">' + safeTitle + '</text>',
    '</svg>',
    ''
  ].join("\n");
}

async function listDecks() {
  const entries = await fs.promises.readdir(DECKS_DIR, { withFileTypes: true });
  const decks = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(DECKS_DIR, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      decks.push({
        deckId: manifest.deckId || entry.name,
        title: manifest.title || entry.name,
        slides: Array.isArray(manifest.slides) ? manifest.slides.length : 0,
        ratio: manifest.ratio || "16:9",
        status: manifest.status || "ready",
        conversionStatus: manifest.conversion?.status || "ready"
      });
    } catch (error) {
      console.warn("Skipping deck manifest", manifestPath, error.message);
    }
  }

  return decks.sort((a, b) => a.title.localeCompare(b.title));
}
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
  io.to(sessionId).emit("reaction", { emoji, target: "audience", at: Date.now() });
  io.to(sessionId).emit("reaction", { emoji, target: "presenter", at: Date.now() });
  if (session.overlays.reactionsOnScreen) {
    io.to(sessionId).emit("reaction", { emoji, target: "screen", at: Date.now() });
  }
}

app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));
app.get("/home", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));
app.get("/api/decks", async (_req, res) => {
  try {
    res.json(await listDecks());
  } catch (error) {
    console.error("Unable to list decks", error);
    res.status(500).json({ error: "Unable to list decks" });
  }
});
app.post("/api/upload-pptx", (req, res) => {
  upload.single("pptx")(req, res, async (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "El archivo supera el límite de 100 MB" : "No se pudo recibir el archivo";
      return res.status(400).json({ error: message });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ error: "Falta el archivo PPTX" });
    if (path.extname(file.originalname).toLowerCase() !== ".pptx") {
      return res.status(400).json({ error: "Solo se aceptan archivos .pptx" });
    }

    try {
      await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.promises.mkdir(DECKS_DIR, { recursive: true });

      const sourceTitle = req.body.title || path.basename(file.originalname, path.extname(file.originalname));
      const deckId = await uniqueDeckId(req.body.deckId || sourceTitle);
      const storedFilename = await uniqueUploadName(file.originalname);
      const deckDir = path.join(DECKS_DIR, deckId);
      const slidesDir = path.join(deckDir, "slides");

      await fs.promises.mkdir(slidesDir, { recursive: true });
      await fs.promises.writeFile(path.join(UPLOADS_DIR, storedFilename), file.buffer);

      const title = String(sourceTitle || deckId).trim() || deckId;
      const manifest = {
        deckId,
        title,
        ratio: "16:9",
        status: "uploaded",
        source: {
          type: "pptx",
          filename: file.originalname
        },
        slides: [
          {
            id: "placeholder",
            src: "slides/placeholder.svg",
            title: "Presentación cargada"
          }
        ],
        conversion: {
          status: "pending",
          message: "Conversión PPTX pendiente"
        }
      };

      await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      await fs.promises.writeFile(path.join(slidesDir, "placeholder.svg"), placeholderSvg(title));
      deckSlideCounts[deckId] = 1;

      return res.status(201).json({
        deckId,
        title,
        slides: 1,
        ratio: "16:9",
        status: "uploaded",
        conversionStatus: "pending"
      });
    } catch (writeError) {
      console.error("Unable to store PPTX", writeError);
      return res.status(500).json({ error: "No se pudo guardar la presentación" });
    }
  });
});
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
    session.overlays = { ...session.overlays, qrVisible: false, messageVisible: false, messageText: "", selectedQuestion: null, questionVisible: false };
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
