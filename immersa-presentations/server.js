const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { execFile } = require("child_process");
const { Server } = require("socket.io");
const { createUploadHandler, createDeckReplacementHandler } = require("./pdf-upload-support");
const { createAccessLinkHandlers } = require("./access-links");
const { generateUniqueSessionId, manifestSessionId } = require("./session-id");
const { InteractionStore, createInteractionSocketHandlers } = require("./interaction-store");
const { RaffleStore, createRaffleSocketHandlers } = require("./raffle-store");
const { ActiveInteractionCoordinator } = require("./active-interaction-coordinator");
const { GameQueueStore } = require("./game-queue-store");
const { createGameQueueSocketHandlers } = require("./game-queue-sockets");
const { registerAudience, unregisterAudience } = require("./audience-registry");
const { createDeckInteractionHandlers } = require("./deck-interactions-api");
const { createQnaRuntime } = require("./qna-runtime");
const { createQnaHistoryHandlers } = require("./qna-export");
const { createKnowledgeActivityRuntime } = require("./knowledge-activity-runtime");
const { createKnowledgeActivityHistoryHandlers } = require("./knowledge-activity-export");
const {
  PresentationLifecycleRepository,
  createPresentationLifecycleRuntime
} = require("./presentation-lifecycle");
const { createBrandMentionHandlers } = require("./brand-mentions-api");
const { BrandMentionRuntime } = require("./brand-mention-runtime");
const { createBetterAuthCompatibilityBridge } = require("./auth/better-auth-bridge");
const { createProfileHandlers } = require("./profile-api");
const { canUseFeature, isPaidControllerEvent, isPaidMetricsEvent, changesPaidDeckContent } = require("./auth/plan-features");
const {
  DEMO_MASTER_DECK_ID,
  DEMO_PLAN,
  isDemoDeckId,
  demoDeckSummary,
  demoManifest,
  assertDemoConfigurationStructure
} = require("./auth/deck-demo");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const AUTO_START_AUDIENCE_THRESHOLD = 10;
const PUBLIC_DIR = path.join(__dirname, "public");
const STATIC_DECKS_DIR = path.join(PUBLIC_DIR, "decks");
const DATA_DIR = process.env.IMMERSA_DATA_DIR
  ? path.resolve(process.env.IMMERSA_DATA_DIR)
  : path.join(__dirname, "data");
const DATA_DECKS_DIR = path.join(DATA_DIR, "decks");
const DATA_TMP_DIR = path.join(DATA_DIR, "tmp");
const DATA_PROFILES_DIR = path.join(DATA_DIR, "profiles");
const sessions = new Map();
const demoResetTimers = new Map();
const demoInactivityTimers = new Map();
const liveSocketsByRoom = new Map();
const DEMO_DISCONNECT_RESTORE_DELAY_MS = 2 * 60 * 1000;
const DEMO_INACTIVITY_RESTORE_DELAY_MS = 30 * 60 * 1000;
const DEMO_PASSIVE_SOCKET_EVENTS = new Set([
  "games:queue:request_state",
  "pong:request_state",
  "breakout:request_state",
  "presentation:lifecycle:request",
  "time:sync:request",
  "media:playback_update"
]);
const deckSlideCounts = {};
const allowedReactions = new Set(["❤️", "👏", "🔥"]);
const controllerRoles = new Set(["presenter", "stage"]);
const interactionStore = new InteractionStore();
const raffleStore = new RaffleStore();
const activeInteractionCoordinator = new ActiveInteractionCoordinator({ interactionStore, raffleStore });
const gameQueueStore = new GameQueueStore();
const betterAuthCompatibilityBridge = createBetterAuthCompatibilityBridge();
const gameQueueSockets = createGameQueueSocketHandlers({
  io,
  store: gameQueueStore,
  coordinator: activeInteractionCoordinator
});
const interactionSockets = createInteractionSocketHandlers({
  io,
  store: interactionStore,
  loadInteractionsForDeck,
  getRoleRoomKey,
  coordinator: activeInteractionCoordinator,
  onGameFinished: gameQueueSockets.handleGameFinished
});
const raffleSockets = createRaffleSocketHandlers({
  io,
  store: raffleStore,
  getRoleRoomKey,
  getConnectedAudience,
  coordinator: activeInteractionCoordinator
});
const deckInteractionHandlers = createDeckInteractionHandlers({
  dataDecksDir: DATA_DECKS_DIR,
  staticDecksDir: STATIC_DECKS_DIR,
  resolveDeckDir: async (deckId) => isDemoDeckId(deckId)
    ? ensureDemoPracticeDir(deckId)
    : null
});
const qnaRuntime = createQnaRuntime({
  io,
  getRoleRoomKey,
  getRoomKey,
  getConnectedAudience
});
const knowledgeActivityRuntime = createKnowledgeActivityRuntime({
  io,
  coordinator: activeInteractionCoordinator,
  loadDefinitionsForDeck: (deckId) => deckInteractionHandlers.readDeckConfig(deckId),
  getRoleRoomKey,
  getRoomKey,
  getConnectedAudience
});
const lifecyclePool = qnaRuntime.pool || knowledgeActivityRuntime.pool || null;
const presentationLifecycleRuntime = lifecyclePool
  ? createPresentationLifecycleRuntime({
      io,
      repository: new PresentationLifecycleRepository(lifecyclePool),
      getRoleRoomKey,
      beforeStart: async (context) => {
        await knowledgeActivityRuntime.resetSession(context);
        interactionSockets.resetSession(context);
        raffleSockets.resetSession(context);
        gameQueueSockets.resetSession(context);
      },
      preserveAutomaticStart: async (context) => (
        activeInteractionCoordinator.hasAnyActive(context.sessionId)
      ),
      afterStart: async (context, state) => {
        await qnaRuntime.resetSessionState?.({
          deckId: context.deckId,
          sourceSessionId: context.sessionId,
          presentationSessionId: state.presentationSessionId
        });
      },
      beforeFinish: async (context) => (
        activeInteractionCoordinator.hasAnyActive(context.sessionId)
          ? {
              ok: false,
              reason: "ACTIVE_INTERACTION",
              message: "Cierra la interacción activa antes de finalizar"
            }
          : { ok: true }
      ),
      afterFinish: async (context, state) => {
        await knowledgeActivityRuntime.resetSession(context);
        interactionSockets.resetSession(context);
        raffleSockets.resetSession(context);
        gameQueueSockets.resetSession(context);
        await qnaRuntime.resetSessionState?.({
          deckId: context.deckId,
          sourceSessionId: context.sessionId,
          presentationSessionId: state.presentationSessionId
        });
      }
    })
  : {
      attach() {},
      async startAutomatically() {},
      async sendCurrentState(socket) {
        socket.emit("presentation:lifecycle:state", { available: false, mode: "test" });
      }
    };
