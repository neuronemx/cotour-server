const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { execFile } = require("child_process");
let multer;
try {
  multer = require("multer");
} catch (_error) {
  multer = null;
}
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

function splitMultipart(buffer, boundary) {
  const delimiter = Buffer.from("--" + boundary);
  const parts = [];
  let start = buffer.indexOf(delimiter);

  while (start !== -1) {
    start += delimiter.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    let end = buffer.indexOf(delimiter, start);
    if (end === -1) break;
    let part = buffer.subarray(start, end);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.subarray(0, part.length - 2);
    parts.push(part);
    start = end;
  }

  return parts;
}

function createFallbackUpload(limitBytes) {
  return {
    single(fieldName) {
      return (req, _res, next) => {
        const contentType = req.headers["content-type"] || "";
        const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/);
        const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
        if (!boundary) return next(new Error("Invalid multipart request"));

        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > limitBytes) {
            const error = new Error("File too large");
            error.code = "LIMIT_FILE_SIZE";
            req.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        req.on("error", next);
        req.on("end", () => {
          try {
            req.body = {};
            const buffer = Buffer.concat(chunks);
            for (const part of splitMultipart(buffer, boundary.trim())) {
              const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
              if (headerEnd === -1) continue;
              const headers = part.subarray(0, headerEnd).toString("latin1");
              const body = part.subarray(headerEnd + 4);
              const disposition = headers.match(/content-disposition:[^\r\n]+/i)?.[0] || "";
              const name = disposition.match(/name="([^"]+)"/)?.[1];
              const filename = disposition.match(/filename="([^"]*)"/)?.[1];
              if (!name) continue;
              if (name === fieldName && filename) {
                req.file = { fieldname: name, originalname: filename, buffer: body, size: body.length };
              } else {
                req.body[name] = body.toString("utf8");
              }
            }
            next();
          } catch (error) {
            next(error);
          }
        });
      };
    }
  };
}

const upload = multer
  ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })
  : createFallbackUpload(100 * 1024 * 1024);

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
  const manifestPath = path.join(DECKS_DIR, deckId, "manifest.json");
  return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
}

async function refreshDeckSlideCount(deckId) {
  if (!deckId) return deckSlideCounts.demo || 1;
  try {
    const manifest = await readManifest(deckId);
    const slideCount = Array.isArray(manifest.slides) && manifest.slides.length ? manifest.slides.length : 1;
    deckSlideCounts[deckId] = slideCount;
    return slideCount;
  } catch (_error) {
    return deckSlideCounts[deckId] || 1;
  }
}

