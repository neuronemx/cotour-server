const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { execFile } = require("child_process");
const { Server } = require("socket.io");
const { createUploadHandler } = require("./pdf-upload-support");
const { createAccessLinkHandlers } = require("./access-links");
const { generateUniqueSessionId, manifestSessionId } = require("./session-id");

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
const accessLinkHandlers = createAccessLinkHandlers({
  dataDir: DATA_DIR,
  staticDecksDir: STATIC_DECKS_DIR,
  dataDecksDir: DATA_DECKS_DIR,
  publicDir: PUBLIC_DIR
});
const sessions = new Map();
const deckSlideCounts = { demo: 3 };
const allowedReactions = new Set(["❤️", "👏", "🔥"]);

function normalizeSessionId(sessionId) {
  return String(sessionId || "demo01");
}

function normalizeDeckId(deckId) {
  return String(deckId || "demo");
}

function getRoomKey(sessionId, deckId) {
  return normalizeSessionId(sessionId) + "::" + normalizeDeckId(deckId);
}

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

function dateInfo(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return { iso: new Date(time).toISOString(), time };
}

function firstDateInfo(values) {
  for (const value of values) {
    const info = dateInfo(value);
    if (info) return info;
  }
  return null;
}

function manifestTimestamps(manifest, manifestStats) {
  const converted = firstDateInfo([
    manifest.conversion?.completedAt,
    manifest.conversion?.convertedAt,
    manifest.convertedAt,
    manifest.conversionCompletedAt,
    manifest.conversionFinishedAt,
    manifest.completedAt,
    manifest.converted_at
  ]);
  const updated = firstDateInfo([
    manifest.updatedAt,
    manifest.updated_at,
    manifest.conversion?.updatedAt
  ]);
  const created = firstDateInfo([
    manifest.createdAt,
    manifest.created_at,
    manifest.conversion?.createdAt
  ]);
  const fallback = manifestStats?.mtimeMs ? { iso: new Date(manifestStats.mtimeMs).toISOString(), time: manifestStats.mtimeMs } : null;
  const sort = converted || updated || created || fallback;

  return {
    convertedAt: converted?.iso || "",
    updatedAt: updated?.iso || fallback?.iso || "",
    createdAt: created?.iso || "",
    sortTimestamp: sort?.time || 0
  };
}

function manifestSummary(manifest, manifestStats = null) {
  const slides = Array.isArray(manifest.slides) ? manifest.slides.length : 0;
  const status = manifest.status || "ready";
  const conversionStatus = manifest.conversion?.status || "ready";
  const converted = status === "converted" && conversionStatus === "completed";
  const ready = status === "ready" && conversionStatus === "ready";
  const realSlideCount = converted || ready;

  return {
    deckId: manifest.deckId,
    title: manifest.title,
    session_id: manifestSessionId(manifest),
    slides,
    slideCount: realSlideCount ? slides : null,
    placeholderSlides: realSlideCount ? 0 : slides,
    ratio: manifest.ratio || "16:9",
    status,
    conversionStatus,
    conversionMessage: manifest.conversion?.message || "",
    ...manifestTimestamps(manifest, manifestStats)
  };
}

async function readManifest(deckId) {
  const deckDir = await findDeckDir(deckId);
  return JSON.parse(await fs.promises.readFile(path.join(deckDir, "manifest.json"), "utf8"));
}

function resolveDataDeckDirForDelete(deckId) {
  const normalizedDeckId = String(deckId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalizedDeckId)) {
    const error = new Error("Invalid deck id");
    error.statusCode = 400;
    throw error;
  }

  const dataDecksRoot = path.resolve(DATA_DECKS_DIR);
  const deckDir = path.resolve(dataDecksRoot, normalizedDeckId);
  const relativePath = path.relative(dataDecksRoot, deckDir);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    const error = new Error("Invalid deck id");
    error.statusCode = 400;
    throw error;
  }

  return { deckId: normalizedDeckId, deckDir };
}