const accessLinkHandlers = createAccessLinkHandlers({
  dataDir: DATA_DIR,
  staticDecksDir: STATIC_DECKS_DIR,
  dataDecksDir: DATA_DECKS_DIR,
  publicDir: PUBLIC_DIR,
  startScreenExecution: qnaRuntime.startScreenExecution,
  resolveDeckFeatureAccess: (deckId) => betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId),
  resolveDeckManifestBySessionId: resolveDemoDeckManifestBySessionId
});
const qnaHistoryHandlers = createQnaHistoryHandlers({ runtime: qnaRuntime });
const knowledgeActivityHistoryHandlers = createKnowledgeActivityHistoryHandlers({
  runtime: knowledgeActivityRuntime
});
const brandMentionHandlers = createBrandMentionHandlers({
  dataDecksDir: DATA_DECKS_DIR,
  staticDecksDir: STATIC_DECKS_DIR
});
const brandMentionRuntime = new BrandMentionRuntime({
  io,
  store: brandMentionHandlers.store,
  coordinator: activeInteractionCoordinator,
  getRoleRoomKey
});
const profileHandlers = createProfileHandlers({
  bridge: betterAuthCompatibilityBridge,
  profilesDir: DATA_PROFILES_DIR
});

function normalizeSessionId(sessionId) {
  return String(sessionId || "demo01");
}

function normalizeDeckId(deckId) {
  return String(deckId || "demo");
}

function getRoomKey(sessionId, deckId) {
  return normalizeSessionId(sessionId) + "::" + normalizeDeckId(deckId);
}

function getRoleRoomKey(roomKey, role) {
  return roomKey + "::" + role;
}

function canControlPresentation(role) {
  return controllerRoles.has(role);
}

function canNavigatePresentation(role, session) {
  if (!canControlPresentation(role)) return false;
  return !session?.transmissionPaused || session.transmissionPausedBy === role;
}

function canStepPresentation(role, session) {
  if (role === "screen") return true;
  return canNavigatePresentation(role, session);
}

async function ensureDataDirs() {
  await fs.promises.mkdir(DATA_DECKS_DIR, { recursive: true });
  await fs.promises.mkdir(DATA_TMP_DIR, { recursive: true });
}

async function ensureDemoPracticeDir(deckId) {
  const practiceDir = path.join(DATA_DECKS_DIR, deckId);
  const masterDir = path.join(STATIC_DECKS_DIR, DEMO_MASTER_DECK_ID);
  await fs.promises.mkdir(practiceDir, { recursive: true });
  for (const fileName of ["manifest.json", "interactions.json"]) {
    const target = path.join(practiceDir, fileName);
    try {
      await fs.promises.access(target, fs.constants.R_OK);
    } catch (_error) {
      await fs.promises.copyFile(path.join(masterDir, fileName), target);
    }
  }
  return practiceDir;
}

async function removeDemoPracticeDir(deckId) {
  if (!isDemoDeckId(deckId)) return;
  await fs.promises.rm(path.join(DATA_DECKS_DIR, deckId), { recursive: true, force: true });
}

async function findDeckDir(deckId) {
  if (isDemoDeckId(deckId)) return path.join(STATIC_DECKS_DIR, DEMO_MASTER_DECK_ID);
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

async function readDemoMasterManifest() {
  return JSON.parse(await fs.promises.readFile(
    path.join(STATIC_DECKS_DIR, DEMO_MASTER_DECK_ID, "manifest.json"),
    "utf8"
  ));
}

async function resolveDemoDeckManifestBySessionId(sessionId) {
  const binding = await betterAuthCompatibilityBridge.findDemoBySessionId(sessionId);
  if (!binding) return null;
  const master = await readDemoMasterManifest();
  const manifest = demoManifest(master, binding);
  return {
    manifest,
    deck: {
      deckId: binding.deckId,
      title: manifest.title,
      session_id: binding.sessionId,
      ratio: manifest.ratio || "16:9",
      status: manifest.status || "ready",
      conversionStatus: manifest.conversion?.status || "ready",
      isDemo: true,
      demoMode: true,
      plan: DEMO_PLAN
    }
  };
}

async function demoSummaryForBinding(binding) {
  const master = await readDemoMasterManifest();
  return demoDeckSummary(manifestSummary(master), binding);
}

function parseInteractionsContent(content) {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.interactions)) return parsed.interactions;
  return [];
}