async function writeManifest(deckDir, manifest) {
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

async function listDecks() {
  const entries = await fs.promises.readdir(DECKS_DIR, { withFileTypes: true });
  const decks = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(DECKS_DIR, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      decks.push(manifestSummary({ ...manifest, deckId: manifest.deckId || entry.name, title: manifest.title || entry.name }));
    } catch (error) {
      console.warn("Skipping deck manifest", manifestPath, error.message);
    }
  }

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

async function findLibreOffice() {
  const command = await findLibreOfficeCommand();
  if (command) return command;
  throw new Error("LibreOffice no está disponible. La conversión no pudo completarse.");
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

async function assertPdftoppm() {
  if (await detectPdftoppm()) return;
  throw new Error("pdftoppm no está disponible. La conversión no pudo completarse.");
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

function naturalSlideNumber(fileName) {
  const match = fileName.match(/-(\d+)\.jpe?g$/i) || fileName.match(/(\d+)\.jpe?g$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function normalizeRenderedImages(sourceDir, targetDir) {
  const files = (await fs.promises.readdir(sourceDir))
    .filter((file) => /\.jpe?g$/i.test(file))
    .sort((a, b) => naturalSlideNumber(a) - naturalSlideNumber(b));

  const normalized = [];
  for (let index = 0; index < files.length; index += 1) {
    const nextName = "slide-" + String(index + 1).padStart(3, "0") + ".jpg";
    await fs.promises.copyFile(path.join(sourceDir, files[index]), path.join(targetDir, nextName));
    normalized.push(nextName);
  }

  return normalized;
}

async function renderPdf(pdfPath, outputDir, prefix, width, quality) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-r", "150",
    "-scale-to-x", String(width),
    "-scale-to-y", "-1",
    "-jpegopt", "quality=" + quality,
    pdfPath,
    path.join(outputDir, prefix)
  ], { timeout: 120000 });
}

async function convertDeckPptx({ deckDir, pptxPath, manifest }) {
  const libreOffice = await findLibreOffice();
  await assertPdftoppm();

  const workDir = path.join(deckDir, ".conversion");
  const pdfDir = path.join(workDir, "pdf");
  const fullRawDir = path.join(workDir, "full");
  const thumbRawDir = path.join(workDir, "thumbs");
  const slidesDir = path.join(deckDir, "slides");
  const thumbsDir = path.join(deckDir, "thumbs");

  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.rm(thumbsDir, { recursive: true, force: true });
  await fs.promises.mkdir(pdfDir, { recursive: true });
  await fs.promises.mkdir(slidesDir, { recursive: true });
  await fs.promises.mkdir(thumbsDir, { recursive: true });

  await execFileAsync(libreOffice, ["--headless", "--convert-to", "pdf", "--outdir", pdfDir, pptxPath], { timeout: 120000 });
  const pdfFiles = (await fs.promises.readdir(pdfDir)).filter((file) => file.toLowerCase().endsWith(".pdf"));
  if (!pdfFiles.length) throw new Error("No se generó PDF desde el PPTX.");
  const pdfPath = path.join(pdfDir, pdfFiles[0]);

  await renderPdf(pdfPath, fullRawDir, "slide", 1920, 85);
  await renderPdf(pdfPath, thumbRawDir, "slide", 320, 75);

  const slideFiles = await normalizeRenderedImages(fullRawDir, slidesDir);
  const thumbFiles = await normalizeRenderedImages(thumbRawDir, thumbsDir);
  if (!slideFiles.length) throw new Error("No se generaron imágenes JPG desde el PDF.");

  const count = Math.min(slideFiles.length, thumbFiles.length || slideFiles.length);
  manifest.status = "converted";
  manifest.source = { type: "pptx", filename: "original.pptx" };
  manifest.slides = Array.from({ length: count }, (_item, index) => {
    const fileName = slideFiles[index];
    return {
      id: fileName.replace(/\.jpg$/i, ""),
      src: "slides/" + fileName,
      thumb: "thumbs/" + (thumbFiles[index] || fileName),
      title: "Slide " + (index + 1)
    };
  });
  manifest.conversion = {
    status: "completed",
    message: "Conversión completada",
    format: "jpg",
    slideResolution: "1920x1080",
    thumbResolution: "320x180"
  };

  await fs.promises.rm(workDir, { recursive: true, force: true });
  return manifest;
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

async function setPresenterSlide(session, nextIndex) {
  await refreshDeckSlideCount(session.deckId);
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
app.get("/api/conversion-health", async (_req, res) => {
  try {
    res.json(await conversionHealth());
  } catch (error) {
    console.error("Unable to check conversion health", error);
    res.status(500).json({ error: "Unable to check conversion health" });
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
      const originalPath = path.join(deckDir, "original.pptx");

      await fs.promises.mkdir(slidesDir, { recursive: true });
      await fs.promises.writeFile(path.join(UPLOADS_DIR, storedFilename), file.buffer);
      await fs.promises.writeFile(originalPath, file.buffer);

      const title = String(sourceTitle || deckId).trim() || deckId;
      let manifest = {
        deckId,
        title,
        ratio: "16:9",
        status: "uploaded",
        source: {
          type: "pptx",
          filename: "original.pptx"
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
          message: "Convirtiendo PPTX"
        }
      };

      await fs.promises.writeFile(path.join(slidesDir, "placeholder.svg"), placeholderSvg(title));
      await writeManifest(deckDir, manifest);

      try {
        manifest = await convertDeckPptx({ deckDir, pptxPath: originalPath, manifest });
      } catch (conversionError) {
        await fs.promises.rm(path.join(deckDir, ".conversion"), { recursive: true, force: true });
        manifest.status = "conversion_failed";
        manifest.conversion = {
          status: "failed",
          message: conversionError.message || "La conversión no pudo completarse"
        };
      }

      await writeManifest(deckDir, manifest);
      deckSlideCounts[deckId] = Array.isArray(manifest.slides) ? manifest.slides.length : 1;

      return res.status(201).json(manifestSummary(manifest));
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

  socket.on("join_presentation", async ({ session: sessionId, deck: deckId, role }) => {
    if (!sessionId || !role) return;
    currentSessionId = sessionId;
    currentRole = role;
    const session = getSession(sessionId, deckId || "demo");
    await refreshDeckSlideCount(session.deckId);
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
    await setPresenterSlide(session, session.presenterSlideIndex + 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_prev", async () => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    await setPresenterSlide(session, session.presenterSlideIndex - 1);
    emitState(currentSessionId, session);
  });

  socket.on("slide_go", async ({ slideIndex }) => {
    if (!currentSessionId || currentRole !== "presenter") return;
    const session = getSession(currentSessionId);
    await setPresenterSlide(session, Number(slideIndex));
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
