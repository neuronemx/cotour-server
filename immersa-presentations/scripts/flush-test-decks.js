#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");
const { createBackup, findTestDecks, normalizeId, pruneMetadataReferences } = require("./deck-maintenance");

function hasFlag(name) {
  return process.argv.includes(name);
}

function askConfirmation() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Escribe "eliminar" para continuar: ', (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase() === "eliminar");
    });
  });
}

async function removeDecks(candidates) {
  for (const deck of candidates) {
    await fs.promises.rm(deck.dir, { recursive: true, force: true });
    console.log("Eliminado: " + deck.deckId + " (" + deck.source + ")");
  }
}

async function main() {
  const yes = hasFlag("--yes");
  const dryRun = hasFlag("--dry-run");
  const candidates = await findTestDecks();

  console.log("Estos decks serán eliminados:");
  if (!candidates.length) {
    console.log("- Ninguno");
    console.log("No hay decks claramente marcados como prueba.");
    return;
  }

  for (const deck of candidates) {
    console.log("- " + deck.deckId + " [" + deck.source + "] - " + deck.reason + " - " + deck.dir);
  }

  if (dryRun) {
    console.log("Modo dry-run: no se elimino nada.");
    return;
  }

  if (!yes) {
    const confirmed = await askConfirmation();
    if (!confirmed) {
      console.log("Cancelado. No se elimino nada.");
      return;
    }
  }

  const backup = await createBackup();
  console.log("Respaldo creado antes de borrar:");
  console.log(backup.backupRoot);

  await removeDecks(candidates);

  const deletedIds = new Set(candidates.map((deck) => normalizeId(deck.deckId)));
  const changedMetadata = await pruneMetadataReferences(deletedIds);
  if (changedMetadata.length) {
    console.log("Metadata actualizada para quitar referencias:");
    for (const file of changedMetadata) console.log("- " + file);
  } else {
    console.log("No se encontraron referencias en metadata para limpiar.");
  }

  console.log("Limpieza completada.");
}

main().catch((error) => {
  console.error("No se pudo limpiar decks de prueba:", error.message);
  process.exitCode = 1;
});