async function readInteractionsFile(interactionPath) {
  return parseInteractionsContent(await fs.promises.readFile(interactionPath, "utf8"));
}

async function loadInteractionsForDeck(deckId) {
  if (isDemoDeckId(deckId)) {
    return (await deckInteractionHandlers.readDeckConfig(deckId)).interactions;
  }
  const candidates = [
    path.join(DATA_DECKS_DIR, deckId, "interactions.json"),
    path.join(STATIC_DECKS_DIR, deckId, "interactions.json")
  ];

  for (const interactionPath of candidates) {
    try {
      const interactions = await readInteractionsFile(interactionPath);
      if (interactions.length) return interactions;
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Unable to load deck interactions", deckId, error.message);
    }
  }
  return [];
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
    sourceSizeBytes: Number(manifest.source?.sizeBytes || 0),
    associationsReviewRequired: Boolean(manifest.replacement?.associationsReviewRequired),
    replacement: manifest.replacement || null,
    thumbnail: manifest.slides?.[0]?.thumb || manifest.slides?.[0]?.src || "",
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

function deckHasActiveConnections(deckId) {
  const normalizedDeckId = normalizeDeckId(deckId);
  return [...sessions.values()].some((session) => (
    session.deckId === normalizedDeckId
    && (session.presenterConnected || session.stageConnected || session.screenConnected || session.audience.size > 0)
  ));
}

async function restoreDemoPractice({ roomKey, sessionId, deckId }, { requireDisconnected = true } = {}) {
  const hasLiveSocket = [...liveSocketsByRoom.entries()].some(([key, socketIds]) => (
    key.endsWith("::" + deckId) && socketIds.size > 0
  ));
  if (!isDemoDeckId(deckId) || (requireDisconnected && hasLiveSocket)) return false;
  cancelDisconnectedDemoRestore(deckId);
  cancelInactiveDemoRestore(deckId);
  await betterAuthCompatibilityBridge.clearDemoPractice({ deckId, sessionId });
  await removeDemoPracticeDir(deckId);
  const previousSession = sessions.get(roomKey);
  if (hasLiveSocket && previousSession) {
    const restoredSession = createSession(sessionId, deckId, previousSession.slideCount);
    restoredSession.presenterConnected = previousSession.presenterConnected;
    restoredSession.stageConnected = previousSession.stageConnected;
    restoredSession.screenConnected = previousSession.screenConnected;
    restoredSession.audience = previousSession.audience;
    sessions.set(roomKey, restoredSession);
  } else {
    sessions.delete(roomKey);
  }
  interactionSockets.resetSession({ roomKey, sessionId, deckId });
  raffleSockets.resetSession({ roomKey, sessionId, deckId });
  gameQueueSockets.resetSession({ roomKey, sessionId, deckId });
  await knowledgeActivityRuntime.resetSession({ roomKey, sessionId, deckId });
  await qnaRuntime.resetSessionState?.({ deckId, sourceSessionId: sessionId });
  if (hasLiveSocket) {
    const restoredSession = sessions.get(roomKey);
    if (restoredSession) emitState(roomKey, restoredSession);
    io.to(roomKey).emit("demo:practice_restored", { reason: "inactive" });
  }
  return true;
}

function scheduleDisconnectedDemoRestore(context) {
  if (!isDemoDeckId(context.deckId)) return;
  const previous = demoResetTimers.get(context.deckId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    demoResetTimers.delete(context.deckId);
    void restoreDemoPractice(context).catch((error) => {
      console.error("Unable to restore disconnected Demo", error);
    });
  }, DEMO_DISCONNECT_RESTORE_DELAY_MS);
  demoResetTimers.set(context.deckId, timer);
}

function cancelDisconnectedDemoRestore(deckId) {
  const timer = demoResetTimers.get(deckId);
  if (!timer) return;
  clearTimeout(timer);
  demoResetTimers.delete(deckId);
}

function cancelInactiveDemoRestore(deckId) {
  const timer = demoInactivityTimers.get(deckId);
  if (!timer) return;
  clearTimeout(timer);
  demoInactivityTimers.delete(deckId);
}

function scheduleInactiveDemoRestore(context) {
  if (!isDemoDeckId(context.deckId)) return;
  cancelInactiveDemoRestore(context.deckId);
  const timer = setTimeout(() => {
    demoInactivityTimers.delete(context.deckId);
    void restoreDemoPractice(context, { requireDisconnected: false }).catch((error) => {
      console.error("Unable to restore inactive Demo", error);
    });
  }, DEMO_INACTIVITY_RESTORE_DELAY_MS);
  demoInactivityTimers.set(context.deckId, timer);
}

