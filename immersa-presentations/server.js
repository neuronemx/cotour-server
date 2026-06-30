const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { execFile } = require("child_process");
const { Server } = require("socket.io");
const { createUploadHandler } = require("./pdf-upload-support");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const STATIC_DECKS_DIR = path.join(PUBLIC_DIR, "decks");
const DATA_DIR = process.env.IMMERSA_DATA_DIR
  ? path.resolve(process.env.IMMERSA_DATA_DIR)
  : path.join(__dirname, "data");
const DATA_DECKS_DIR = path.join(DATA_DIR, "decks");
const DATA_TMP_DIR = path.join(DATA_DIR, "tmp");
const sessions = new Map();
const deckSlideCounts = { demo: 3 };
const allowedReactions = new Set(["❤️", "👏", "🔥"]);

async function ensureDataDirs() {
  await fs.promises.mkdir(DATA_DECKS_DIR, { recursive: true });
  await fs.promises.mkdir(DATA_TMP_DIR, { recursive: true });
}

async function findDeckDir(deckId) {
  const candidates = [path.join(DATA_DECKS_DIR, deckId), path.join(STATIC_DECKS_DIR, deckId)];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(path.join(candidate, "manifest.json"), fs.constants.R_OK);
      return candidate;
    } catch (_error) {
      // Try the next storage location.
    }
  }
  throw new Error("Deck manifest not found: " + deckId);
}

function manifestSummary(manifest) {
  const slides = Array.isArray(manifest.slides) ? manifest.slides.length : 0;
  const status = manifest.status || "ready";
  const conversionStatus = manifest.conversion?.status || "ready";
  const converted = status === "converted" && conversionStatus === "completed";
  const ready = status === "ready" && conversionStatus === "ready";
  const realSlideCount = converted || ready;

  return {
    deckId: manifest.deckId,
    title: manifest.title,
    slides,
    slideCount: realSlideCount ? slides : null,
    placeholderSlides: realSlideCount ? 0 : slides,
    ratio: manifest.ratio || "16:9",
    status,
    conversionStatus,
    conversionMessage: manifest.conversion?.message || ""
  };
}

async function readManifest(deckId) {
  const deckDir = await findDeckDir(deckId);
  return JSON.parse(await fs.promises.readFile(path.join(deckDir, "manifest.json"), "utf8"));
}

async function readDecksFrom(rootDir, seen) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const decks = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue;
    const manifestPath = path.join(rootDir, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      seen.add(entry.name);
      decks.push(manifestSummary({ ...manifest, deckId: manifest.deckId || entry.name, title: manifest.title || entry.name }));
    } catch (error) {
      console.warn("Skipping deck manifest", manifestPath, error.message);
    }
  }

  return decks;
}

async function listDecks() {
  await ensureDataDirs();
  const seen = new Set();
  const decks = [
    ...(await readDecksFrom(STATIC_DECKS_DIR, seen)),
    ...(await readDecksFrom(DATA_DECKS_DIR, seen))
  ];
  return decks.sort((a, b) => a.title.localeCompare(b.title));
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function commandAvailable(command, args = ["--version"]) {
  try {
    await execFileAsync(command, args, { timeout: 10000 });
    return true;
  } catch (_error) {
    return false;
  }
}

async function commandExists(command) {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(lookupCommand, [command], { timeout: 10000 });
    return true;
  } catch (_error) {
    return false;
  }
}

async function findLibreOfficeCommand() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    "libreoffice",
    "soffice",
    process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe" : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await commandAvailable(candidate)) return candidate;
  }

  return null;
}

async function detectPdftoppm() {
  const exists = await commandExists("pdftoppm");
  if (!exists) return false;

  try {
    await execFileAsync("pdftoppm", ["-v"], { timeout: 10000 });
    return true;
  } catch (error) {
    const output = String(error.stdout || "") + String(error.stderr || "");
    return !/command not found|not recognized|no such file/i.test(output);
  }
}

async function conversionHealth() {
  const libreOfficeCommand = await findLibreOfficeCommand();
  const pdftoppmAvailable = await detectPdftoppm();
  return {
    libreOfficeAvailable: Boolean(libreOfficeCommand),
    libreOfficeCommand: libreOfficeCommand && libreOfficeCommand.includes(path.sep) ? path.basename(libreOfficeCommand) : libreOfficeCommand,
    pdftoppmAvailable,
    pdftoppmCommand: pdftoppmAvailable ? "pdftoppm" : null
  };
}

