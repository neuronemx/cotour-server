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
const { canRegisterAudience, registerAudience, unregisterAudience } = require("./audience-registry");
const { getPlanLimits } = require("./auth/plan-limits");
const {
  resolveSessionInactivityMs,
  isMeaningfulSessionEvent,
  isSessionInactive
} = require("./session-inactivity");
const { createDeckInteractionHandlers } = require("./deck-interactions-api");
const { createQnaRuntime } = require("./qna-runtime");
const { createQnaHistoryHandlers } = require("./qna-export");
const { createKnowledgeActivityRuntime } = require("./knowledge-activity-runtime");
const { EventHubAdminInteractions } = require("./event-hub/admin-interactions");
const { createKnowledgeActivityHistoryHandlers } = require("./knowledge-activity-export");
const {
  PresentationLifecycleRepository,
  createPresentationLifecycleRuntime
} = require("./presentation-lifecycle");
const { PresentationMetricsRepository, createPresentationMetricsHandlers } = require("./presentation-metrics");
const { createBrandMentionHandlers } = require("./brand-mentions-api");
const { BrandMentionRuntime } = require("./brand-mention-runtime");
const { createBetterAuthCompatibilityBridge } = require("./auth/better-auth-bridge");
const { createProfileHandlers } = require("./profile-api");
const { createResendEmailSender } = require("./auth/resend-email");
const { createBillingRuntime } = require("./billing/runtime");
const { EventHubRepository, EventHubError } = require("./event-hub/repository");
const { EventHubLoadTestFootprint } = require("./event-hub/load-test-footprint");
const { EventBrandMentionStore } = require("./event-hub/brand-mentions");
const { readEventHubForLocalExport } = require("./local-event-package-export");
const { exportPackage } = require("./local-event-package-storage");
const { createArchive } = require("./local-event-package-archive");
const {
  CAPABILITIES,
  featureAccessForPlan,
  canUseFeature,
  requiredCapabilityForControllerEvent,
  changedDeckCapabilities
} = require("./auth/plan-features");
const {
  DEMO_MASTER_DECK_ID,
  DEMO_PUBLISHED_DECK_ID,
  isImmersaAdmin,
  demoSessionIdForAccount,
  createDemoSessionVisibilityStore,
  isSystemDemoDeckId,
  systemDemoRole,
  readSystemDemoManifest,
  seedSystemDemoDeck,
  decorateMasterManifest,
  updateMasterSlidePlan,
  publishMasterDeck
} = require("./system-demo-deck");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const AUTO_START_AUDIENCE_THRESHOLD = 5;
const SESSION_INACTIVITY_MS = resolveSessionInactivityMs();
const SESSION_INACTIVITY_SWEEP_MS = Math.min(60_000, Math.max(5_000, Math.round(SESSION_INACTIVITY_MS / 12)));
const PUBLIC_DIR = path.join(__dirname, "public");
const STATIC_DECKS_DIR = path.join(PUBLIC_DIR, "decks");
const DATA_DIR = process.env.IMMERSA_DATA_DIR
  ? path.resolve(process.env.IMMERSA_DATA_DIR)
  : path.join(__dirname, "data");
const DATA_DECKS_DIR = path.join(DATA_DIR, "decks");
const DATA_TMP_DIR = path.join(DATA_DIR, "tmp");
const DATA_PROFILES_DIR = path.join(DATA_DIR, "profiles");
const DATA_EVENT_HUBS_DIR = path.join(DATA_DIR, "event-hubs");
const sessions = new Map();
const sessionShutdowns = new Map();
const demoSessionVisibilityStore = createDemoSessionVisibilityStore();
const deckSlideCounts = { demo: 3 };
const allowedReactions = new Set(["❤️", "👏", "🔥"]);
const controllerRoles = new Set(["presenter", "stage"]);
const interactionStore = new InteractionStore();
const raffleStore = new RaffleStore();
const activeInteractionCoordinator = new ActiveInteractionCoordinator({ interactionStore, raffleStore });
const gameQueueStore = new GameQueueStore();
const betterAuthCompatibilityBridge = createBetterAuthCompatibilityBridge();
let presentationMetricsRepository = null;
let eventHubRepository = null;
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
  onGameFinished: gameQueueSockets.handleGameFinished,
  onPollChanged: (context, snapshot, closedAt, presentationSessionId = null) => (
    presentationSessionId
      ? presentationMetricsRepository?.recordPollSnapshot({ presentationSessionId, snapshot, closedAt })
      : presentationMetricsRepository?.recordPollForContext(context, snapshot, closedAt)
  )
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
  staticDecksDir: STATIC_DECKS_DIR
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
async function workspaceHasActivePresentation(workspaceId) {
  const deckIds = new Set(await betterAuthCompatibilityBridge.listWorkspaceDeckIds(workspaceId));
  return Array.from(sessions.values()).some((session) => (
    deckIds.has(String(session.deckId))
    && !session.inactivityShutdownAt
    && (session.presenterConnected || session.stageConnected || session.screenConnected || session.audience.size > 0)
  ));
}
const billingRuntime = createBillingRuntime({
  pool: lifecyclePool,
  env: process.env,
  isAdmin: isImmersaAdmin,
  isWorkspaceActive: workspaceHasActivePresentation,
  emailSender: createResendEmailSender({ env: process.env })
});
const eventHubEmailSender = createResendEmailSender({ env: process.env });
eventHubRepository = lifecyclePool ? new EventHubRepository(lifecyclePool) : null;
const eventHubLoadTestFootprint = lifecyclePool ? new EventHubLoadTestFootprint(lifecyclePool) : null;
const eventHubAdminInteractions = eventHubRepository ? new EventHubAdminInteractions({ io, repository: eventHubRepository }) : null;
const billingHandlers = billingRuntime.handlers;
presentationMetricsRepository = lifecyclePool ? new PresentationMetricsRepository(lifecyclePool) : null;
const presentationMetricsHandlers = presentationMetricsRepository
  ? createPresentationMetricsHandlers(presentationMetricsRepository)
  : null;
async function presentationCompletionFor(context, state, reason = "FINISHED") {
  const completedId = String(state?.completedPresentationSessionId || "");
  const sessions = completedId && presentationMetricsRepository
    ? await presentationMetricsRepository.listDeckSessions(context.deckId)
    : [];
  const session = sessions.find((item) => item.id === completedId) || null;
  const pollResponses = (session?.polls || []).reduce((total, poll) => total + Number(poll.totalResponses || 0), 0);
  const qnaReceived = Number(session?.qna?.received || 0);
  return {
    reason,
    presentationSessionId: completedId || null,
    deckId: context.deckId,
    summary: {
      durationSeconds: Number(session?.durationSeconds || 0),
      attendance: Math.max(Number(session?.participants?.connected || 0), Number(session?.participants?.peak || 0)),
      activityCount: pollResponses + qnaReceived,
      pollCount: Number(session?.polls?.length || 0),
      pollResponses,
      qnaReceived,
      qnaProjected: Number(session?.qna?.projected || 0)
    }
  };
}
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
        const liveSession = getSessionByRoomKey(context.roomKey);
        await presentationMetricsRepository?.recordAudienceSnapshot({
          presentationSessionId: state.presentationSessionId,
          audience: getConnectedAudience(context.roomKey),
          connectedCount: liveSession?.audience?.size || 0
        });
        await interactionSockets.persistMetricsForPresentation?.(context, state.presentationSessionId);
      },
      beforeFinish: async (context) => {
        if (activeInteractionCoordinator.hasAnyActive(context.sessionId)) {
          return {
            ok: false,
            reason: "ACTIVE_INTERACTION",
            message: "Cierra la interacción activa antes de finalizar"
          };
        }
        const presentationSessionId = await presentationMetricsRepository?.activeLiveSession(context);
        if (presentationSessionId) {
          await interactionSockets.persistMetricsForPresentation?.(context, presentationSessionId);
        }
        return { ok: true };
      },
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
        await billingRuntime.service.recalculateWorkspaceForDeck(context.deckId, { force: true })
          .catch((error) => console.error("[billing] Unable to apply deferred entitlement", error));
        return presentationCompletionFor(context, state, context.finishReason || "FINISHED");
      }
    })
  : {
      attach() {},
      async startAutomatically() {},
      async finishInactive() { return null; },
      emitClosed() {},
      async sendCurrentState(socket) {
        socket.emit("presentation:lifecycle:state", { available: false, mode: "test" });
      }
    };