function assertDeckCanBeReplaced(deckId) {
  if (!deckHasActiveConnections(deckId)) return;
  const error = new Error("Cierra Speaker, Stage, Screen y Público antes de sustituir esta presentación.");
  error.statusCode = 409;
  error.code = "DECK_IN_USE";
  error.publicMessage = error.message;
  throw error;
}

async function markDeckAssociationsReviewed(deckId) {
  const { deckDir } = resolveDataDeckDirForDelete(deckId);
  const manifestPath = path.join(deckDir, "manifest.json");
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  if (!manifest.replacement) return manifestSummary(manifest);
  manifest.replacement = {
    ...manifest.replacement,
    associationsReviewRequired: false,
    reviewedAt: new Date().toISOString()
  };
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestSummary(manifest);
}

async function renameDeck(deckId, requestedTitle) {
  const title = String(requestedTitle || "").trim();
  if (!title || title.length > 120) {
    const error = new Error("Invalid presentation name");
    error.statusCode = 400;
    throw error;
  }
  const { deckDir } = resolveDataDeckDirForDelete(deckId);
  const manifestPath = path.join(deckDir, "manifest.json");
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  manifest.title = title;
  manifest.updatedAt = new Date().toISOString();
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestSummary(manifest);
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

async function listDecks(allowedDeckIds = null) {
  await ensureDataDirs();
  const seen = new Set();
  const usedSessionIds = new Set();
  const decks = [
    ...(await readDecksFrom(STATIC_DECKS_DIR, seen, usedSessionIds, false)),
    ...(await readDecksFrom(DATA_DECKS_DIR, seen, usedSessionIds, true))
  ];
  const allowed = allowedDeckIds ? new Set(allowedDeckIds.map(String)) : null;
  return decks
    .filter((deck) => !allowed || allowed.has(String(deck.deckId)))
    .sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0) || a.title.localeCompare(b.title));
}

async function sourceSizeForDeck(deckId) {
  try {
    const deckDir = await findDeckDir(deckId);
    const manifest = JSON.parse(await fs.promises.readFile(path.join(deckDir, "manifest.json"), "utf8"));
    const sourceFilename = String(manifest.source?.filename || "").trim();
    if (!sourceFilename || path.basename(sourceFilename) !== sourceFilename) return 0;
    const stats = await fs.promises.stat(path.join(deckDir, sourceFilename));
    return stats.isFile() ? Number(stats.size || 0) : 0;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    console.warn("Unable to measure original Deck file", deckId, error.message);
    return null;
  }
}

async function synchronizeWorkspaceSourceSizes(req) {
  const deckIds = await betterAuthCompatibilityBridge.listUnmeteredDeckIds(req);
  await Promise.all(deckIds.map(async (deckId) => {
    const sourceSizeBytes = await sourceSizeForDeck(deckId);
    if (sourceSizeBytes === null) return;
    await betterAuthCompatibilityBridge.setDeckSourceSize(req, deckId, sourceSizeBytes);
  }));
}

async function reserveUploadedDeck(req, deck) {
  await synchronizeWorkspaceSourceSizes(req);
  return betterAuthCompatibilityBridge.reserveDeck(req, deck);
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
    transmissionPausedBy: null,
    presenterConnected: false,
    screenConnected: false,
    stageConnected: false,
    automaticLifecycleStarted: false,
    audience: new Map(),
    overlays: {
      reactionsOnScreen: true,
      showReactions: true,
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

function getConnectedAudience(roomKey) {
  const session = getSessionByRoomKey(roomKey);
  if (!session) return [];
  return Array.from(session.audience.entries()).map(([audienceId, audience]) => ({
    audienceId,
    joinedAt: audience.joinedAt,
    name: audience.name || "",
    label: audience.label || audience.name || ""
  }));
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
    transmissionPausedBy: session.transmissionPausedBy,
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
  if (session.overlays.showReactions ?? session.overlays.reactionsOnScreen) {
    io.to(roomKey).emit("reaction", { emoji, target: "screen", at: Date.now() });
  }
}

function normalizeOverlayPatch(overlays = {}) {
  const patch = { ...overlays };
  const reactionState = patch.showReactions ?? patch.reactionsOnScreen;
  if (typeof reactionState !== "undefined") {
    const enabled = Boolean(reactionState);
    patch.showReactions = enabled;
    patch.reactionsOnScreen = enabled;
  }
  return patch;
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
app.all("/api/auth/*", betterAuthCompatibilityBridge.handler);
app.get("/api/auth-spike/session", betterAuthCompatibilityBridge.sessionHandler);
app.use(express.json({ limit: "2mb" }));
app.get("/decks/:deckId/manifest.json", async (req, res, next) => {
  if (!isDemoDeckId(req.params.deckId)) return next();
  try {
    res.set("Cache-Control", "no-store");
    return res.json(demoManifest(await readDemoMasterManifest(), {
      deckId: req.params.deckId,
      sessionId: ""
    }));
  } catch (error) {
    console.error("Unable to load the IMMERSA Demo manifest", error);
    return res.status(500).json({ error: "Unable to load the IMMERSA Demo" });
  }
});
app.get("/decks/:deckId/interactions.json", async (req, res, next) => {
  if (!isDemoDeckId(req.params.deckId)) return next();
  try {
    const access = await betterAuthCompatibilityBridge.getDeckFeatureAccess(req.params.deckId);
    if (access.plan !== DEMO_PLAN) return res.status(404).json({ error: "Deck Demo not found" });
    const practiceDir = await ensureDemoPracticeDir(req.params.deckId);
    res.set("Cache-Control", "no-store");
    return res.sendFile(path.join(practiceDir, "interactions.json"));
  } catch (error) {
    console.error("Unable to load the IMMERSA Demo configuration", error);
    return res.status(500).json({ error: "Unable to load the IMMERSA Demo" });
  }
});
app.use("/decks", express.static(DATA_DECKS_DIR));
app.use("/profile-images", express.static(DATA_PROFILES_DIR, { immutable: true, maxAge: "1y" }));
app.get("/auth", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "auth", "index.html")));
app.get("/api/account/capabilities", betterAuthCompatibilityBridge.capabilitiesHandler);
app.get("/", betterAuthCompatibilityBridge.requirePageAuth(), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));
app.get("/home", betterAuthCompatibilityBridge.requirePageAuth(), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));

