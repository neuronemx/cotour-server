#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { createBackup, DATA_DECKS_DIR, PUBLIC_DECKS_DIR, normalizeId, pruneMetadataReferences } = require("./deck-maintenance");

function hasFlag(name) {
  return process.argv.includes(name);
}

async function exists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listDecks(rootDir, source) {
  if (!(await exists(rootDir))) return [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ deckId: entry.name, dir: path.join(rootDir, entry.name), source }));
}

async function main() {
  if (!hasFlag("--yes")) {
    console.error("Este comando borra todos los decks actuales.");
    console.error("Ejecuta: npm run flush:decks -- --yes");
    process.exitCode = 1;
    return;
  }

  const decks = [
    ...(await listDecks(PUBLIC_DECKS_DIR, "public")),
    ...(await listDecks(DATA_DECKS_DIR, "data"))
  ];

  console.log("Estos decks serán eliminados:");
  if (!decks.length) {
    console.log("- Ninguno");
  } else {
    for (const deck of decks) console.log("- " + deck.deckId + " [" + deck.source + "] - " + deck.dir);
  }

  const backup = await createBackup();
  console.log("Respaldo creado antes de borrar:");
  console.log(backup.backupRoot);

  for (const deck of decks) {
    await fs.promises.rm(deck.dir, { recursive: true, force: true });
    console.log("Eliminado: " + deck.deckId + " (" + deck.source + ")");
  }

  const deletedIds = new Set(decks.map((deck) => normalizeId(deck.deckId)));
  const changedMetadata = await pruneMetadataReferences(deletedIds);
  if (changedMetadata.length) {
    console.log("Metadata actualizada para quitar referencias:");
    for (const file of changedMetadata) console.log("- " + file);
  } else {
    console.log("No se encontraron referencias en metadata para limpiar.");
  }

  console.log("Limpieza completa. Home no mostrará decks hasta que se suba una nueva presentación.");
}

main().catch((error) => {
  console.error("No se pudo limpiar todos los decks:", error.message);
  process.exitCode = 1;
});
