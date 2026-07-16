const path = require("path");
const fs = require("fs");

function createDeckInteractionHandlers({ dataDecksDir, staticDecksDir }) {
  function normalizeDeckId(value) {
    const deckId = String(value || "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(deckId)) {
      const error = new Error("Invalid deck id");
      error.statusCode = 400;
      throw error;