const requireAccount = betterAuthCompatibilityBridge.requireApiAuth();
const requireOwnedDeck = betterAuthCompatibilityBridge.requireDeckOwnership();
const requireDeckAccount = [requireAccount, requireOwnedDeck];
const requireControllerDeck = accessLinkHandlers.guardDeckRoles(["speaker", "stage"]);
function requireDeckFeature(feature) {
  return async (req, res, next) => {
    try {
      const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
      const access = await betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId);
      if (!canUseFeature(access, feature)) {
        return res.status(403).json({ error: "Disponible en planes de pago", code: "PLAN_FEATURE_LOCKED", feature });
      }
      req.immersaFeatureAccess = access;
      return next();
    } catch (error) {
      console.error("Unable to validate plan feature", error);
      return res.status(503).json({ error: "No se pudo validar el plan" });
    }
  };
}
function requireMutableDeck(req, res, next) {
  const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
  if (!isDemoDeckId(deckId)) return next();
  return res.status(403).json({
    error: "El Deck Demo es un recurso oficial y no puede modificarse.",
    code: "DEMO_READ_ONLY"
  });
}
function requireDeckConfigurationWrite(req, res, next) {
  return (async () => {
    try {
      const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
      const access = await betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId);
      if (access.plan === DEMO_PLAN || isDemoDeckId(deckId)) {
        const master = JSON.parse(await fs.promises.readFile(
          path.join(STATIC_DECKS_DIR, DEMO_MASTER_DECK_ID, "interactions.json"),
          "utf8"
        ));
        const current = await deckInteractionHandlers.readDeckConfig(deckId);
        assertDemoConfigurationStructure({ ...current, ...req.body }, master);
        req.immersaFeatureAccess = access;
        return next();
      }
      if (canUseFeature(access, "interactions")) return next();
      const current = await deckInteractionHandlers.readDeckConfig(deckId);
      if (changesPaidDeckContent(req.body, current)) {
        return res.status(403).json({
          error: "Interacciones está disponible en planes de pago",
          code: "PLAN_FEATURE_LOCKED",
          feature: "interactions"
        });
      }
      req.immersaFeatureAccess = access;
      return next();
    } catch (error) {
      console.error("Unable to validate Deck configuration access", error);
      return res.status(503).json({ error: "No se pudo validar el plan" });
    }
  })();
}