async function getStageFeatureAccess(deckId) {
  const access = isSystemDemoDeckId(deckId)
    ? featureAccessForPlan("SPEAKER_PRO")
    : await betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId);
  const stageControl = await eventHubRepository?.getStageControlForDeck(deckId);
  if (!stageControl) return access;
  return {
    ...access,
    capabilities: { ...access.capabilities, [CAPABILITIES.ACCESS_BACKSTAGE]: true },
    eventHubStage: stageControl
  };
}

const accessLinkHandlers = createAccessLinkHandlers({
  dataDir: DATA_DIR,
  staticDecksDir: STATIC_DECKS_DIR,
  dataDecksDir: DATA_DECKS_DIR,
  publicDir: PUBLIC_DIR,
  startScreenExecution: qnaRuntime.startScreenExecution,
  resolveDeckFeatureAccess: getStageFeatureAccess
});
const qnaHistoryHandlers = createQnaHistoryHandlers({ runtime: qnaRuntime });
const knowledgeActivityHistoryHandlers = createKnowledgeActivityHistoryHandlers({
  runtime: knowledgeActivityRuntime
});
const brandMentionHandlers = createBrandMentionHandlers({
  dataDecksDir: DATA_DECKS_DIR,
  staticDecksDir: STATIC_DECKS_DIR
});
const eventBrandMentionStore = new EventBrandMentionStore({ dataEventHubsDir: DATA_EVENT_HUBS_DIR });
const eventBrandMentionHandlers = createBrandMentionHandlers({
  dataDecksDir: DATA_EVENT_HUBS_DIR,
  staticDecksDir: DATA_EVENT_HUBS_DIR,
  store: eventBrandMentionStore
});
const brandMentionRuntime = new BrandMentionRuntime({
  io,
  store: {
    read: (sourceId) => {
      const source = String(sourceId || "");
      return source.startsWith("event:")
        ? eventBrandMentionStore.read(source.slice("event:".length))
        : brandMentionHandlers.store.read(source);
    }
  },
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
  await seedSystemDemoDeck(DATA_DECKS_DIR);
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
  const candidates = [
    path.join(DATA_DECKS_DIR, deckId, "interactions.json"),
    path.join(STATIC_DECKS_DIR, deckId, "interactions.json")
  ];

  let deckInteractions = [];
  for (const interactionPath of candidates) {
    try {
      const interactions = await readInteractionsFile(interactionPath);
      if (interactions.length) {
        deckInteractions = interactions;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Unable to load deck interactions", deckId, error.message);
    }
  }
  return deckInteractions;
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
    slideTransition: normalizeSlideTransition(manifest.slideTransition),
    systemDemo: Boolean(manifest.systemDemo),
    demoRole: manifest.systemDemo?.role || systemDemoRole(manifest.deckId),
    immutable: manifest.systemDemo?.role === "published",
    publishedAt: manifest.systemDemo?.publishedAt || "",
    ...manifestTimestamps(manifest, manifestStats)
  };
}

const SLIDE_TRANSITIONS = new Set(["none", "dissolve", "wipe", "flash"]);

function normalizeSlideTransition(value) {
  const transition = String(value || "").trim().toLowerCase();
  if (transition === "swipe") return "wipe";
  return SLIDE_TRANSITIONS.has(transition) ? transition : "flash";
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

function assertDeckCanBeReplaced(deckId) {
  if (!deckHasActiveConnections(deckId)) return;
  const error = new Error("Cierra Speaker, Backstage, Pantalla y Público antes de sustituir esta presentación.");
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

async function updateDeckSlideTransition(deckId, requestedTransition) {
  const requested = String(requestedTransition || "").trim().toLowerCase();
  const transition = normalizeSlideTransition(requested);
  if (!SLIDE_TRANSITIONS.has(requested) && requested !== "swipe") {
    const error = new Error("Invalid slide transition");
    error.statusCode = 400;
    throw error;
  }
  const { deckDir } = resolveDataDeckDirForDelete(deckId);
  const manifestPath = path.join(deckDir, "manifest.json");
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  manifest.slideTransition = transition;
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

async function directorySizeBytes(directory) {
  let total = 0;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySizeBytes(target);
    else if (entry.isFile()) total += Number((await fs.promises.stat(target)).size || 0);
  }
  return total;
}

async function meteredStorageForDeck(deckId) {
  try {
    const deckDir = await findDeckDir(deckId);
    const manifestPath = path.join(deckDir, "manifest.json");
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    const sourceFilename = String(manifest.source?.filename || "").trim();
    const conversionCompleted = manifest.conversion?.status === "completed";
    if (conversionCompleted && /^original\.(pdf|pptx)$/i.test(sourceFilename)) {
      await fs.promises.rm(path.join(deckDir, sourceFilename), { force: true });
      manifest.source = { ...(manifest.source || {}), filename: null };
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    return directorySizeBytes(deckDir);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    console.warn("Unable to measure Deck storage", deckId, error.message);
    return null;
  }
}

async function synchronizeWorkspaceStorageSizes(req) {
  const deckIds = await betterAuthCompatibilityBridge.listDeckIdsForStorageSync(req);
  await Promise.all(deckIds.map(async (deckId) => {
    const sourceSizeBytes = await meteredStorageForDeck(deckId);
    if (sourceSizeBytes === null) return;
    await betterAuthCompatibilityBridge.setDeckSourceSize(req, deckId, sourceSizeBytes);
  }));
}

async function reserveUploadedDeck(req, deck) {
  await synchronizeWorkspaceStorageSizes(req);
  return betterAuthCompatibilityBridge.reserveDeck(req, { ...deck, sourceSizeBytes: 0 });
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
    lastActivityAt: Date.now(),
    inactivityShutdownAt: null,
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

function touchSession(roomKey, now = Date.now()) {
  const session = getSessionByRoomKey(roomKey);
  if (!session) return;
  session.lastActivityAt = now;
  session.inactivityShutdownAt = null;
}

async function shutdownInactiveSession(roomKey, session, now = Date.now()) {
  if (!session || session.inactivityShutdownAt || sessionShutdowns.has(roomKey)) return false;
  const context = {
    roomKey,
    sessionId: session.sessionId,
    deckId: session.deckId,
    role: "system"
  };
  const shutdown = (async () => {
    context.finishReason = "INACTIVITY";
    const lifecycleResult = await presentationLifecycleRuntime.finishInactive(context);
    const asyncResets = await Promise.allSettled([
      knowledgeActivityRuntime.resetSession(context),
      lifecycleResult
        ? Promise.resolve({ presentationSessionId: lifecycleResult.state.presentationSessionId })
        : qnaRuntime.shutdownSession?.({ deckId: session.deckId, sourceSessionId: session.sessionId })
    ]);
    asyncResets.forEach((result) => {
      if (result.status === "rejected") console.error("Unable to fully reset inactive session", result.reason);
    });
    interactionSockets.resetSession(context);
    raffleSockets.resetSession(context);
    gameQueueSockets.resetSession(context);
    brandMentionRuntime.stop(roomKey);

    const qnaReplacement = asyncResets[1]?.status === "fulfilled" ? asyncResets[1].value : null;
    session.slideIndex = 0;
    session.presenterSlideIndex = 0;
    session.liveSlideIndex = 0;
    session.transmissionPaused = false;
    session.transmissionPausedBy = null;
    session.automaticLifecycleStarted = false;
    session.overlays = createSession(session.sessionId, session.deckId, session.slideCount).overlays;
    session.lastActivityAt = now;
    session.inactivityShutdownAt = now;
    io.to(roomKey).emit("presentation:inactive_shutdown", {
      reason: "INACTIVITY",
      inactivityMinutes: Math.round(SESSION_INACTIVITY_MS / 60_000)
    });
    if (!lifecycleResult) {
      presentationLifecycleRuntime.emitClosed(context, await presentationCompletionFor(context, null, "INACTIVITY"));
    }
    if (qnaReplacement?.presentationSessionId) {
      presentationLifecycleRuntime.emitState(context, {
        available: true,
        mode: "test",
        presentationSessionId: qnaReplacement.presentationSessionId,
        startedAt: null
      });
    }
    emitState(roomKey, session);
    console.log("[session] inactive shutdown", roomKey);
    return true;
  })().finally(() => sessionShutdowns.delete(roomKey));
  sessionShutdowns.set(roomKey, shutdown);
  return shutdown;
}

const sessionInactivitySweep = setInterval(() => {
  const now = Date.now();
  for (const [roomKey, session] of sessions) {
    if (!session.inactivityShutdownAt && isSessionInactive(session, now, SESSION_INACTIVITY_MS)) {
      void shutdownInactiveSession(roomKey, session, now);
    }
  }
}, SESSION_INACTIVITY_SWEEP_MS);
sessionInactivitySweep.unref?.();

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
app.post("/api/billing/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), billingHandlers.webhook);
app.all("/api/auth/*", betterAuthCompatibilityBridge.handler);
app.get("/api/auth-spike/session", betterAuthCompatibilityBridge.sessionHandler);
app.use(express.json({ limit: "2mb" }));
app.use("/decks", express.static(DATA_DECKS_DIR));
app.use("/profile-images", express.static(DATA_PROFILES_DIR, { immutable: true, maxAge: "1y" }));
app.get("/auth", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "auth", "index.html")));
app.get("/api/account/capabilities", betterAuthCompatibilityBridge.capabilitiesHandler);
app.get("/", betterAuthCompatibilityBridge.requirePageAuth(), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));
app.get("/home", betterAuthCompatibilityBridge.requirePageAuth(), (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "home", "index.html")));
app.get("/presentacion-completada", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "completion", "speaker.html")));
app.get("/gracias-por-participar", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "completion", "audience.html")));
app.get("/presentacion-finalizada", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "completion", "screen.html")));
app.get("/operacion-finalizada", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "completion", "backstage.html")));

