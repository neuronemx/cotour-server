#!/usr/bin/env node
const { createBackup } = require("./deck-maintenance");

async function main() {
  const result = await createBackup();
  console.log("Respaldo creado en:");
  console.log(result.backupRoot);
  if (!result.copied.length) {
    console.log("No se encontraron decks ni metadata para respaldar.");
    return;
  }
  console.log("Elementos respaldados:");
  for (const item of result.copied) console.log("- " + item);
}

main().catch((error) => {
  console.error("No se pudo crear el respaldo:", error.message);
  process.exitCode = 1;
});