async function trackDemoConfigurationActivity(req, _res, next) {
  const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
  if (!isDemoDeckId(deckId)) return next();
  try {
    const binding = req.accountContext
      ? await betterAuthCompatibilityBridge.getDemoDeck(req)
      : null;
    const sessionId = binding?.deckId === deckId
      ? binding.sessionId
      : req.immersaAccess?.accessLink?.session_id;
    if (sessionId) {
      scheduleInactiveDemoRestore({
        roomKey: getRoomKey(sessionId, deckId),
        sessionId,
        deckId
      });
    }
  } catch (error) {
    console.error("Unable to track Demo configuration activity", error);
  }
  return next();
}
function requireAccountOrControllerDeck(req, res, next) {
  return betterAuthCompatibilityBridge.attachOptionalAccount(req, res, () => {
    if (req.accountContext) return requireOwnedDeck(req, res, next);
    return requireControllerDeck(req, res, next);
  });
}
app.get("/api/decks", requireAccount, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const [decks, binding] = await Promise.all([
      listDecks(await betterAuthCompatibilityBridge.listDeckIds(req)),
      betterAuthCompatibilityBridge.getDemoDeck(req)
    ]);
    res.json([await demoSummaryForBinding(binding), ...decks]);
  } catch (error) {
    console.error("Unable to list decks", error);
    res.status(500).json({ error: "Unable to list decks" });
  }
});
app.post("/api/account/demo/reset", requireAccount, async (req, res) => {
  try {
    const result = await betterAuthCompatibilityBridge.resetDemoDeck(req);
    cancelDisconnectedDemoRestore(result.previous.deckId);
    cancelInactiveDemoRestore(result.previous.deckId);
    await removeDemoPracticeDir(result.previous.deckId);
    await accessLinkHandlers.deactivateSessionLinks(result.previous.sessionId);
    const roomKey = getRoomKey(result.previous.sessionId, result.previous.deckId);
    sessions.delete(roomKey);
    const resetContext = { roomKey, sessionId: result.previous.sessionId, deckId: result.previous.deckId };
    interactionSockets.resetSession(resetContext);
    raffleSockets.resetSession(resetContext);
    gameQueueSockets.resetSession(resetContext);
    res.json({ deck: await demoSummaryForBinding(result.current) });
  } catch (error) {
    console.error("Unable to reset the IMMERSA Demo", error);
    res.status(500).json({ error: "No se pudo restablecer el Deck Demo" });
  }
});
app.get("/api/account/plan", requireAccount, async (req, res) => {
  try {
    await synchronizeWorkspaceSourceSizes(req);
    res.json(await betterAuthCompatibilityBridge.getPlanUsage(req));
  } catch (error) {
    console.error("Unable to load account plan", error);
    res.status(500).json({ error: "Unable to load account plan" });
  }
});
app.get("/api/account/profile", requireAccount, profileHandlers.getProfile);
app.put("/api/account/profile", requireAccount, profileHandlers.saveProfile);
app.post("/api/account/profile/photo", requireAccount, profileHandlers.uploadPhoto);
app.delete("/api/account/profile/photo", requireAccount, profileHandlers.deletePhoto);
app.get("/api/decks/:deckId/speaker-profile", profileHandlers.getDeckSpeakerProfile);
app.get("/api/decks/:deckId/interactions", deckInteractionHandlers.getInteractions);
app.put("/api/decks/:deckId/interactions", requireAccountOrControllerDeck, requireDeckConfigurationWrite, trackDemoConfigurationActivity, deckInteractionHandlers.putInteractions);
app.post("/api/decks/:deckId/knowledge-questions/:questionId/image", ...requireDeckAccount, requireDeckFeature("interactions"), deckInteractionHandlers.uploadQuestionImage);
app.get("/api/decks/:deckId/brand-mentions", ...requireDeckAccount, brandMentionHandlers.getConfig);
app.post("/api/decks/:deckId/brand-mentions", ...requireDeckAccount, requireMutableDeck, brandMentionHandlers.createBrand);
app.put("/api/decks/:deckId/brand-mentions/order", ...requireDeckAccount, requireMutableDeck, brandMentionHandlers.reorderBrands);
app.put("/api/decks/:deckId/brand-mentions/:brandId", ...requireDeckAccount, requireMutableDeck, brandMentionHandlers.updateBrand);
app.delete("/api/decks/:deckId/brand-mentions/:brandId", ...requireDeckAccount, requireMutableDeck, brandMentionHandlers.deleteBrand);
app.get("/api/decks/:deckId/qna/history", ...requireDeckAccount, requireDeckFeature("metrics"), qnaHistoryHandlers.listHistory);
app.get("/api/decks/:deckId/knowledge-activities/history", ...requireDeckAccount, requireDeckFeature("metrics"), knowledgeActivityHistoryHandlers.listHistory);
app.post(
  "/api/decks/:deckId/replace",
  ...requireDeckAccount,
  requireMutableDeck,
  createDeckReplacementHandler({
    beforeDeckSwap: ({ deck }) => assertDeckCanBeReplaced(deck.deckId),
    onDeckReplaced: async ({ req, deck }) => {
      const result = await betterAuthCompatibilityBridge.replaceDeckSource(req, deck);
      delete deckSlideCounts[deck.deckId];
      return result;
    }
  })
);
app.post("/api/decks/:deckId/replacement-review", ...requireDeckAccount, requireMutableDeck, async (req, res) => {
  try {
    res.json(await markDeckAssociationsReviewed(req.params.deckId));
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    if (statusCode >= 500) console.error("Unable to mark replacement associations reviewed", error);
    res.status(statusCode).json({ error: statusCode === 404 ? "Deck not found" : "Unable to update presentation review" });
  }
});
app.put("/api/decks/:deckId/title", ...requireDeckAccount, requireMutableDeck, async (req, res) => {
  try {
    res.json(await renameDeck(req.params.deckId, req.body?.title));
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    if (statusCode >= 500) console.error("Unable to rename deck", error);
    res.status(statusCode).json({ error: statusCode === 400 ? "Escribe un nombre de hasta 120 caracteres" : statusCode === 404 ? "Deck not found" : "Unable to rename presentation" });
  }
});
app.delete("/api/decks/:deckId", ...requireDeckAccount, requireMutableDeck, async (req, res) => {
  try {
    const deckId = await deleteDataDeck(req.params.deckId);
    await betterAuthCompatibilityBridge.unregisterDeck(req, deckId);
    res.json({ ok: true, deckId });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error("Unable to delete deck", error);
    res.status(statusCode).json({ error: statusCode === 404 ? "Deck not found" : statusCode === 400 ? "Invalid deck id" : "Unable to delete deck" });
  }
});
app.post("/api/access-links", requireAccount, betterAuthCompatibilityBridge.requireOwnedSession, accessLinkHandlers.createAccessLink);
app.get("/api/access-links/:access_token", accessLinkHandlers.resolveAccessLink);
app.get("/api/open/:access_token", accessLinkHandlers.openPresentation);
app.get("/api/qna/export/:access_token", accessLinkHandlers.guardAccessRoles(["speaker"]), requireDeckFeature("metrics"), qnaHistoryHandlers.exportDeck);
app.get(
  "/api/knowledge-activities/:executionId/export/:access_token",
  accessLinkHandlers.guardAccessRoles(["speaker"]),
  requireDeckFeature("metrics"),
  knowledgeActivityHistoryHandlers.exportExecution
);
app.delete("/api/qna/history/:access_token", accessLinkHandlers.guardAccessRoles(["speaker"]), requireDeckFeature("metrics"), qnaHistoryHandlers.clearHistory);
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
app.post("/api/upload-pptx", requireAccount, createUploadHandler({
  onDeckCreateStart: ({ req, deck }) => reserveUploadedDeck(req, deck),
  onDeckCreateFailed: ({ req, deck }) => betterAuthCompatibilityBridge.unregisterDeck(req, deck.deckId)
}));
app.get("/presenter", accessLinkHandlers.guardLegacyRoute("speaker", "presenter"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "presenter", "index.html")));
app.get("/screen", accessLinkHandlers.guardLegacyRoute("screen", "screen"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/viewer", accessLinkHandlers.guardLegacyRoute("viewer", "viewer"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "screen", "index.html")));
app.get("/stage", accessLinkHandlers.guardLegacyRoute("stage", "stage"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "stage", "index.html")));
app.get("/audience", accessLinkHandlers.guardLegacyRoute("audience", "audience"), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "audience", "index.html")));
app.get("/assets/games/breakout/intro.mp4", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("video/mp4");
  res.sendFile(path.join(PUBLIC_DIR, "assets", "games", "breakout", "intro.mp4"));
});
app.get("/:public_id", accessLinkHandlers.openPublicAudience);
app.use(express.static(PUBLIC_DIR));