async function logConversionHealth() {
  try {
    const health = await conversionHealth();
    console.log("Conversion health: LibreOffice command found: " + (health.libreOfficeCommand || "none"));
    console.log("Conversion health: pdftoppm available: " + health.pdftoppmAvailable);
  } catch (error) {
    console.warn("Conversion health check failed", error.message);
  }
}

async function getDeckSlideCount(deckId) {
  if (!deckId) return 1;
  try {
    const manifest = await readManifest(deckId);
    const slideCount = Array.isArray(manifest.slides) && manifest.slides.length ? manifest.slides.length : 1;
    deckSlideCounts[deckId] = slideCount;
    return slideCount;
  } catch (_error) {
    return deckSlideCounts[deckId] || 1;
  }
}

function createSession(deckId, slideCount = deckSlideCounts[deckId] || 1) {
  return {
    deckId,
    slideCount,
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

function getSession(sessionId, deckId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, createSession(deckId || "demo"));
  const session = sessions.get(sessionId);
  if (deckId && session.deckId !== deckId) {
    session.deckId = deckId;
    session.slideCount = deckSlideCounts[deckId] || 1;
    session.slideIndex = 0;
    session.presenterSlideIndex = 0;
    session.liveSlideIndex = 0;
  }
  return session;
}

function clampSlide(session, slideIndex) {
  const lastSlide = Math.max(0, (session.slideCount || 1) - 1);
  const numeric = Number.isFinite(slideIndex) ? slideIndex : 0;
  return Math.max(0, Math.min(numeric, lastSlide));
}

async function refreshSessionDeck(session, deckId = session.deckId) {
  if (deckId && session.deckId !== deckId) session.deckId = deckId;
  const slideCount = await getDeckSlideCount(session.deckId);
  session.slideCount = slideCount;
  session.presenterSlideIndex = clampSlide(session, session.presenterSlideIndex);
  session.slideIndex = session.presenterSlideIndex;
  session.liveSlideIndex = clampSlide(session, session.liveSlideIndex);
  return slideCount;
}

function publicState(session) {
  return {
    deckId: session.deckId,
    slideIndex: session.slideIndex,
    presenterSlideIndex: session.presenterSlideIndex,
    liveSlideIndex: session.liveSlideIndex,
    slideCount: session.slideCount,
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

async function setPresenterSlide(sessionId, session, nextIndex) {
  const requestedIndex = Number.isFinite(nextIndex) ? nextIndex : 0;
  const slideCount = await refreshSessionDeck(session);
  const clampedIndex = clampSlide(session, requestedIndex);
  console.log("[navigate]", sessionId, "requested", requestedIndex, "clamped", clampedIndex, "slideCount", slideCount);
  session.presenterSlideIndex = clampedIndex;
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

ensureDataDirs().catch((error) => console.error("Unable to prepare Immersa data directory", error));
app.use("/decks", express.static(DATA_DECKS_DIR));
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
app.get("/api/conversion-health", async (_req, res) => {
  try {
    res.json(await conversionHealth());
  } catch (error) {
    console.error("Unable to check conversion health", error);
    res.status(500).json({ error: "Unable to check conversion health" });
  }
});
app.post("/api/upload-pptx", createUploadHandler());
app.get("/presenter", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "presenter", "index.html")));
app.get("/screen", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/stage", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "stage", "index.html")));
app.get("/audience", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "audience", "index.html")));

io.on("connection", (socket) => {
  let currentSessionId = null;
  let currentRole = null;
  let currentAudienceId = null;

  socket.on("join_presentation", async ({ session: sessionId, deck: deckId, role }) => {
    if (!sessionId || !role) return;
    currentSessionId = sessionId;
    currentRole = role;
    const session = getSession(sessionId, deckId || "demo");
    const slideCount = await refreshSessionDeck(session, deckId || session.deckId);
    if (role === "presenter") console.log("[session]", sessionId, "deck", session.deckId, "slideCount", slideCount);
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

  socket.on("slide_next", async () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    await setPresenterSlide(currentSessionId, session, session.presenterSlideIndex + 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_prev", async () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    await setPresenterSlide(currentSessionId, session, session.presenterSlideIndex - 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_go", async ({ slideIndex }) => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    await setPresenterSlide(currentSessionId, session, Number(slideIndex));
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
  logConversionHealth();
});