async function deleteDataDeck(deckId) {
  const resolved = resolveDataDeckDirForDelete(deckId);
  const manifestPath = path.join(resolved.deckDir, "manifest.json");

  try {
    await fs.promises.access(manifestPath, fs.constants.R_OK);
  } catch (error) {
    if (error.code === "ENOENT") {
      const notFound = new Error("Deck not found");
      notFound.statusCode = 404;
      throw notFound;
    }
    throw error;
  }

  await fs.promises.rm(resolved.deckDir, { recursive: true, force: true });
  delete deckSlideCounts[resolved.deckId];
  return resolved.deckId;
}

async function ensureManifestSessionId(manifestPath, manifest, usedSessionIds, canPersist) {
  const existingSessionId = manifestSessionId(manifest);
  if (existingSessionId) {
    usedSessionIds.add(existingSessionId);
    return manifest;
  }

  const migratedManifest = { ...manifest, session_id: generateUniqueSessionId(usedSessionIds) };
  if (canPersist) {
    await fs.promises.writeFile(manifestPath, JSON.stringify(migratedManifest, null, 2) + "\n");
  }
  return migratedManifest;
}

async function readDecksFrom(rootDir, seen, usedSessionIds, canPersistSessionId = false) {
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
      const manifestStats = await fs.promises.stat(manifestPath);
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      const manifestWithSessionId = await ensureManifestSessionId(manifestPath, manifest, usedSessionIds, canPersistSessionId);
      seen.add(entry.name);
      decks.push(manifestSummary({ ...manifestWithSessionId, deckId: manifestWithSessionId.deckId || entry.name, title: manifestWithSessionId.title || entry.name }, manifestStats));
    } catch (error) {
      console.warn("Skipping deck manifest", manifestPath, error.message);
    }
  }

  return decks;
}

async function listDecks() {
  await ensureDataDirs();
  const seen = new Set();
  const usedSessionIds = new Set();
  const decks = [
    ...(await readDecksFrom(STATIC_DECKS_DIR, seen, usedSessionIds, false)),
    ...(await readDecksFrom(DATA_DECKS_DIR, seen, usedSessionIds, true))
  ];
  return decks.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0) || a.title.localeCompare(b.title));
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