const requireAccount = betterAuthCompatibilityBridge.requireApiAuth();
app.get("/api/billing/catalog", requireAccount, billingHandlers.catalog);
app.get("/api/billing/status", requireAccount, billingHandlers.status);
app.post("/api/billing/checkout", requireAccount, billingHandlers.checkout);
app.post("/api/billing/event-pass", requireAccount, billingHandlers.eventPassCheckout);
app.post("/api/billing/change", requireAccount, billingHandlers.change);
app.post("/api/billing/cancel", requireAccount, billingHandlers.cancel);
app.post("/api/billing/portal", requireAccount, billingHandlers.portal);
app.post("/api/billing/recover", requireAccount, billingHandlers.recoverPayment);
app.get("/api/billing/invoices", requireAccount, billingHandlers.invoices);
app.post("/api/billing/invoice-requests", requireAccount, billingHandlers.requestInvoice);
app.get("/api/admin/billing/invoice-requests", requireAccount, requireImmersaAdmin, billingHandlers.adminInvoiceRequests);
app.put("/api/admin/billing/invoice-requests/:requestId", requireAccount, requireImmersaAdmin, billingHandlers.adminUpdateInvoiceRequest);
app.get("/api/admin/accounts/:workspaceId/billing", requireAccount, requireImmersaAdmin, billingHandlers.adminStatus);
app.post("/api/admin/accounts/:workspaceId/billing/grants", requireAccount, requireImmersaAdmin, billingHandlers.adminGrant);
const requireDatabaseOwnedDeck = betterAuthCompatibilityBridge.requireDeckOwnership();
async function requireAccountAdjustmentCleared(req, res, next) {
  if (!req.accountContext) return next();
  try {
    const usage = await betterAuthCompatibilityBridge.getPlanUsage(req);
    if (!usage.pendingDowngrade?.adjustmentRequired) return next();
    return res.status(409).json({
      error: "Tu cuenta requiere ajustar sus Decks antes de continuar",
      code: "ACCOUNT_ADJUSTMENT_REQUIRED",
      pendingDowngrade: usage.pendingDowngrade
    });
  } catch (error) {
    console.error("Unable to validate account adjustment", error);
    return res.status(503).json({ error: "No se pudo validar el estado de la cuenta" });
  }
}
function requireOwnedDeck(req, res, next) {
  if (req.params?.deckId === DEMO_MASTER_DECK_ID && isImmersaAdmin(req.accountContext)) return next();
  return requireDatabaseOwnedDeck(req, res, next);
}
const requireDeckAccount = [requireAccount, requireOwnedDeck];
const requireControllerDeck = accessLinkHandlers.guardDeckRoles(["speaker", "stage"]);
const requireStageDeck = accessLinkHandlers.guardDeckRoles(["stage"]);
function requireImmersaAdmin(req, res, next) {
  if (!isImmersaAdmin(req.accountContext)) return res.status(403).json({ error: "Administración de IMMERSA requerida" });
  return next();
}
function eventHubUnavailable(res) {
  return res.status(503).json({ error: "Event Hub requiere la base de datos de IMMERSA" });
}
async function collectLocalPackageAssets(root, relative = "") {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectLocalPackageAssets(root, child));
    else if (entry.isFile()) files.push(child.replace(/\\/g, "/"));
  }
  return files;
}
function sendEventHubError(res, error) {
  if (error instanceof EventHubError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error("Event Hub request failed", error);
  return res.status(500).json({ error: "No se pudo completar la operación de Event Hub" });
}
app.post("/api/admin/event-hubs", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const hub = await eventHubRepository.createHub({
      slug: req.body?.slug,
      title: req.body?.title,
      createdByUserId: req.accountContext.user.id,
      stages: req.body?.stages || ["CCC Sala THX", "CHURUBUSCO Foro NELA", "CHURUBUSCO Foro A", "CHURUBUSCO Foro 2", "CHURUBUSCO Lobby"]
    });
    return res.status(201).json(hub);
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/admin/event-hubs", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json({ hubs: await eventHubRepository.listHubs() });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/admin/event-hubs/:workspaceId", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.getHub(req.params.workspaceId));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/admin/event-hubs/:workspaceId/local-package", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  const staging = path.join(DATA_TMP_DIR, `local-package-${req.params.workspaceId}-${Date.now()}`);
  try {
    const snapshot = await readEventHubForLocalExport({
      repository: eventHubRepository,
      eventWorkspaceId: req.params.workspaceId,
      listBrands: async (workspaceId) => (await eventBrandMentionStore.read(workspaceId)).brands || []
    });
    const deckIds = [...new Set(snapshot.activities.map((activity) => activity.deckId).filter(Boolean))];
    const activitiesByDeck = new Map(snapshot.activities.filter((activity) => activity.deckId).map((activity) => [activity.deckId, activity]));
    const decks = await Promise.all(deckIds.map(async (id) => {
      let deckDir;
      try {
        deckDir = await findDeckDir(id);
      } catch (error) {
        const activity = activitiesByDeck.get(id);
        throw new EventHubError(
          "LOCAL_PACKAGE_DECK_MISSING",
          `La actividad “${activity?.title || id}” usa el Deck ${id}, pero ese Deck no existe en este entorno Temporal.`,
          409
        );
      }
      const files = await collectLocalPackageAssets(deckDir);
      return {
        id,
        manifest: `decks/${id}/manifest.json`,
        assets: files.map((file) => ({ path: `decks/${id}/${file}`, source: path.join(deckDir, file) }))
      };
    }));
    const eventAssets = await collectLocalPackageAssets(DATA_EVENT_HUBS_DIR, req.params.workspaceId).then((files) => files.map((file) => `event-hubs/${file}`));
    await exportPackage({ destination: staging, sourceRoot: DATA_DIR, eventHub: snapshot.eventHub, stages: snapshot.stages, activities: snapshot.activities, publicQrs: snapshot.publicQrs, brands: snapshot.brands, decks, assets: eventAssets });
    const archive = await createArchive({ packageRoot: staging, destination: `${staging}.immersa-local.zip` });
    return res.download(archive, `${snapshot.eventHub.slug}.immersa-local.zip`, () => Promise.all([
      fs.promises.rm(staging, { recursive: true, force: true }),
      fs.promises.rm(archive, { force: true })
    ]).catch(() => {}));
  } catch (error) { return sendEventHubError(res, error); }
});
function eventBrandRequest(handler) {
  return async (req, res, next) => {
    try {
      if (!eventHubRepository) return eventHubUnavailable(res);
      await eventHubRepository.getHub(req.params.workspaceId);
      req.params.deckId = req.params.workspaceId;
      return handler(req, res, next);
    } catch (error) { return sendEventHubError(res, error); }
  };
}
app.get("/api/admin/event-hubs/:workspaceId/brand-mentions", requireAccount, requireImmersaAdmin, eventBrandRequest(eventBrandMentionHandlers.getConfig));
app.post("/api/admin/event-hubs/:workspaceId/brand-mentions", requireAccount, requireImmersaAdmin, eventBrandRequest(eventBrandMentionHandlers.createBrand));
app.put("/api/admin/event-hubs/:workspaceId/brand-mentions/order", requireAccount, requireImmersaAdmin, eventBrandRequest(eventBrandMentionHandlers.reorderBrands));
app.put("/api/admin/event-hubs/:workspaceId/brand-mentions/:brandId", requireAccount, requireImmersaAdmin, eventBrandRequest(eventBrandMentionHandlers.updateBrand));
app.delete("/api/admin/event-hubs/:workspaceId/brand-mentions/:brandId", requireAccount, requireImmersaAdmin, eventBrandRequest(eventBrandMentionHandlers.deleteBrand));
app.get("/api/admin/event-hubs/:workspaceId/polls", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json({ polls: await eventHubRepository.listEventPolls(req.params.workspaceId) }); }
  catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/polls", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.status(201).json(await eventHubRepository.createEventPoll({
      eventWorkspaceId: req.params.workspaceId,
      title: req.body?.title,
      prompt: req.body?.prompt,
      options: req.body?.options
    }));
  } catch (error) { return sendEventHubError(res, error); }
});
app.delete("/api/admin/event-hubs/:workspaceId/polls/:pollId", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json(await eventHubRepository.deleteEventPoll({ eventWorkspaceId: req.params.workspaceId, pollId: req.params.pollId })); }
  catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/admin/event-hubs/:workspaceId/overview", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const overview = await eventHubRepository.getAdminOverview(req.params.workspaceId);
    const interactionSummary = await eventHubRepository.getEventInteractionSummary(req.params.workspaceId);
    return res.json({ ...overview, eventInteraction: { ...interactionSummary, active: eventHubAdminInteractions?.status(req.params.workspaceId).active || null } });
  } catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/admin/event-hubs/:workspaceId/activities", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json({ activities: await eventHubRepository.listActivities(req.params.workspaceId) });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/admin/event-hubs/:workspaceId/activities", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const activity = await eventHubRepository.createActivity({
      eventWorkspaceId: req.params.workspaceId,
      eventStageId: req.body?.eventStageId,
      title: req.body?.title,
      activityType: req.body?.activityType,
      accessLevel: req.body?.accessLevel,
      deckId: req.body?.deckId,
      scheduledStartsAt: req.body?.scheduledStartsAt,
      durationMinutes: req.body?.durationMinutes
    });
    return res.status(201).json(activity);
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.put("/api/admin/event-hubs/:workspaceId/activities/:activityId", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.updateActivity({
      activityId: req.params.activityId,
      eventWorkspaceId: req.params.workspaceId,
      eventStageId: req.body?.eventStageId,
      title: req.body?.title,
      activityType: req.body?.activityType,
      accessLevel: req.body?.accessLevel,
      scheduledStartsAt: req.body?.scheduledStartsAt,
      durationMinutes: req.body?.durationMinutes
    }));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/speakers", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.status(201).json({ speakers: await eventHubRepository.addActivitySpeaker({
      eventWorkspaceId: req.params.workspaceId,
      activityId: req.params.activityId,
      accountUserId: req.body?.accountUserId,
      name: req.body?.name,
      roleTitle: req.body?.roleTitle,
      bio: req.body?.bio,
      photoUrl: req.body?.photoUrl
    }) });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.delete("/api/admin/event-hubs/:workspaceId/activities/:activityId/speakers/:speakerId", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.removeActivitySpeaker({
      eventWorkspaceId: req.params.workspaceId,
      activityId: req.params.activityId,
      eventSpeakerId: req.params.speakerId
    }));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/admin/event-hubs/:workspaceId/decks", requireAccount, requireImmersaAdmin, async (_req, res) => {
  try { return res.json({ decks: await listDecks() }); }
  catch (error) { console.error("Unable to list Event Hub decks", error); return res.status(500).json({ error: "No se pudieron cargar los Decks" }); }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/deck-check", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const speaker = await eventHubRepository.getLinkedSpeakerForActivity({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId, eventSpeakerId: req.body?.speakerId });
    const deckId = String(req.body?.deckId || "").trim();
    const speakerDeckIds = await betterAuthCompatibilityBridge.listDeckIdsForUser(speaker.userId);
    if (!speakerDeckIds.map(String).includes(deckId)) return res.status(404).json({ error: "Deck not found for this speaker" });
    return res.json(await eventHubRepository.requestDeckCheck({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId, deckId }));
  }
  catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/admin/event-hubs/:workspaceId/activities/:activityId/speakers/:speakerId/decks", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const speaker = await eventHubRepository.getLinkedSpeakerForActivity({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId, eventSpeakerId: req.params.speakerId });
    return res.json({ decks: await listDecks(await betterAuthCompatibilityBridge.listDeckIdsForUser(speaker.userId)) });
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/speakers/:speakerId/invite-link", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const invitation = await eventHubRepository.inviteSpeakerToLinkAccount({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId, eventSpeakerId: req.params.speakerId });
    // Event Hub invitations must return to the exact environment that created them.
    // BETTER_AUTH_URL may point to production while this Event Hub runs on its isolated DB.
    const baseUrl = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
    let email = { status: "not_configured" };
    if (eventHubEmailSender && invitation.speakerEmail) {
      try {
        await eventHubEmailSender({
          kind: "event-speaker-invitation",
          to: invitation.speakerEmail,
          name: invitation.speakerName,
          url: `${baseUrl}/home#invitaciones`,
          eventInvitation: invitation
        });
        email = { status: "sent" };
      } catch (error) {
        console.error("Unable to send Event Hub speaker invitation", error);
        email = { status: "failed", detail: String(error?.message || error).slice(0, 300) };
      }
    }
    return res.status(201).json({ ...invitation, email });
  }
  catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/event-hub/speaker-invitations", requireAccount, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json({ invitations: await eventHubRepository.listSpeakerInvitations(req.accountContext.user.id) }); }
  catch (error) { return sendEventHubError(res, error); }
});
app.put("/api/event-hub/speaker-invitations/:assignmentId/accept", requireAccount, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.acceptSpeakerInvitation({ assignmentId: req.params.assignmentId, userId: req.accountContext.user.id }));
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/reset-live-session", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json(await eventHubRepository.resetLiveActivity({ eventWorkspaceId: req.params.workspaceId, activityId: req.params.activityId })); }
  catch (error) { return sendEventHubError(res, error); }
});
app.put("/api/event-hub/speaker-invitations/:assignmentId/decline", requireAccount, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.declineSpeakerInvitation({ assignmentId: req.params.assignmentId, userId: req.accountContext.user.id }));
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/event-hub/speaker-invitations/:assignmentId/speaker-access", requireAccount, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const access = await eventHubRepository.getSpeakerPresentationAccess({
      assignmentId: req.params.assignmentId,
      userId: req.accountContext.user.id
    });
    const ownedDeckIds = await betterAuthCompatibilityBridge.listDeckIdsForUser(req.accountContext.user.id);
    if (!ownedDeckIds.map(String).includes(String(access.deckId))) {
      throw new EventHubError("SPEAKER_DECK_ACCESS_DENIED", "No tienes acceso a este Deck", 403);
    }
    const speakerLink = await accessLinkHandlers.createAccessLinkForDeck({ deckId: access.deckId, role: "speaker" });
    const baseUrl = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
    return res.status(201).json({
      activityId: access.activityId,
      url: `${baseUrl}/speaker/${speakerLink.access_token}`
    });
  } catch (error) { return sendEventHubError(res, error); }
});
app.delete("/api/admin/event-hubs/:workspaceId/activities/:activityId/deck-check", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json(await eventHubRepository.clearActivityDeck({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId })); }
  catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/deck-check/approve", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try { return res.json(await eventHubRepository.approveDeckCheck({ activityId: req.params.activityId, eventWorkspaceId: req.params.workspaceId })); }
  catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/activities/:activityId/stage-access", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const activity = await eventHubRepository.getActivity(req.params.activityId);
    if (activity.event_workspace_id !== req.params.workspaceId) throw new EventHubError("ACTIVITY_WORKSPACE_MISMATCH", "This activity does not belong to this Event Hub", 403);
    const eventDeckId = activity.deck_id || activity.pending_deck_id;
    if (!eventDeckId) throw new EventHubError("EVENT_DECK_REQUIRED", "Selecciona un Deck antes de abrir Event Stage", 409);
    const stageLink = await accessLinkHandlers.createAccessLinkForDeck({ deckId: eventDeckId, role: "stage" });
    await eventHubRepository.grantStageOperatorAccess({ eventStageId: activity.event_stage_id, accessSecret: stageLink.access_token });
    const baseUrl = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
    return res.status(201).json({ url: `${baseUrl}/stage/${stageLink.access_token}?eventActivityId=${encodeURIComponent(activity.id)}`, activityId: activity.id, stageId: activity.event_stage_id });
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-stages/:stageId/operator-access", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.status(201).json(await eventHubRepository.grantStageOperatorAccess({
      eventStageId: req.params.stageId,
      accessSecret: req.body?.accessSecret,
      expiresAt: req.body?.expiresAt || null
    }));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.put("/api/admin/event-stages/:stageId/capacity", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.setStageCapacity({
      eventStageId: req.params.stageId,
      audienceCapacity: req.body?.audienceCapacity
    }));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/event/stages/:stageId/live-sessions", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    await eventHubRepository.authorizeStageOperation({
      eventStageId: req.params.stageId,
      accessSecret: req.headers["x-immersa-event-stage-access"]
    });
    const activity = await eventHubRepository.getActivity(req.body?.eventActivityId);
    if (activity.event_stage_id !== req.params.stageId) {
      throw new EventHubError("ACTIVITY_STAGE_MISMATCH", "This activity does not belong to this Event Stage", 403);
    }
    return res.status(201).json(await eventHubRepository.startLiveSession({ eventActivityId: activity.id }));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/event/stage-control/:deckId", requireStageDeck, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const control = await eventHubRepository.getStageControlForDeck(req.params.deckId, req.query?.eventActivityId);
    if (!control) return res.status(404).json({ error: "Esta presentación no tiene una actividad Event Hub operable" });
    return res.json(control);
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/polls/:pollId/launch", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubAdminInteractions) return eventHubUnavailable(res);
  try { return res.json(await eventHubAdminInteractions.launch({ eventWorkspaceId: req.params.workspaceId, pollId: req.params.pollId })); }
  catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/admin/event-hubs/:workspaceId/polls/interaction", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubAdminInteractions) return eventHubUnavailable(res);
  try { return res.json(eventHubAdminInteractions.status(req.params.workspaceId)); }
  catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/admin/event-hubs/:workspaceId/polls/close", requireAccount, requireImmersaAdmin, async (req, res) => {
  if (!eventHubAdminInteractions) return eventHubUnavailable(res);
  try { return res.json(eventHubAdminInteractions.close(req.params.workspaceId)); }
  catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/event/stage-control/:deckId/conference/:action", requireStageDeck, async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const action = String(req.params.action || "");
    if (!new Set(["start", "finish"]).has(action)) {
      throw new EventHubError("INVALID_CONFERENCE_ACTION", "La operación de conferencia no es válida", 400);
    }
    const control = await eventHubRepository.getStageControlForDeck(req.params.deckId, req.query?.eventActivityId);
    if (!control) throw new EventHubError("EVENT_STAGE_CONTROL_NOT_FOUND", "Esta presentación no tiene una actividad Event Hub operable", 404);
    const accessLink = req.immersaAccess?.accessLink;
    await eventHubRepository.authorizeStageOperation({
      eventStageId: control.stageId,
      accessSecret: accessLink?.access_token
    });
    const lifecycleContext = {
      roomKey: getRoomKey(accessLink.session_id, req.params.deckId),
      role: "stage",
      sessionId: accessLink.session_id,
      deckId: req.params.deckId
    };
    if (action === "start") {
      if (control.liveSessionId) {
        return res.json({ liveSessionId: control.liveSessionId, status: "LIVE" });
      }
      const liveSession = await eventHubRepository.startLiveSession({ eventActivityId: control.activityId });
      try {
        await presentationLifecycleRuntime.start(lifecycleContext);
      } catch (error) {
        await eventHubRepository.finishLiveSession(liveSession.id).catch(() => {});
        throw error;
      }
      return res.status(201).json({ liveSessionId: liveSession.id, status: "LIVE" });
    }
    if (!control.liveSessionId) throw new EventHubError("LIVE_SESSION_NOT_FOUND", "No hay una conferencia en vivo para finalizar", 404);
    try {
      await presentationLifecycleRuntime.finish(lifecycleContext);
    } catch (error) {
      if (error?.code !== "NOT_LIVE") throw error;
    }
    await eventHubRepository.finishLiveSession(control.liveSessionId);
    return res.json({ liveSessionId: null, status: "FINISHED" });
  } catch (error) { return sendEventHubError(res, error); }
});
app.post("/api/event/stages/:stageId/live-sessions/:liveSessionId/finish", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    await eventHubRepository.authorizeStageOperation({
      eventStageId: req.params.stageId,
      accessSecret: req.headers["x-immersa-event-stage-access"]
    });
    const liveSession = await eventHubRepository.getLiveSession(req.params.liveSessionId);
    if (liveSession.event_stage_id !== req.params.stageId) {
      throw new EventHubError("LIVE_SESSION_STAGE_MISMATCH", "This LiveSession does not belong to this Event Stage", 403);
    }
    return res.json(await eventHubRepository.finishLiveSession(liveSession.id));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/event/public/:publicId", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    return res.json(await eventHubRepository.getPublicQr(req.params.publicId));
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/api/event/public/:publicId/brand-mentions", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const qr = await eventHubRepository.getPublicQr(req.params.publicId);
    res.setHeader("Cache-Control", "no-store");
    return res.json(await eventBrandMentionStore.read(qr.eventWorkspaceId));
  } catch (error) { return sendEventHubError(res, error); }
});
app.get("/api/event/public/:publicId/activities", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const qr = await eventHubRepository.getPublicQr(req.params.publicId);
    return res.json({
      event: { title: qr.title, slug: qr.slug },
      audienceLevel: qr.audienceLevel,
      activities: await eventHubRepository.listPublicActivities({
        eventWorkspaceId: qr.eventWorkspaceId,
        audienceLevel: qr.audienceLevel
      })
    });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/event/public/:publicId/registration", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const qr = await eventHubRepository.getPublicQr(req.params.publicId);
    const participant = await eventHubRepository.registerParticipant({
      eventWorkspaceId: qr.eventWorkspaceId,
      registrationKey: req.body?.registrationKey,
      audienceLevel: qr.audienceLevel
    });
    return res.status(201).json({ participantId: participant.id, audienceLevel: participant.audienceLevel, event: { title: qr.title, slug: qr.slug } });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/event/live-sessions/:liveSessionId/enter", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const admission = await eventHubRepository.admitParticipant({
      eventLiveSessionId: req.params.liveSessionId,
      eventParticipantId: req.body?.participantId
    });
    const liveSession = await eventHubRepository.getLiveSession(req.params.liveSessionId);
    const audiencePath = await accessLinkHandlers.publicAudiencePathForDeck(liveSession.deck_id);
    if (!audiencePath) throw new EventHubError("EVENT_DECK_AUDIENCE_LINK_MISSING", "La presentación aún no tiene acceso Público", 409);
    const publicId = await eventHubRepository.getPublicQrForAudience({
      eventWorkspaceId: liveSession.event_workspace_id,
      audienceLevel: admission.audienceLevel || "PAID"
    });
    return res.json({ ...admission, audiencePath, returnPath: publicId ? `/${publicId}` : null });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.post("/api/event/live-sessions/:liveSessionId/status", async (req, res) => {
  if (!eventHubRepository) return eventHubUnavailable(res);
  try {
    const live = await eventHubRepository.isParticipantLiveSessionActive({
      eventLiveSessionId: req.params.liveSessionId,
      eventParticipantId: req.body?.participantId
    });
    return res.json({ live });
  } catch (error) {
    return sendEventHubError(res, error);
  }
});
app.get("/admin/accounts", betterAuthCompatibilityBridge.requirePageAuth(), requireImmersaAdmin, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin", "accounts.html"));
});
app.get("/admin/event-hub", betterAuthCompatibilityBridge.requirePageAuth(), requireImmersaAdmin, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin", "event-hub.html"));
});
async function requireOwnedOrPublishedSession(req, res, next) {
  const requestedSessionId = String(req.body?.session_id || "").trim();
  const published = await readSystemDemoManifest(DATA_DECKS_DIR, DEMO_PUBLISHED_DECK_ID).catch(() => null);
  if (published && requestedSessionId && demoSessionIdForAccount(req.accountContext) === requestedSessionId) {
    req.ownedDeckId = DEMO_PUBLISHED_DECK_ID;
    return next();
  }
  if (isImmersaAdmin(req.accountContext)) {
    const master = await readSystemDemoManifest(DATA_DECKS_DIR, DEMO_MASTER_DECK_ID).catch(() => null);
    if (requestedSessionId && manifestSessionId(master) === requestedSessionId) {
      req.ownedDeckId = DEMO_MASTER_DECK_ID;
      return next();
    }
  }
  return betterAuthCompatibilityBridge.requireOwnedSession(req, res, next);
}
function requireDeckFeature(feature) {
  return async (req, res, next) => {
    try {
      const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
      const access = isSystemDemoDeckId(deckId)
        ? featureAccessForPlan("SPEAKER_PRO")
        : await betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId);
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
async function requireRequestedRoleFeature(req, res, next) {
  const role = String(req.body?.role || "").trim();
  if (role !== "stage") return next();
  try {
    const deckId = req.ownedDeckId;
    const access = await getStageFeatureAccess(deckId);
    if (canUseFeature(access, CAPABILITIES.ACCESS_BACKSTAGE)) return next();
    return res.status(403).json({
      error: "BACKSTAGE está disponible desde SPEAKER",
      code: "PLAN_FEATURE_LOCKED",
      feature: CAPABILITIES.ACCESS_BACKSTAGE
    });
  } catch (error) {
    console.error("Unable to validate role access", error);
    return res.status(503).json({ error: "No se pudo validar el plan" });
  }
}
function requireDeckConfigurationWrite(req, res, next) {
  return (async () => {
    try {
      const deckId = req.immersaAccess?.deck?.deckId || req.params?.deckId;
      if (deckId === DEMO_PUBLISHED_DECK_ID) {
        return res.status(403).json({ error: "El Deck Demo publicado es de solo lectura", code: "SYSTEM_DEMO_IMMUTABLE" });
      }
      const access = isSystemDemoDeckId(deckId)
        ? featureAccessForPlan("SPEAKER_PRO")
        : await betterAuthCompatibilityBridge.getDeckFeatureAccess(deckId);
      const current = await deckInteractionHandlers.readDeckConfig(deckId);
      const unavailable = changedDeckCapabilities(req.body, current)
        .find((capability) => !canUseFeature(access, capability));
      if (unavailable) {
        return res.status(403).json({
          error: "Esta función no está disponible en tu plan",
          code: "PLAN_FEATURE_LOCKED",
          feature: unavailable
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
function requireAccountOrControllerDeck(req, res, next) {
  if (String(req.headers["x-immersa-access-token"] || "").trim()) {
    return requireControllerDeck(req, res, next);
  }
  return betterAuthCompatibilityBridge.attachOptionalAccount(req, res, () => {
    if (req.accountContext) return requireOwnedDeck(req, res, next);
    return requireControllerDeck(req, res, next);
  });
}
function publishedDemoSlideIds(manifest) {
  return (Array.isArray(manifest?.slides) ? manifest.slides : []).map((slide, index) =>
    String(slide?.id || "slide-" + String(index + 1).padStart(3, "0"))
  );
}
async function handleDemoSessionSlideVisibility(req, res) {
  try {
    if (req.params.deckId !== DEMO_PUBLISHED_DECK_ID || req.immersaAccess?.deck?.deckId !== DEMO_PUBLISHED_DECK_ID) {
      return res.status(404).json({ error: "Deck Demo no encontrado" });
    }
    const manifest = await readSystemDemoManifest(DATA_DECKS_DIR, DEMO_PUBLISHED_DECK_ID);
    if (!manifest) return res.status(404).json({ error: "Deck Demo no encontrado" });
    const sessionId = req.immersaAccess?.accessLink?.session_id;
    const slideIds = publishedDemoSlideIds(manifest);
    const publishedConfig = req.method === "GET"
      ? await deckInteractionHandlers.readDeckConfig(DEMO_PUBLISHED_DECK_ID)
      : null;
    const hiddenSlideIds = req.method === "PUT"
      ? demoSessionVisibilityStore.set(sessionId, req.body?.hidden_slide_ids, slideIds)
      : demoSessionVisibilityStore.get(sessionId, slideIds, publishedConfig?.hidden_slide_ids);
    return res.json({ deck_id: DEMO_PUBLISHED_DECK_ID, hidden_slide_ids: hiddenSlideIds });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error("Unable to update Demo session slide visibility", error);
    return res.status(status).json({ error: error.message || "No se pudo actualizar la visibilidad del Demo" });
  }
}
app.get("/api/decks", requireAccount, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const ownedDeckIds = await betterAuthCompatibilityBridge.listDeckIds(req);
    const visibleDeckIds = [...ownedDeckIds];
    const published = await readSystemDemoManifest(DATA_DECKS_DIR, DEMO_PUBLISHED_DECK_ID);
    if (published) visibleDeckIds.push(DEMO_PUBLISHED_DECK_ID);
    if (isImmersaAdmin(req.accountContext)) visibleDeckIds.push(DEMO_MASTER_DECK_ID);
    const visibleDecks = await listDecks(visibleDeckIds);
    const publishedDeck = visibleDecks.find((deck) => deck.deckId === DEMO_PUBLISHED_DECK_ID);
    if (publishedDeck) publishedDeck.session_id = demoSessionIdForAccount(req.accountContext);
    if (isImmersaAdmin(req.accountContext) && !visibleDecks.some((deck) => deck.deckId === DEMO_MASTER_DECK_ID)) {
      visibleDecks.unshift({
        deckId: DEMO_MASTER_DECK_ID,
        title: "Deck Demo Maestro",
        status: "not_created",
        conversionStatus: "missing",
        slides: 0,
        slideCount: 0,
        sourceSizeBytes: 0,
        systemDemo: true,
        demoRole: "master",
        missing: true,
        immutable: false
      });
    }
    res.json(visibleDecks);
  } catch (error) {
    console.error("Unable to list decks", error);
    res.status(500).json({ error: "Unable to list decks" });
  }
});
app.get("/api/account/plan", requireAccount, async (req, res) => {
  try {
    await synchronizeWorkspaceStorageSizes(req);
    res.json({
      ...await betterAuthCompatibilityBridge.getPlanUsage(req),
      admin: isImmersaAdmin(req.accountContext)
    });
  } catch (error) {
    console.error("Unable to load account plan", error);
    res.status(500).json({ error: "Unable to load account plan" });
  }
});
app.get("/api/admin/accounts", requireAccount, requireImmersaAdmin, async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ accounts: await betterAuthCompatibilityBridge.listAdminAccounts() });
  } catch (error) {
    console.error("Unable to list Immersa accounts", error);
    res.status(500).json({ error: "No se pudieron cargar las cuentas" });
  }
});
app.put("/api/admin/accounts/:workspaceId/plan", requireAccount, requireImmersaAdmin, async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId || "").trim();
    const deckIds = new Set(await betterAuthCompatibilityBridge.listWorkspaceDeckIds(workspaceId));
    const active = Array.from(sessions.values()).some((session) => (
      deckIds.has(String(session.deckId))
      && !session.inactivityShutdownAt
      && (session.presenterConnected || session.stageConnected || session.screenConnected || session.audience.size > 0)
    ));
    if (active) return res.status(409).json({ error: "No puedes cambiar el plan durante una presentación activa", code: "ACTIVE_PRESENTATION" });
    await billingRuntime.service.assertManualPlanChangeAllowed(workspaceId, req.body?.plan);
    res.json(await betterAuthCompatibilityBridge.changeWorkspacePlan(req, {
      workspaceId,
      plan: req.body?.plan,
      note: req.body?.note
    }));
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error("Unable to change Immersa plan", error);
    res.status(status).json({
      error: error.publicMessage || error.message || "No se pudo cambiar el plan",
      code: error.code || "PLAN_CHANGE_FAILED",
      details: error.details || null
    });
  }
});
app.post("/api/admin/accounts/:workspaceId/downgrade-email", requireAccount, requireImmersaAdmin, async (req, res) => {
  try {
    const emailNotification = await betterAuthCompatibilityBridge.resendWorkspaceDowngradeEmail(String(req.params.workspaceId || "").trim());
    res.status(["sent", "already_sent"].includes(emailNotification?.status) ? 200 : 502).json({ emailNotification });
  } catch (error) {
    console.error("Unable to resend Immersa downgrade notification", error);
    res.status(500).json({
      error: "No se pudo reenviar el correo",
      emailNotification: { status: "failed", detail: String(error?.message || error).slice(0, 300) }
    });
  }
});
app.get("/api/account/profile", requireAccount, profileHandlers.getProfile);
app.put("/api/account/profile", requireAccount, profileHandlers.saveProfile);
app.post("/api/account/profile/photo", requireAccount, profileHandlers.uploadPhoto);
app.delete("/api/account/profile/photo", requireAccount, profileHandlers.deletePhoto);
app.get("/api/decks/:deckId/speaker-profile", profileHandlers.getDeckSpeakerProfile);
app.get("/api/demo-session/decks/:deckId/slide-visibility", requireControllerDeck, handleDemoSessionSlideVisibility);
app.put("/api/demo-session/decks/:deckId/slide-visibility", requireControllerDeck, handleDemoSessionSlideVisibility);
app.get("/api/decks/:deckId/interactions", deckInteractionHandlers.getInteractions);
app.put("/api/decks/:deckId/interactions", requireAccountOrControllerDeck, requireAccountAdjustmentCleared, requireDeckConfigurationWrite, deckInteractionHandlers.putInteractions);
app.post("/api/decks/:deckId/knowledge-questions/:questionId/image", ...requireDeckAccount, requireAccountAdjustmentCleared, requireDeckFeature(CAPABILITIES.TRIVIA_RUN), deckInteractionHandlers.uploadQuestionImage);
app.get("/api/decks/:deckId/brand-mentions", ...requireDeckAccount, brandMentionHandlers.getConfig);
app.post("/api/decks/:deckId/brand-mentions", ...requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers.createBrand);
app.put("/api/decks/:deckId/brand-mentions/order", ...requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers.reorderBrands);
app.put("/api/decks/:deckId/brand-mentions/:brandId", ...requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers.updateBrand);
app.delete("/api/decks/:deckId/brand-mentions/:brandId", ...requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers.deleteBrand);
app.get("/api/decks/:deckId/qna/history", ...requireDeckAccount, requireDeckFeature(CAPABILITIES.METRICS_BASIC), qnaHistoryHandlers.listHistory);
app.get("/api/decks/:deckId/knowledge-activities/history", ...requireDeckAccount, requireDeckFeature(CAPABILITIES.METRICS_EXPORT), knowledgeActivityHistoryHandlers.listHistory);
if (presentationMetricsHandlers) {
  app.get("/api/decks/:deckId/metrics/basic", ...requireDeckAccount, requireDeckFeature(CAPABILITIES.METRICS_BASIC), presentationMetricsHandlers.listDeckSessions);
}
app.post(
  "/api/decks/:deckId/replace",
  ...requireDeckAccount,
  requireAccountAdjustmentCleared,
  createDeckReplacementHandler({
    beforeDeckSwap: ({ deck }) => assertDeckCanBeReplaced(deck.deckId),
    onDeckReplaced: async ({ req, deck }) => {
      if (deck.deckId === DEMO_MASTER_DECK_ID) {
        await decorateMasterManifest(DATA_DECKS_DIR);
        delete deckSlideCounts[deck.deckId];
        return null;
      }
      const result = await betterAuthCompatibilityBridge.replaceDeckSource(req, deck);
      delete deckSlideCounts[deck.deckId];
      return result;
    }
  })
);
app.post("/api/decks/:deckId/replacement-review", ...requireDeckAccount, requireAccountAdjustmentCleared, async (req, res) => {
  try {
    res.json(await markDeckAssociationsReviewed(req.params.deckId));
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    if (statusCode >= 500) console.error("Unable to mark replacement associations reviewed", error);
    res.status(statusCode).json({ error: statusCode === 404 ? "Deck not found" : "Unable to update presentation review" });
  }
});
app.put("/api/decks/:deckId/title", ...requireDeckAccount, requireAccountAdjustmentCleared, async (req, res) => {
  try {
    if (isSystemDemoDeckId(req.params.deckId)) return res.status(409).json({ error: "El nombre del Deck Demo es administrado por IMMERSA" });
    res.json(await renameDeck(req.params.deckId, req.body?.title));
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    if (statusCode >= 500) console.error("Unable to rename deck", error);
    res.status(statusCode).json({ error: statusCode === 400 ? "Escribe un nombre de hasta 120 caracteres" : statusCode === 404 ? "Deck not found" : "Unable to rename presentation" });
  }
});
app.put("/api/decks/:deckId/transition", ...requireDeckAccount, requireAccountAdjustmentCleared, async (req, res) => {
  try {
    if (isSystemDemoDeckId(req.params.deckId)) return res.status(409).json({ error: "La transición del Deck Demo es administrada por IMMERSA" });
    res.json(await updateDeckSlideTransition(req.params.deckId, req.body?.slideTransition));
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    if (statusCode >= 500) console.error("Unable to update Deck slide transition", error);
    res.status(statusCode).json({ error: statusCode === 400 ? "Selecciona una transición válida" : statusCode === 404 ? "Deck not found" : "Unable to update slide transition" });
  }
});
app.delete("/api/decks/:deckId", ...requireDeckAccount, async (req, res) => {
  try {
    if (isSystemDemoDeckId(req.params.deckId)) return res.status(409).json({ error: "El Deck Demo no puede eliminarse" });
    const deckId = await deleteDataDeck(req.params.deckId);
    await betterAuthCompatibilityBridge.unregisterDeck(req, deckId);
    res.json({ ok: true, deckId });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error("Unable to delete deck", error);
    res.status(statusCode).json({ error: statusCode === 404 ? "Deck not found" : statusCode === 400 ? "Invalid deck id" : "Unable to delete deck" });
  }
});
app.post("/api/admin/demo/master", requireAccount, requireImmersaAdmin, createUploadHandler({
  fixedDeckId: DEMO_MASTER_DECK_ID,
  decorateManifest: ({ manifest }) => ({
    ...manifest,
    deckId: DEMO_MASTER_DECK_ID,
    title: "Deck Demo Maestro",
    systemDemo: { role: "master", editableBy: "immersa-admin" },
    slides: (Array.isArray(manifest.slides) ? manifest.slides : []).map((slide) => ({ ...slide, planLevel: null }))
  })
}));
app.put("/api/admin/demo/slides/:slideId/plan", requireAccount, requireImmersaAdmin, async (req, res) => {
  try {
    const manifest = await updateMasterSlidePlan(DATA_DECKS_DIR, req.params.slideId, req.body?.planLevel);
    res.json({ ok: true, slideId: req.params.slideId, planLevel: manifest.slides.find((slide) => String(slide.id) === String(req.params.slideId))?.planLevel });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "No se pudo asignar el nivel" });
  }
});
app.post("/api/admin/demo/publish", requireAccount, requireImmersaAdmin, async (_req, res) => {
  try {
    const manifest = await publishMasterDeck(DATA_DECKS_DIR);
    delete deckSlideCounts[DEMO_PUBLISHED_DECK_ID];
    res.json(manifestSummary(manifest));
  } catch (error) {
    const payload = { error: error.message || "No se pudo publicar el Deck Demo" };
    if (error.code) payload.code = error.code;
    if (error.unassignedSlides) payload.unassignedSlides = error.unassignedSlides;
    res.status(error.statusCode || 500).json(payload);
  }
});
app.post("/api/access-links", requireAccount, requireAccountAdjustmentCleared, requireOwnedOrPublishedSession, requireRequestedRoleFeature, accessLinkHandlers.createAccessLink);
app.get("/api/access-links/:access_token", accessLinkHandlers.resolveAccessLink);
app.get("/api/open/:access_token", accessLinkHandlers.openPresentation);
app.get("/api/qna/export/:access_token", accessLinkHandlers.guardAccessRoles(["speaker"]), requireDeckFeature(CAPABILITIES.METRICS_EXPORT), qnaHistoryHandlers.exportDeck);
app.get(
  "/api/knowledge-activities/:executionId/export/:access_token",
  accessLinkHandlers.guardAccessRoles(["speaker"]),
  requireDeckFeature(CAPABILITIES.METRICS_EXPORT),
  knowledgeActivityHistoryHandlers.exportExecution
);
app.delete("/api/qna/history/:access_token", accessLinkHandlers.guardAccessRoles(["speaker"]), requireDeckFeature(CAPABILITIES.METRICS_BASIC), qnaHistoryHandlers.clearHistory);
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
app.post("/api/upload-pptx", requireAccount, requireAccountAdjustmentCleared, createUploadHandler({
  onDeckCreateStart: ({ req, deck }) => reserveUploadedDeck(req, deck),
  onDeckCreateFinalized: ({ req, deck }) => betterAuthCompatibilityBridge.replaceDeckSource(req, deck),
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
app.get("/p_evt_:eventPublicId", async (req, res, next) => {
  if (!eventHubRepository) return next();
  const publicId = `p_evt_${String(req.params.eventPublicId || "")}`;
  try {
    await eventHubRepository.getPublicQr(publicId);
    const html = await fs.promises.readFile(path.join(PUBLIC_DIR, "event", "index.html"), "utf8");
    const context = JSON.stringify({ publicId }).replace(/</g, "\\u003c");
    return res.type("html").send(html.replace("window.IMMERSA_EVENT_PUBLIC = null;", `window.IMMERSA_EVENT_PUBLIC = ${context};`));
  } catch (error) {
    if (error instanceof EventHubError && error.code === "EVENT_QR_NOT_FOUND") return next();
    return sendEventHubError(res, error);
  }
});
app.get("/event-hubs/:workspaceId/brand-assets/:fileName", async (req, res) => {
  if (!eventHubRepository) return res.sendStatus(404);
  try {
    await eventHubRepository.getHub(req.params.workspaceId);
    const asset = eventBrandMentionStore.assetPath(req.params.workspaceId, req.params.fileName);
    if (!asset) return res.sendStatus(404);
    return res.sendFile(asset, (error) => { if (error && !res.headersSent) res.sendStatus(error.code === "ENOENT" ? 404 : 500); });
  } catch (error) { return sendEventHubError(res, error); }
});
app.get("/:public_id", accessLinkHandlers.openPublicAudience);
app.use(express.static(PUBLIC_DIR));

io.use(betterAuthCompatibilityBridge.socketMiddleware);
io.on("connection", (socket) => {
  eventHubAdminInteractions?.attach(socket);
  let currentRoomKey = null;
  let currentRole = null;
  let currentSessionId = null;
  let currentDeckId = null;
  let currentAudienceId = null;
  let currentFeatureAccess = featureAccessForPlan("FREE");

  socket.use(([eventName], next) => {
    const feature = requiredCapabilityForControllerEvent(eventName);
    if (!feature || canUseFeature(currentFeatureAccess, feature)) return next();
    socket.emit("plan:feature_locked", {
      feature,
      plan: currentFeatureAccess.plan,
      message: "Esta función no está disponible en tu plan"
    });
  });

  socket.use(([eventName], next) => {
    if (currentRoomKey && isMeaningfulSessionEvent(eventName)) touchSession(currentRoomKey);
    next();
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
    let session = getSessionByRoomKey(currentRoomKey);
    try {
      if (session && isSessionInactive(session, Date.now(), SESSION_INACTIVITY_MS)) {
        await shutdownInactiveSession(currentRoomKey, session);
      } else if (!session && qnaRuntime.shutdownSessionIfStale) {
        const staleResult = await qnaRuntime.shutdownSessionIfStale({
          deckId: joinedDeckId,
          sourceSessionId: joinedSessionId,
          inactivityMs: SESSION_INACTIVITY_MS
        });
        if (staleResult?.expired) console.log("[session] stale persisted Q&A reset", currentRoomKey);
      }
    } catch (error) {
      console.error("Unable to verify session inactivity during join", error);
    }
    session = getSession(joinedSessionId, joinedDeckId);
    touchSession(currentRoomKey);
    try {
      currentFeatureAccess = await getStageFeatureAccess(joinedDeckId);
    } catch (error) {
      currentFeatureAccess = featureAccessForPlan("FREE");
      console.error("Unable to resolve live plan features", error);
    }
    socket.emit("plan:features", currentFeatureAccess);
    if (currentFeatureAccess.adjustmentRequired) {
      socket.emit("plan:adjustment_required", {
        code: "ACCOUNT_ADJUSTMENT_REQUIRED",
        message: "Esta cuenta debe ajustar sus Decks antes de iniciar una presentación"
      });
      return socket.disconnect(true);
    }
    if (role === "stage" && !canUseFeature(currentFeatureAccess, CAPABILITIES.ACCESS_BACKSTAGE)) {
      socket.emit("plan:feature_locked", {
        feature: CAPABILITIES.ACCESS_BACKSTAGE,
        plan: currentFeatureAccess.plan,
        message: "BACKSTAGE está disponible desde SPEAKER"
      });
      return socket.disconnect(true);
    }
    const slideCount = await refreshSessionDeck(session, joinedDeckId);
    if (role === "presenter") console.log("[session]", joinedSessionId, "deck", session.deckId, "room", currentRoomKey, "slideCount", slideCount);
    socket.join(currentRoomKey);
    socket.join(getRoleRoomKey(currentRoomKey, role));

    if (role === "presenter") {
      session.presenterConnected = true;
      io.to(currentRoomKey).emit("presenter_connected");
    }
    if (role === "screen") session.screenConnected = true;
    if (role === "stage") session.stageConnected = true;
    if (role === "audience") {
      const requestedAudienceId = String(audienceId || socket.id);
      let eventStageCapacity = null;
      try {
        eventStageCapacity = await eventHubRepository?.getLiveStageCapacityForDeck(joinedDeckId);
      } catch (error) {
        console.error("Unable to resolve Event Stage capacity", error);
      }
      const audienceLimit = eventStageCapacity?.audienceCapacity || getPlanLimits(currentFeatureAccess.plan).audience;
      if (!canRegisterAudience(session, requestedAudienceId, audienceLimit)) {
        socket.emit("plan:audience_limit", {
          code: "AUDIENCE_LIMIT_REACHED",
          limit: audienceLimit,
          plan: eventStageCapacity ? null : currentFeatureAccess.plan,
          eventStageId: eventStageCapacity?.eventStageId || null,
          message: "Esta presentación alcanzó el límite de Público simultáneo."
        });
        return socket.disconnect(true);
      }
      currentAudienceId = registerAudience(session, {
        audienceId: requestedAudienceId,
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
    if (role === "audience") {
      try {
        const liveEvent = await eventHubRepository?.getLiveEventForDeck(currentDeckId);
        if (liveEvent?.event_workspace_id) joinedContext.brandSourceId = `event:${liveEvent.event_workspace_id}`;
      } catch (error) { console.error("Unable to resolve Event Hub brands", error); }
    }
    emitState(currentRoomKey, session);
    if (
      role === "audience"
      && canUseFeature(currentFeatureAccess, CAPABILITIES.METRICS_BASIC)
      && session.audience.size >= AUTO_START_AUDIENCE_THRESHOLD
      && !session.automaticLifecycleStarted
    ) {
      session.automaticLifecycleStarted = true;
      void presentationLifecycleRuntime.startAutomatically(joinedContext)
        .then((state) => {
          if (state?.mode !== "live") session.automaticLifecycleStarted = false;
        });
    } else if (role === "audience" && canUseFeature(currentFeatureAccess, CAPABILITIES.METRICS_BASIC)) {
      void presentationMetricsRepository?.recordAudienceConnection(
        joinedContext,
        { audienceId: currentAudienceId },
        session.audience.size
      ).catch((error) => console.error("Unable to persist presentation attendance", error));
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
  });
});

server.listen(PORT, () => {
  console.log("Immersa Presentations running at http://localhost:" + PORT);
  console.log("Q&A runtime enabled:", qnaRuntime.enabled);
  console.log("Contest and assessment runtime enabled:", knowledgeActivityRuntime.enabled);
  console.log("Session inactivity shutdown:", Math.round(SESSION_INACTIVITY_MS / 60_000), "minutes");
  logConversionHealth();
});

knowledgeActivityRuntime.start().catch((error) => {
  console.error("Unable to start contest and assessment runtime", error);
});
