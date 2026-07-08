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
        await fs.promises.access(path.join(candidate, "manifest.json"), fs.constants.R_OK);
        return { deckId: normalizedDeckId, deckDir: candidate };
      } catch (_error) {
        // Try the next storage location.
      }
    }
    const error = new Error("Deck not found");
    error.statusCode = 404;
    throw error;
  }

  function parseInteractions(content) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.interactions)) return parsed.interactions;
    return [];
  }

  async function readInteractions(deckId) {
    const normalizedDeckId = normalizeDeckId(deckId);
    const candidates = [
      path.join(dataDecksDir, normalizedDeckId, "interactions.json"),
      path.join(staticDecksDir, normalizedDeckId, "interactions.json")
    ];

    for (const interactionPath of candidates) {
      try {
        const interactions = parseInteractions(await fs.promises.readFile(interactionPath, "utf8"));
        return { deck_id: normalizedDeckId, interactions };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return { deck_id: normalizedDeckId, interactions: [] };
  }

  function optionId(index) {
    return "opt_" + String.fromCharCode(97 + index);
  }

  function normalizeInteraction(interaction, index) {
    const prompt = String(interaction?.prompt || "").trim();
    if (!prompt) {
      const error = new Error("Interaction prompt is required");
      error.statusCode = 400;
      throw error;
    }

    const options = Array.isArray(interaction?.options)
      ? interaction.options
          .map((option, optionIndex) => ({
            id: String(option?.id || optionId(optionIndex)).trim() || optionId(optionIndex),
            label: String(option?.label || "").trim()
          }))
          .filter((option) => option.label)
      : [];

    if (options.length < 2) {
      const error = new Error("Poll interactions require at least two options");
      error.statusCode = 400;
      throw error;
    }

    const settings = interaction?.settings || {};
    return {
      id: String(interaction?.id || "int_" + Date.now() + "_" + index).trim(),
      slide_id: interaction?.slide_id || null,
      type: "poll",
      title: String(interaction?.title || prompt).trim() || prompt,
      prompt,
      options,
      settings: {
        allow_multiple: Boolean(settings.allow_multiple),
        anonymous: typeof settings.anonymous === "boolean" ? settings.anonymous : true,
        timer_seconds: Number.isFinite(Number(settings.timer_seconds)) ? Number(settings.timer_seconds) : null,
        correct_option_ids: Array.isArray(settings.correct_option_ids) ? settings.correct_option_ids.map(String) : [],
        points: Number.isFinite(Number(settings.points)) ? Number(settings.points) : 0
      }
    };
  }

  function normalizePayload(deckId, body) {
    const normalizedDeckId = normalizeDeckId(deckId);
    if (!body || !Array.isArray(body.interactions)) {
      const error = new Error("interactions array is required");
      error.statusCode = 400;
      throw error;
    }
    return {
      deck_id: normalizedDeckId,
      interactions: body.interactions.map(normalizeInteraction)
    };
  }

  async function getInteractions(req, res) {
    try {
      normalizeDeckId(req.params.deckId);
      res.json(await readInteractions(req.params.deckId));
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) console.error("Unable to read deck interactions", error);
      res.status(statusCode).json({ error: error.message || "Unable to read interactions" });
    }
  }

  async function putInteractions(req, res) {
    try {
      const payload = normalizePayload(req.params.deckId, req.body);
      const { deckDir } = await findDeckDir(req.params.deckId);
      await fs.promises.writeFile(path.join(deckDir, "interactions.json"), JSON.stringify(payload, null, 2) + "\n");
      res.json(payload);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) console.error("Unable to save deck interactions", error);
      res.status(statusCode).json({ error: error.message || "Unable to save interactions" });
    }
  }

  return { getInteractions, putInteractions };
}

module.exports = { createDeckInteractionHandlers };