function createSession(sessionId, deckId, slideCount = deckSlideCounts[deckId] || 1) {
  return {
    sessionId,
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
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedDeckId = normalizeDeckId(deckId);
  const roomKey = getRoomKey(normalizedSessionId, normalizedDeckId);
  if (!sessions.has(roomKey)) sessions.set(roomKey, createSession(normalizedSessionId, normalizedDeckId));
  return sessions.get(roomKey);
}

function getSessionByRoomKey(roomKey) {
  return sessions.get(roomKey);
}

function clampSlide(session, slideIndex) {
  const lastSlide = Math.max(0, (session.slideCount || 1) - 1);
  const numeric = Number.isFinite(slideIndex) ? slideIndex : 0;
  return Math.max(0, Math.min(numeric, lastSlide));
}

async function refreshSessionDeck(session, deckId = session.deckId) {
  if (deckId && session.deckId !== deckId) session.deckId = normalizeDeckId(deckId);
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

function emitState(roomKey, session) {
  io.to(roomKey).emit("presentation_state", publicState(session));
  io.to(roomKey).emit("audience_count", session.audience.size);
}

async function setPresenterSlide(roomKey, session, nextIndex) {
  const requestedIndex = Number.isFinite(nextIndex) ? nextIndex : 0;
  const slideCount = await refreshSessionDeck(session);
  const clampedIndex = clampSlide(session, requestedIndex);
  console.log("[navigate]", roomKey, "requested", requestedIndex, "clamped", clampedIndex, "slideCount", slideCount);
  session.presenterSlideIndex = clampedIndex;
  session.slideIndex = session.presenterSlideIndex;
  if (!session.transmissionPaused) session.liveSlideIndex = session.presenterSlideIndex;
}

function emitReaction(roomKey, session, emoji) {
  if (!allowedReactions.has(emoji)) return;
  io.to(roomKey).emit("reaction", { emoji, target: "audience", at: Date.now() });
  io.to(roomKey).emit("reaction", { emoji, target: "presenter", at: Date.now() });
  if (session.overlays.reactionsOnScreen) {
    io.to(roomKey).emit("reaction", { emoji, target: "screen", at: Date.now() });
  }
}

function normalizeDrawingStroke(session, stroke) {
  const points = Array.isArray(stroke?.points) ? stroke.points : [];
  if (points.length < 2) return null;
  const normalizedPoints = points.slice(0, 240).map((point) => ({
    x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
    y: Math.max(0, Math.min(1, Number(point?.y) || 0))
  }));
  const slideIndex = clampSlide(session, Number(stroke?.slideIndex));
  return {
    slideIndex,
    points: normalizedPoints,
    color: "#b20de9",
    width: Math.max(0.003, Math.min(0.02, Number(stroke?.width) || 0.009)),
    createdAt: Date.now(),
    ttl: Math.max(3000, Math.min(5000, Number(stroke?.ttl) || 4200))
  };
}

ensureDataDirs().catch((error) => console.error("Unable to prepare Immersa data directory", error));
app.use(express.json({ limit: "32kb" }));
app.use("/decks", express.static(DATA_DECKS_DIR));
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
app.delete("/api/decks/:deckId", async (req, res) => {
  try {
    const deckId = await deleteDataDeck(req.params.deckId);
    res.json({ ok: true, deckId });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error("Unable to delete deck", error);
    res.status(statusCode).json({ error: statusCode === 404 ? "Deck not found" : statusCode === 400 ? "Invalid deck id" : "Unable to delete deck" });
  }
});
app.post("/api/access-links", accessLinkHandlers.createAccessLink);
app.get("/api/access-links/:access_token", accessLinkHandlers.resolveAccessLink);
app.get("/api/open/:access_token", accessLinkHandlers.openPresentation);
app.get("/speaker/:access_token", accessLinkHandlers.openRole("speaker", "presenter"));
app.get("/presenter/:access_token", accessLinkHandlers.openRole("speaker", "presenter"));
app.get("/stage/:access_token", accessLinkHandlers.openRole("stage", "stage"));
app.get("/audience/:access_token", accessLinkHandlers.openRole("audience", "audience"));
app.get("/screen/:access_token", accessLinkHandlers.openRole("screen", "screen"));
app.get("/viewer/:access_token", accessLinkHandlers.openRole("viewer", "viewer"));
app.get("/api/conversion-health", async (_req, res) => {
  try {
    res.json(await conversionHealth());
  } catch (error) {
    console.error("Unable to check conversion health", error);
    res.status(500).json({ error: "Unable to check conversion health" });
  }
});
app.post("/api/upload-pptx", createUploadHandler());
app.get("/presenter", accessLinkHandlers.guardLegacyRoute("speaker", "presenter"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "presenter", "index.html")));
app.get("/screen", accessLinkHandlers.guardLegacyRoute("screen", "screen"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/viewer", accessLinkHandlers.guardLegacyRoute("viewer", "viewer"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/stage", accessLinkHandlers.guardLegacyRoute("stage", "stage"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "stage", "index.html")));
app.get("/audience", accessLinkHandlers.guardLegacyRoute("audience", "audience"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "audience", "index.html")));
app.get("/:public_id", accessLinkHandlers.openPublicAudience);
app.use(express.static(PUBLIC_DIR));

