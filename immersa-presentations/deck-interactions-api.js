const path = require("path");
const fs = require("fs");

function createDeckInteractionHandlers({ dataDecksDir, staticDecksDir }) {
  function normalizeDeckId(deckId) {
    const normalized = String(deckId || "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalized)) {
      const error = new Error("Invalid deck id");
      error.statusCode = 400;
      throw error;
    }
    return normalized;
  }

  async function findDeckDir(deckId) {
    const normalizedDeckId = normalizeDeckId(deckId);
    const candidates = [path.join(dataDecksDir, normalizedDeckId), path.join(staticDecksDir, normalizedDeckId)];
    for (const candidate of candidates) {
      try {
        await fs.promises