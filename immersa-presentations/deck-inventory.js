const fs = require('node:fs');
const path = require('node:path');

async function readDeckInventory({ rootDir, seen, usedSessionIds, canPersistSessionId = false,
  allowDeck = async () => true, ensureManifestSessionId, manifestSummary }) {
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
    // Authorization precedes all manifest reads and legacy ID migration.
    if (!(await allowDeck(entry.name))) continue;
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


module.exports = { readDeckInventory };