io.on("connection", (socket) => {
  let currentRoomKey = null;
  let currentRole = null;
  let currentAudienceId = null;

  socket.on("join_presentation", async ({ session: sessionId, deck: deckId, role }) => {
    if (!role) return;
    const joinedSessionId = normalizeSessionId(sessionId);
    const joinedDeckId = normalizeDeckId(deckId);
    currentRoomKey = getRoomKey(joinedSessionId, joinedDeckId);
    currentRole = role;
    const session = getSession(joinedSessionId, joinedDeckId);
    const slideCount = await refreshSessionDeck(session, joinedDeckId);
    if (role === "presenter") console.log("[session]", joinedSessionId, "deck", session.deckId, "room", currentRoomKey, "slideCount", slideCount);
    socket.join(currentRoomKey);

    if (role === "presenter") {
      session.presenterConnected = true;
      io.to(currentRoomKey).emit("presenter_connected");
    }
    if (role === "screen") session.screenConnected = true;
    if (role === "stage") session.stageConnected = true;
    if (role === "audience") {
      currentAudienceId = socket.id;
      session.audience.set(socket.id, { joinedAt: Date.now() });
    }
    emitState(currentRoomKey, session);
  });

  socket.on("transmission_pause", () => {
    if (!currentRoomKey || currentRole !== "presenter") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.transmissionPaused = true;
    emitState(currentRoomKey, session);
  });

  socket.on("transmission_play", () => {
    if (!currentRoomKey || currentRole !== "presenter") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.transmissionPaused = false;
    session.liveSlideIndex = session.presenterSlideIndex;
    session.slideIndex = session.presenterSlideIndex;
    emitState(currentRoomKey, session);
  });

  socket.on("slide_next", async () => {
    if (!currentRoomKey || (currentRole !== "presenter" && currentRole !== "stage")) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    await setPresenterSlide(currentRoomKey, session, session.presenterSlideIndex + 1);
    emitState(currentRoomKey, session);
  });

  socket.on("slide_prev", async () => {
    if (!currentRoomKey || (currentRole !== "presenter" && currentRole !== "stage")) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    await setPresenterSlide(currentRoomKey, session, session.presenterSlideIndex - 1);
    emitState(currentRoomKey, session);
  });

  socket.on("slide_go", async ({ slideIndex }) => {
    if (!currentRoomKey || (currentRole !== "presenter" && currentRole !== "stage")) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    await setPresenterSlide(currentRoomKey, session, Number(slideIndex));
    emitState(currentRoomKey, session);
  });

  socket.on("reaction", ({ emoji }) => {
    if (!currentRoomKey || currentRole !== "audience") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    emitReaction(currentRoomKey, session, emoji);
  });

  socket.on("drawing_stroke", (stroke) => {
    if (!currentRoomKey || currentRole !== "presenter") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    const normalizedStroke = normalizeDrawingStroke(session, stroke);
    if (!normalizedStroke) return;
    io.to(currentRoomKey).emit("drawing_stroke", normalizedStroke);
  });

  socket.on("overlay_update", ({ overlays }) => {
    if (!currentRoomKey || currentRole !== "stage") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.overlays = { ...session.overlays, ...overlays };
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("clear_message", () => {
    if (!currentRoomKey || currentRole !== "stage") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.overlays = { ...session.overlays, messageVisible: false, messageText: "" };
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("clear_screen", () => {
    if (!currentRoomKey || currentRole !== "stage") return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.overlays = { ...session.overlays, qrVisible: false, messageVisible: false, messageText: "", selectedQuestion: null, questionVisible: false };
    io.to(currentRoomKey).emit("clear_overlays");
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("disconnect", () => {
    if (!currentRoomKey) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    if (currentRole === "presenter") {
      session.presenterConnected = false;
      socket.to(currentRoomKey).emit("presenter_disconnected");
    }
    if (currentRole === "screen") session.screenConnected = false;
    if (currentRole === "stage") session.stageConnected = false;
    if (currentRole === "audience" && currentAudienceId) session.audience.delete(currentAudienceId);
    emitState(currentRoomKey, session);
  });
});

server.listen(PORT, () => {
  console.log("Immersa Presentations running at http://localhost:" + PORT);
  logConversionHealth();
});
