const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const PUBLIC_DECKS_DIR = path.join(APP_DIR, "public", "decks");
const DATA_DIR = process.env.IMMERSA_DATA_DIR
  ? path.resolve(process.env.IMMERSA_DATA_DIR)
  : path.join(APP_DIR, "data");
const DATA_DECKS_DIR = path.join(DATA_DIR, "decks");
const BACKUP_DIR = process.env.IMMERSA_BACKUP_DIR
  ? path.resolve(process.env.IMMERSA_BACKUP_DIR)
  : path.join(DATA_DIR, "backups");

const TEST_DECK_IDS = new Set(["demo", "demo01", "test", "sample", "bodilla-test"]);
const TEST_MARKERS = new Set(["test", "demo", "dev"]);
const METADATA_NAMES = new Set([
  "decks.json",
  "sessions.json",
  "uploads.json",
  "database.json",
  "db.json",
  "database.db",
  "database.sqlite",
  "database.sqlite3",
  "local.db",
  "local.sqlite",
  "local.sqlite3"
]);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeId(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function exists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

async function copyIfExists(source, destination) {
  if (!(await exists(source))) return false;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.cp(source, destination, { recursive: true, force: true, errorOnExist: false });
  return true;
}

async function listDirFiles(rootDir) {
  if (!(await exists(rootDir))) return [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(rootDir, entry.name));
}

function isMetadataFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return METADATA_NAMES.has(name) || /\.(sqlite|sqlite3|db)$/i.test(name);
}

async function findMetadataFiles() {
  const roots = [APP_DIR, DATA_DIR, path.join(APP_DIR, "public")];
  const files = [];
  for (const root of roots) {
    for (const file of await listDirFiles(root)) {
      if (isMetadataFile(file)) files.push(file);
    }
  }
  return [...new Set(files)];
}

async function createBackup() {
  const backupRoot = path.join(BACKUP_DIR, "decks-backup-" + timestamp());
  const copied = [];

  if (await copyIfExists(PUBLIC_DECKS_DIR, path.join(backupRoot, "public", "decks"))) {
    copied.push(PUBLIC_DECKS_DIR);
  }
  if (await copyIfExists(DATA_DECKS_DIR, path.join(backupRoot, "data", "decks"))) {
    copied.push(DATA_DECKS_DIR);
  }

  for (const metadataFile of await findMetadataFiles()) {
    const relative = path.relative(APP_DIR, metadataFile);
    const metadataTarget = relative.startsWith("..")
      ? path.join(backupRoot, "metadata", "external", path.basename(metadataFile))
      : path.join(backupRoot, "metadata", relative);
    if (await copyIfExists(metadataFile, metadataTarget)) copied.push(metadataFile);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    appDir: APP_DIR,
    dataDir: DATA_DIR,
    copied
  };
  await fs.promises.mkdir(backupRoot, { recursive: true });
  await fs.promises.writeFile(path.join(backupRoot, "backup-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { backupRoot, copied };
}

async function listDeckFolders(rootDir, source) {
  if (!(await exists(rootDir))) return [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ deckId: entry.name, normalizedDeckId: normalizeId(entry.name), dir: path.join(rootDir, entry.name), source }));
}

function valueHasMarker(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return TEST_MARKERS.has(normalizeId(value));
}

function manifestHasExplicitTestMarker(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  if (["isTest", "test", "isDemo", "demo", "isDev", "dev"].some((key) => valueHasMarker(manifest[key]))) return true;
  if (["environment", "env", "type", "kind", "purpose", "category"].some((key) => TEST_MARKERS.has(normalizeId(manifest[key])))) return true;
  if (Array.isArray(manifest.tags) && manifest.tags.some((tag) => TEST_MARKERS.has(normalizeId(tag)))) return true;
  if (manifest.metadata && typeof manifest.metadata === "object") return manifestHasExplicitTestMarker(manifest.metadata);
  return false;
}

async function findTestDecks() {
  const folders = [
    ...(await listDeckFolders(PUBLIC_DECKS_DIR, "public")),
    ...(await listDeckFolders(DATA_DECKS_DIR, "data"))
  ];
  const candidates = [];
  for (const folder of folders) {
    const manifest = await readJson(path.join(folder.dir, "manifest.json"));
    const manifestId = normalizeId(manifest?.deckId);
    const exactIdMatch = TEST_DECK_IDS.has(folder.normalizedDeckId) || TEST_DECK_IDS.has(manifestId);
    const metadataMatch = manifestHasExplicitTestMarker(manifest);
    if (!exactIdMatch && !metadataMatch) continue;
    candidates.push({
      ...folder,
      title: manifest?.title || folder.deckId,
      reason: exactIdMatch ? "id de prueba" : "metadata test/demo/dev"
    });
  }
  return candidates;
}

function referencesDeletedDeck(value, deletedIds) {
  if (!value || typeof value !== "object") return false;
  return ["deckId", "deck", "presentationId", "presentation", "id", "slug"].some((key) => {
    const field = value[key];
    return typeof field === "string" && deletedIds.has(normalizeId(field));
  });
}

function pruneJsonValue(value, deletedIds, isRoot = false) {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneJsonValue(item, deletedIds, false))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && deletedIds.has(normalizeId(value))) return null;
    return value;
  }

  if (!isRoot && referencesDeletedDeck(value, deletedIds)) return undefined;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (deletedIds.has(normalizeId(key))) continue;
    const pruned = pruneJsonValue(child, deletedIds, false);
    if (pruned !== undefined) next[key] = pruned;
  }
  return next;
}

async function pruneMetadataReferences(deletedIds) {
  const changed = [];
  for (const metadataFile of await findMetadataFiles()) {
    if (!/\.json$/i.test(metadataFile)) continue;
    const data = await readJson(metadataFile);
    if (!data) continue;
    const pruned = pruneJsonValue(data, deletedIds, true);
    if (JSON.stringify(data) === JSON.stringify(pruned)) continue;
    await fs.promises.writeFile(metadataFile, JSON.stringify(pruned, null, 2) + "\n");
    changed.push(metadataFile);
  }
  return changed;
}

module.exports = {
  APP_DIR,
  DATA_DIR,
  DATA_DECKS_DIR,
  PUBLIC_DECKS_DIR,
  BACKUP_DIR,
  TEST_DECK_IDS,
  createBackup,
  findTestDecks,
  normalizeId,
  pruneMetadataReferences
};
