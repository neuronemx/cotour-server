const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resultCsv,
  historySummary
} = require("../knowledge-activity-export");

function execution(category = "assessment") {
  return {
    id: "exec-1",
    deckId: "deck-1",
    category,
    title: "Prueba",
    state: "RESULTS_READY",
    openedAt: "2026-07-26T00:00:00.000Z",
    participants: [{ id: "p1" }, { id: "p0" }],
    answers: [{ participantId: "p1" }],
    definition: {
      questions: [{
        id: "q1",
        prompt: "Capital de México",
        options: [{ id: "a", label: "Ciudad de México" }]
      }]
    },
    result: {
      participantCount: 1,
      rows: [{
        participantId: "p1",
        label: "Usuario 001",
        state: "INCOMPLETE",
        correctCount: 1,
        incorrectCount: 0,
        omittedCount: 0,
        grade: 100,
        position: 1,
        correctTimeMs: 1250,
        timeUsedMs: 31000,
        answers: [{ questionId: "q1", optionId: "a", correct: true }]
      }]
    }
  };
}

test("assessment CSV includes valid participants and their answers without operational warnings", () => {
  const csv = resultCsv(execution());
  assert.match(csv, /Calificación,Tiempo utilizado \(s\),Participante,Estado/);
  assert.match(csv, /Usuario 001,Incompleto,1,0,0,Ciudad de México — Correcta/);
  assert.doesNotMatch(csv, /excluid|procesamiento/i);
});

test("contest CSV exports only Top 10 and formats time in seconds", () => {
  const value = execution("contest");
  value.result.top10 = [{
    position: 1,
    label: "Usuario 001",
    correctCount: 1,
    totalQuestions: 1,
    correctTimeMs: 1250
  }];
  value.result.rows.push({
    position: 11,
    label: "Usuario 011",
    correctCount: 0,
    totalQuestions: 1,
    correctTimeMs: 9000
  });
  const csv = resultCsv(value);
  assert.match(csv, /Posición,Participante,Aciertos,Total,Tiempo de respuestas correctas \(s\)/);
  assert.match(csv, /1,Usuario 001,1,1,1\.25/);
  assert.doesNotMatch(csv, /Usuario 011/);
  assert.doesNotMatch(csv, /Capital de México/);
});

test("history summary does not expose participant names or answer payloads", () => {
  const summary = historySummary(execution("contest"));
  assert.equal(summary.participantCount, 1);
  assert.equal(summary.category, "contest");
  assert.equal("participants" in summary, false);
  assert.equal("answers" in summary, false);
});