io.use(betterAuthCompatibilityBridge.socketMiddleware);
io.on("connection", (socket) => {
  let currentRoomKey = null;
  let currentRole = null;
  let currentSessionId = null;
  let currentDeckId = null;
  let currentAudienceId = null;
  let currentFeatureAccess = { plan: "FREE", features: { interactions: false, metrics: false } };

  socket.use(([eventName], next) => {
    if (!controllerRoles.has(currentRole)) return next();
    const feature = isPaidControllerEvent(eventName)
      ? "interactions"
      : (isPaidMetricsEvent(eventName) ? "metrics" : "");
    if (!feature || canUseFeature(currentFeatureAccess, feature)) return next();
    socket.emit("plan:feature_locked", {
      feature,
      plan: currentFeatureAccess.plan,
      message: feature === "metrics"
        ? "Métricas está disponible en planes de pago"
        : "Interacciones está disponible en planes de pago"
    });
  });

  interactionSockets.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));
  gameQueueSockets.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));
  raffleSockets.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));
  qnaRuntime.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));
  knowledgeActivityRuntime.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));
  presentationLifecycleRuntime.attach(socket, () => ({
    roomKey: currentRoomKey,
    role: currentRole,
    sessionId: currentSessionId,
    deckId: currentDeckId,
    audienceId: currentAudienceId
  }));

  socket.on("join_presentation", async ({ session: sessionId, deck: deckId, role, audienceId, audienceName, label }) => {
    if (!role) return;
    const joinedSessionId = normalizeSessionId(sessionId);
    const joinedDeckId = normalizeDeckId(deckId);
    currentRoomKey = getRoomKey(joinedSessionId, joinedDeckId);
    currentRole = role;
    currentSessionId = joinedSessionId;
    currentDeckId = joinedDeckId;
    cancelDisconnectedDemoRestore(joinedDeckId);
    scheduleInactiveDemoRestore({ roomKey: currentRoomKey, sessionId: joinedSessionId, deckId: joinedDeckId });
    const session = getSession(joinedSessionId, joinedDeckId);
    try {
      currentFeatureAccess = await betterAuthCompatibilityBridge.getDeckFeatureAccess(joinedDeckId);
    } catch (error) {
      currentFeatureAccess = { plan: "FREE", features: { interactions: false, metrics: false } };
      console.error("Unable to resolve live plan features", error);
    }
    socket.emit("plan:features", currentFeatureAccess);
    const slideCount = await refreshSessionDeck(session, joinedDeckId);
    if (role === "presenter") console.log("[session]", joinedSessionId, "deck", session.deckId, "room", currentRoomKey, "slideCount", slideCount);
    socket.join(currentRoomKey);
    socket.join(getRoleRoomKey(currentRoomKey, role));
    if (!liveSocketsByRoom.has(currentRoomKey)) liveSocketsByRoom.set(currentRoomKey, new Set());
    liveSocketsByRoom.get(currentRoomKey).add(socket.id);

    if (role === "presenter") {
      session.presenterConnected = true;
      io.to(currentRoomKey).emit("presenter_connected");
    }
    if (role === "screen") session.screenConnected = true;
    if (role === "stage") session.stageConnected = true;
    if (role === "audience") {
      currentAudienceId = registerAudience(session, {
        audienceId: audienceId || socket.id,
        socketId: socket.id,
        audienceName,
        label
      });
      socket.join(getRoleRoomKey(currentRoomKey, "audience:" + currentAudienceId));
    }
    const joinedContext = {
      roomKey: currentRoomKey,
      role: currentRole,
      sessionId: currentSessionId,
      deckId: currentDeckId,
      audienceId: currentAudienceId
    };
    emitState(currentRoomKey, session);
    if (
      role === "audience"
      && canUseFeature(currentFeatureAccess, "metrics")
      && session.audience.size >= AUTO_START_AUDIENCE_THRESHOLD
      && !session.automaticLifecycleStarted
    ) {
      session.automaticLifecycleStarted = true;
      void presentationLifecycleRuntime.startAutomatically(joinedContext)
        .then((state) => {
          if (state?.mode !== "live") session.automaticLifecycleStarted = false;
        });
    }

    const snapshotJobs = [
      ["game queue", () => gameQueueSockets.sendCurrentState(socket, joinedContext)],
      ["poll", () => interactionSockets.sendCurrentState(socket, joinedContext)],
      ["raffle", () => raffleSockets.sendCurrentState(socket, joinedContext)],
      ["Q&A", () => qnaRuntime.sendCurrentState(socket, joinedContext)],
      ["knowledge activity", () => knowledgeActivityRuntime.sendCurrentState(socket, joinedContext)],
      ["presentation lifecycle", () => presentationLifecycleRuntime.sendCurrentState(socket, joinedContext)]
    ];
    void Promise.allSettled(snapshotJobs.map(([, send]) => Promise.resolve().then(send)))
      .then((results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error("[join] Unable to synchronize " + snapshotJobs[index][0], result.reason);
          }
        });
      });

    if (role === "audience") {
      void Promise.resolve(brandMentionRuntime.start(joinedContext))
        .then(() => brandMentionRuntime.sendCurrentState(socket, joinedContext))
        .catch((error) => console.error("[join] Unable to start brand mentions", error));
    }
  });

  socket.on("transmission_pause", () => {
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    if (!session.transmissionPaused) {
      session.transmissionPaused = true;
      session.transmissionPausedBy = currentRole;
    }
    emitState(currentRoomKey, session);
  });

  socket.on("transmission_play", () => {
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.transmissionPaused = false;
    session.transmissionPausedBy = null;
    session.liveSlideIndex = session.presenterSlideIndex;
    session.slideIndex = session.presenterSlideIndex;
    emitState(currentRoomKey, session);
  });

  socket.on("slide_next", async () => {
    if (!currentRoomKey) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session || !canStepPresentation(currentRole, session)) return;
    await setPresenterSlide(currentRoomKey, session, session.presenterSlideIndex + 1);
    emitState(currentRoomKey, session);
  });

  socket.on("slide_prev", async () => {
    if (!currentRoomKey) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session || !canStepPresentation(currentRole, session)) return;
    await setPresenterSlide(currentRoomKey, session, session.presenterSlideIndex - 1);
    emitState(currentRoomKey, session);
  });

  socket.on("slide_go", async ({ slideIndex }) => {
    if (!currentRoomKey) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session || !canNavigatePresentation(currentRole, session)) return;
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
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    const normalizedStroke = normalizeDrawingStroke(session, stroke);
    if (!normalizedStroke) return;
    socket.to(currentRoomKey).emit("drawing_stroke", normalizedStroke);
  });

  socket.on("overlay_update", ({ overlays }) => {
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    const patch = normalizeOverlayPatch(overlays);
    session.overlays = { ...session.overlays, ...patch };
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("clear_message", () => {
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.overlays = { ...session.overlays, messageVisible: false, messageText: "" };
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("clear_screen", () => {
    if (!currentRoomKey || !canControlPresentation(currentRole)) return;
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    session.overlays = { ...session.overlays, qrVisible: false, messageVisible: false, messageText: "", selectedQuestion: null, questionVisible: false };
    io.to(currentRoomKey).emit("clear_overlays");
    io.to(currentRoomKey).emit("overlay_update", session.overlays);
    emitState(currentRoomKey, session);
  });

  socket.on("disconnect", () => {
    if (!currentRoomKey) return;
    const roomSockets = liveSocketsByRoom.get(currentRoomKey);
    roomSockets?.delete(socket.id);
    if (roomSockets && roomSockets.size === 0) liveSocketsByRoom.delete(currentRoomKey);
    const session = getSessionByRoomKey(currentRoomKey);
    if (!session) return;
    if (currentRole === "presenter") {
      session.presenterConnected = false;
      socket.to(currentRoomKey).emit("presenter_disconnected");
    }
    if (currentRole === "screen") session.screenConnected = false;
    if (currentRole === "stage") session.stageConnected = false;
    if (currentRole === "audience" && currentAudienceId) {
      unregisterAudience(session, currentAudienceId, socket.id);
      if (session.audience.size === 0) brandMentionRuntime.stop(currentRoomKey);
    }
    emitState(currentRoomKey, session);
    scheduleDisconnectedDemoRestore({
      roomKey: currentRoomKey,
      sessionId: currentSessionId,
      deckId: currentDeckId
    });
  });

  socket.onAny((eventName) => {
    if (
      !currentRoomKey
      || !isDemoDeckId(currentDeckId)
      || eventName === "join_presentation"
      || DEMO_PASSIVE_SOCKET_EVENTS.has(eventName)
    ) return;
    scheduleInactiveDemoRestore({
      roomKey: currentRoomKey,
      sessionId: currentSessionId,
      deckId: currentDeckId
    });
  });
});

server.listen(PORT, () => {
  console.log("Immersa Presentations running at http://localhost:" + PORT);
  console.log("Q&A runtime enabled:", qnaRuntime.enabled);
  console.log("Contest and assessment runtime enabled:", knowledgeActivityRuntime.enabled);
  logConversionHealth();
});

knowledgeActivityRuntime.start().catch((error) => {
  console.error("Unable to start contest and assessment runtime", error);
});
