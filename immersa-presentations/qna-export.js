const { QnaError } = require("./db/qna-repository");

function safeFilenamePart(value) {
  return String(value || "presentation")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "presentation";
}

function createQnaExportHandler({ runtime, logger = console } = {}) {
  if (!runtime) throw new Error("Q&A runtime is required");

  return async function exportQna(req, res) {
    if (!runtime.enabled || typeof runtime.exportCsv !== "function") {
      return res.status(404).json({ error: "Q&A export is not available" });
    }

    const access = req.immersaAccess;
    if (!access?.accessLink || !access?.deck) {
      return res.status(403).json({ error: "Access token required" });
    }

    try {
      const result = await runtime.exportCsv({
        deckId: access.deck.deckId,
        sourceSessionId: access.accessLink.session_id
      });
      const filename = [
        "immersa-qna",
        safeFilenamePart(result.deckId),
        safeFilenamePart(result.presentationSessionId)
      ].join("-") + ".csv";
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.type("text/csv; charset=utf-8").send(result.csv);
    } catch (error) {
      if (error instanceof QnaError && error.code === "QNA_SESSION_NOT_FOUND") {
        return res.status(404).json({ error: "Q&A session not found" });
      }
      logger.error("Unable to export Q&A", error);
      return res.status(503).json({ error: "Q&A export is not available" });
    }
  };
}

module.exports = { createQnaExportHandler, safeFilenamePart };
