const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateUniqueSessionId, manifestSessionId } = require("./session-id");

const DEMO_MASTER_DECK_ID = "immersa-demo-master";
const DEMO_PUBLISHED_DECK_ID = "immersa-demo";
const DEFAULT_DEMO_SEED_DIR = path.join(__dirname, "bootstrap", DEMO_MASTER_DECK_ID);
const DEMO_PLAN_LEVELS = Object.freeze(["FREE", "SPEAKER", "SPEAKER_PRO"]);
const DEMO_SESSION_VISIBILITY_TTL_MS = 30 * 60 * 1000;

function adminEmails(env = process.env) {
  return new Set(
    [env.IMMERSA_ADMIN_EMAIL, env.IMMERSA_ADMIN_EMAILS]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[;,\s]+/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isImmersaAdmin(accountContext, env = process.env) {
  const email = String(accountContext?.user?.email || "").trim().toLowerCase();
  return Boolean(email && adminEmails(env).has(email));
}

function demoSessionIdForAccount(accountContext, env = process.env) {
  const userId = String(accountContext?.user?.id || "").trim();
  if (!userId) return "";
  const secret = String(
    env.IMMERSA_ROUTE_GUARD_SECRET || env.BETTER_AUTH_SECRET || env.SESSION_SECRET || "immersa-demo-session-v1"
  );
  return "demo_" + crypto.createHmac("sha256", secret).update(userId + ":" + DEMO_PUBLISHED_DECK_ID).digest("hex").slice(0, 20);
}

function isSystemDemoDeckId(deckId) {
  const normalized = String(deckId || "");
  return normalized === DEMO_MASTER_DECK_ID || normalized === DEMO_PUBLISHED_DECK_ID;
}

function createDemoSessionVisibilityStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Math.max(1, Number(options.ttlMs) || DEMO_SESSION_VISIBILITY_TTL_MS);
  const sessions = new Map();

  function normalize(sessionId, hiddenSlideIds, validSlideIds) {
    const key = String(sessionId || "").trim();
    if (!key) {
      const error = new Error("Sesión Demo requerida");
      error.statusCode = 400;
      throw error;
    }
    const valid = new Set((Array.isArray(validSlideIds) ? validSlideIds : []).map(String));
    const hidden = [...new Set((Array.isArray(hiddenSlideIds) ? hiddenSlideIds : []).map(String))]
      .filter((slideId) => valid.has(slideId));
    if (valid.size && hidden.length >= valid.size) {
      const error = new Error("El Demo debe conservar al menos una slide visible");
      error.statusCode = 400;
      throw error;
    }
    return { key, hidden };
  }

  function removeExpired() {
    const cutoff = now() - ttlMs;
    for (const [key, value] of sessions) {
      if (value.updatedAt <= cutoff) sessions.delete(key);
    }
  }

  return {
    get(sessionId, validSlideIds, fallbackHiddenSlideIds = []) {
      removeExpired();
      const { key } = normalize(sessionId, [], validSlideIds);
      const current = sessions.get(key);
      if (!current) return normalize(key, fallbackHiddenSlideIds, validSlideIds).hidden;
      return normalize(key, current.hiddenSlideIds, validSlideIds).hidden;
    },
    set(sessionId, hiddenSlideIds, validSlideIds) {
      removeExpired();
      const { key, hidden } = normalize(sessionId, hiddenSlideIds, validSlideIds);
      sessions.set(key, { hiddenSlideIds: hidden, updatedAt: now() });
      return [...hidden];
    },
    clear(sessionId) {
      sessions.delete(String(sessionId || "").trim());
    }
  };
}

function systemDemoRole(deckId) {
  if (String(deckId) === DEMO_MASTER_DECK_ID) return "master";
  if (String(deckId) === DEMO_PUBLISHED_DECK_ID) return "published";
  return null;
}

function normalizePlanLevel(value, { allowEmpty = false } = {}) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[ -]+/g, "_");
  if (!normalized && allowEmpty) return null;
  if (!DEMO_PLAN_LEVELS.includes(normalized)) {
    const error = new Error("Nivel de plan inválido");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function deckDirectory(dataDecksDir, deckId) {
  const root = path.resolve(dataDecksDir);
  const target = path.resolve(root, deckId);
  if (path.dirname(target) !== root) throw new Error("Invalid system Demo path");
  return target;
}

async function readSystemDemoManifest(dataDecksDir, deckId) {
  try {
    const raw = await fs.promises.readFile(path.join(deckDirectory(dataDecksDir, deckId), "manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function seedSystemDemoDeck(dataDecksDir, seedDir = DEFAULT_DEMO_SEED_DIR) {
  await fs.promises.mkdir(dataDecksDir, { recursive: true });
  let master = await readSystemDemoManifest(dataDecksDir, DEMO_MASTER_DECK_ID);
  let seededMaster = false;

  if (!master) {
    const seedManifest = JSON.parse(await fs.promises.readFile(path.join(seedDir, "manifest.json"), "utf8"));
    if (!Array.isArray(seedManifest.slides) || !seedManifest.slides.length || seedManifest.conversion?.status !== "completed") {
      throw new Error("Invalid system Demo seed");
    }

    const targetDir = deckDirectory(dataDecksDir, DEMO_MASTER_DECK_ID);
    const nextDir = path.join(dataDecksDir, ".immersa-demo-seed-" + crypto.randomUUID());
    try {
      await fs.promises.cp(seedDir, nextDir, { recursive: true, errorOnExist: true });
      try {
        await fs.promises.rename(nextDir, targetDir);
        seededMaster = true;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    } finally {
      await fs.promises.rm(nextDir, { recursive: true, force: true }).catch(() => {});
    }
    master = await decorateMasterManifest(dataDecksDir);
  }

  const published = await readSystemDemoManifest(dataDecksDir, DEMO_PUBLISHED_DECK_ID);
  if (published) return { seededMaster, published: false, manifest: published };
  if (!seededMaster) return { seededMaster: false, published: false, manifest: null };

  return {
    seededMaster,
    published: true,
    manifest: await publishMasterDeck(dataDecksDir)
  };
}

async function decorateMasterManifest(dataDecksDir) {
  const deckDir = deckDirectory(dataDecksDir, DEMO_MASTER_DECK_ID);
  const manifestPath = path.join(deckDir, "manifest.json");
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const next = {
    ...manifest,
    deckId: DEMO_MASTER_DECK_ID,
    title: "Deck Demo Maestro",
    systemDemo: { role: "master", editableBy: "immersa-admin" },
    slides: (Array.isArray(manifest.slides) ? manifest.slides : []).map((slide) => ({
      ...slide,
      planLevel: normalizePlanLevel(slide.planLevel, { allowEmpty: true })
    }))
  };
  await fs.promises.writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n");
  return next;
}

async function updateMasterSlidePlan(dataDecksDir, slideId, planLevel) {
  const manifest = await readSystemDemoManifest(dataDecksDir, DEMO_MASTER_DECK_ID);
  if (!manifest) {
    const error = new Error("El Deck Demo Maestro todavía no existe");
    error.statusCode = 404;
    throw error;
  }
  const normalizedSlideId = String(slideId || "").trim();
  const normalizedLevel = normalizePlanLevel(planLevel);
  let found = false;
  manifest.slides = (Array.isArray(manifest.slides) ? manifest.slides : []).map((slide) => {
    if (String(slide.id) !== normalizedSlideId) return slide;
    found = true;
    return { ...slide, planLevel: normalizedLevel };
  });
  if (!found) {
    const error = new Error("Slide no encontrada");
    error.statusCode = 404;
    throw error;
  }
  manifest.updatedAt = new Date().toISOString();
  await fs.promises.writeFile(
    path.join(deckDirectory(dataDecksDir, DEMO_MASTER_DECK_ID), "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  return manifest;
}

async function collectSystemSessionIds(dataDecksDir) {
  const used = new Set();
  let entries = [];
  try {
    entries = await fs.promises.readdir(dataDecksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return used;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readSystemDemoManifest(dataDecksDir, entry.name).catch(() => null);
    const sessionId = manifestSessionId(manifest);
    if (sessionId) used.add(sessionId);
  }
  return used;
}

async function publishMasterDeck(dataDecksDir) {
  const master = await readSystemDemoManifest(dataDecksDir, DEMO_MASTER_DECK_ID);
  if (!master) {
    const error = new Error("El Deck Demo Maestro todavía no existe");
    error.statusCode = 404;
    throw error;
  }
  if (!Array.isArray(master.slides) || !master.slides.length || master.conversion?.status !== "completed") {
    const error = new Error("El Deck Demo Maestro todavía no está listo para publicar");
    error.statusCode = 409;
    throw error;
  }
  const unassigned = master.slides
    .filter((slide) => !DEMO_PLAN_LEVELS.includes(String(slide.planLevel || "")))
    .map((slide) => String(slide.id));
  if (unassigned.length) {
    const error = new Error("Asigna FREE, SPEAKER o SPEAKER PRO a todas las slides antes de publicar");
    error.statusCode = 409;
    error.code = "DEMO_SLIDE_LEVELS_REQUIRED";
    error.unassignedSlides = unassigned;
    throw error;
  }

  await fs.promises.mkdir(dataDecksDir, { recursive: true });
  const publishedDir = deckDirectory(dataDecksDir, DEMO_PUBLISHED_DECK_ID);
  const previousPublished = await readSystemDemoManifest(dataDecksDir, DEMO_PUBLISHED_DECK_ID);
  const usedSessionIds = await collectSystemSessionIds(dataDecksDir);
  const sessionId = manifestSessionId(previousPublished) || generateUniqueSessionId(usedSessionIds);
  const revision = crypto.randomUUID();
  const nextDir = path.join(dataDecksDir, ".immersa-demo-next-" + revision);
  const backupDir = path.join(dataDecksDir, ".immersa-demo-backup-" + revision);
  const publishedAt = new Date().toISOString();
  let backedUp = false;

  try {
    await fs.promises.cp(deckDirectory(dataDecksDir, DEMO_MASTER_DECK_ID), nextDir, { recursive: true, errorOnExist: true });
    const publishedManifest = {
      ...master,
      deckId: DEMO_PUBLISHED_DECK_ID,
      title: "Deck Demo IMMERSA",
      session_id: sessionId,
      updatedAt: publishedAt,
      systemDemo: {
        role: "published",
        masterDeckId: DEMO_MASTER_DECK_ID,
        publishedAt,
        revision
      }
    };
    delete publishedManifest.replacement;
    await fs.promises.writeFile(path.join(nextDir, "manifest.json"), JSON.stringify(publishedManifest, null, 2) + "\n");
    try {
      await fs.promises.rename(publishedDir, backupDir);
      backedUp = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.promises.rename(nextDir, publishedDir);
    if (backedUp) {
      await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      backedUp = false;
    }
    return publishedManifest;
  } catch (error) {
    if (backedUp) await fs.promises.rename(backupDir, publishedDir).catch(() => {});
    throw error;
  } finally {
    await fs.promises.rm(nextDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  DEMO_MASTER_DECK_ID,
  DEMO_PUBLISHED_DECK_ID,
  DEMO_PLAN_LEVELS,
  DEMO_SESSION_VISIBILITY_TTL_MS,
  adminEmails,
  isImmersaAdmin,
  demoSessionIdForAccount,
  createDemoSessionVisibilityStore,
  isSystemDemoDeckId,
  systemDemoRole,
  normalizePlanLevel,
  readSystemDemoManifest,
  seedSystemDemoDeck,
  decorateMasterManifest,
  updateMasterSlidePlan,
  publishMasterDeck
};
