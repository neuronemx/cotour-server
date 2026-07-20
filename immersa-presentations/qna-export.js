function safeFilenamePart(value) {
  return String(value || "presentation")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "presentation";
}

function createQnaHistoryHandlers({ runtime, logger = console } = {}) {
  if (!runtime) throw new Error("Q&A runtime is required");

  async function listHistory(req, res) {
    if (!runtime.enabled || typeof runtime.listHistory !== "function") {
      return res.status(404).json({ error: "Q&A history is not available" });
    }
    try {
      const sessions = await runtime.listHistory({ deckId: req.params.deckId });
      return res.json({ deckId: req.params.deckId, sessions });
    } catch (error) {
      logger.error("Unable to list Q&A history", error);
      return res.status(503).json({ error: "Q&A history is not available" });
    }
  }

  async function exportDeck(req, res) {
    if (!runtime.enabled || typeof runtime.exportDeckCsv !== "function") {
      return res.status(404).json({ error: "Q&A export is not available" });
    }
    const access = req.immersaAccess;
    if (!access?.accessLink || !access?.deck) {
      return res.status(403).json({ error: "Access token required" });
    }
    try {
      const result = await runtime.exportDeckCsv({ deckId: access.deck.deckId });
      const filename = ["immersa-qna", safeFilenamePart(result.deckId)].join("-") + ".csv";
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.type("text/csv; charset=utf-8").send(result.csv);
    } catch (error) {
      logger.error("Unable to export Q&A", error);
      return res.status(503).json({ error: "Q&A export is not available" });
    }
  }

  async function clearHistory(req, res) {
    if (!runtime.enabled || typeof runtime.clearHistory !== "function") {
      return res.status(404).json({ error: "Q&A history is not available" });
    }
    const access = req.immersaAccess;
    if (!access?.accessLink || !access?.deck) {
      return res.status(403).json({ error: "Access token required" });
    }
    try {
      const result = await runtime.clearHistory({ deckId: access.deck.deckId });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (error) {
      logger.error("Unable to clear Q&A history", error);
      return res.status(503).json({ error: "Q&A history could not be deleted" });
    }
  }

  return { listHistory, exportDeck, clearHistory };
}

module.exports = { createQnaHistoryHandlers, safeFilenamePart };
