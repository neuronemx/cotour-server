const { safeFilenamePart } = require("./qna-export");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function answerLabel(execution, answer) {
  const question = execution.definition.questions.find((item) => item.id === answer?.questionId);
  return question?.options.find((option) => option.id === answer?.optionId)?.label || "Omitida";
}

function resultCsv(execution) {
  const result = execution?.result;
  if (!result) {
    const error = new Error("Results are not ready");
    error.statusCode = 409;
    throw error;
  }
  const questions = execution.definition.questions;
  if (execution.category === "contest") {
    const headers = [
      "Posición",
      "Participante",
      "Aciertos",
      "Total",
      "Tiempo de respuestas correctas (s)"
    ];
    const rows = (result.top10 || []).map((row) => [
      row.position,
      row.label,
      row.correctCount,
      row.totalQuestions,
      (row.correctTimeMs / 1000).toFixed(2)
    ]);
    return "\uFEFF" + [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
  }
  const questionHeaders = questions.map((question, index) => `P${index + 1}: ${question.prompt}`);
  const headers = [
    "Calificación",
    "Tiempo utilizado (s)",
    "Participante",
    "Estado",
    "Aciertos",
    "Incorrectas",
    "Omitidas",
    ...questionHeaders
  ];
  const rows = result.rows.map((row) => {
    const byQuestion = new Map((row.answers || []).map((answer) => [answer.questionId, answer]));
    return [
      row.grade,
      (row.timeUsedMs / 1000).toFixed(2),
      row.label,
      row.state === "COMPLETED" ? "Completo" : "Incompleto",
      row.correctCount,
      row.incorrectCount,
      row.omittedCount,
      ...questions.map((question) => {
        const answer = byQuestion.get(question.id);
        return answer ? `${answerLabel(execution, answer)} — ${answer.correct ? "Correcta" : "Incorrecta"}` : "Omitida";
      })
    ];
  });
  return "\uFEFF" + [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

function historySummary(execution) {
  return {
    executionId: execution.id,
    category: execution.category,
    title: execution.title,
    state: execution.state,
    openedAt: execution.openedAt,
    startedAt: execution.startedAt,
    finalizedAt: execution.finalizedAt,
    closedAt: execution.closedAt,
    participantCount: execution.result?.participantCount
      ?? execution.participants.filter((participant) => execution.answers.some((answer) => answer.participantId === participant.id)).length,
    resultsReady: Boolean(execution.result)
  };
}

function createKnowledgeActivityHistoryHandlers({ runtime, logger = console } = {}) {
  if (!runtime) throw new Error("Knowledge activity runtime is required");

  async function listHistory(req, res) {
    if (!runtime.enabled) return res.status(404).json({ error: "Activity history is not available" });
    try {
      const executions = await runtime.listHistory({ deckId: req.params.deckId });
      return res.json({
        deckId: req.params.deckId,
        executions: executions.map(historySummary)
      });
    } catch (error) {
      logger.error("Unable to list activity history", error);
      return res.status(503).json({ error: "Activity history is not available" });
    }
  }

  async function exportExecution(req, res) {
    if (!runtime.enabled || !runtime.repository?.loadExecution) {
      return res.status(404).json({ error: "Activity export is not available" });
    }
    const access = req.immersaAccess;
    if (!access?.accessLink || !access?.deck) return res.status(403).json({ error: "Access token required" });
    try {
      const execution = await runtime.repository.loadExecution(req.params.executionId);
      if (!execution || String(execution.deckId) !== String(access.deck.deckId)) {
        return res.status(404).json({ error: "Activity execution not found" });
      }
      const filename = [
        "immersa",
        execution.category === "contest" ? "concurso" : "evaluacion",
        safeFilenamePart(execution.title),
        safeFilenamePart(execution.id)
      ].join("-") + ".csv";
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.type("text/csv; charset=utf-8").send(resultCsv(execution));
    } catch (error) {
      const status = error.statusCode || 503;
      logger.error("Unable to export activity results", error);
      return res.status(status).json({ error: status === 409 ? error.message : "Activity export is not available" });
    }
  }

  return { listHistory, exportExecution };
}

module.exports = {
  csvCell,
  resultCsv,
  historySummary,
  createKnowledgeActivityHistoryHandlers
};
