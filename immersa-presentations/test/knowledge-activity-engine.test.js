const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDefinition,
  createExecution,
  joinParticipant,
  claimParticipantTab,
  submitAnswer,
  submitAssessment,
  finalizeExecution,
  forceResults,
  tickExecution,
  controllerCommand,
  stateForRole
} = require("../knowledge-activity-engine");

function definition(category = "contest", overrides = {}) {
  return {
    id: `${category}-1`,
    category,
    title: category === "contest" ? "Concurso demo" : "Evaluación demo",
    identificationMode: "anonymous",
    questionDurationSeconds: 10,
    durationSeconds: 60,
    questions: [
      {
        id: "q1",
        prompt: "Primera",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" }
        ],
        correctOptionId: "a"
      },
      {
        id: "q2",
        prompt: "Segunda",
        options: [
          { id: "c", label: "C" },
          { id: "d", label: "D" }
        ],
        correctOptionId: "d"
      }
    ],
    ...overrides
  };
}

function execution(category = "contest", nowMs = 1000) {
  return createExecution({
    id: `execution-${category}`,
    presentationSessionId: "presentation-1",
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definition: definition(category),
    nowMs,
    random: () => 0.999
  });
}

test("definition requires one correct option and category-specific timing", () => {
  const contest = normalizeDefinition(definition("contest"));
  assert.equal(contest.questionDurationSeconds, 10);
  assert.equal(contest.durationSeconds, null);
  const assessment = normalizeDefinition(definition("assessment"));
  assert.equal(assessment.durationSeconds, 60);
  assert.equal(assessment.questionDurationSeconds, null);
  assert.throws(
    () => normalizeDefinition(definition("contest", {
      questions: [{ id: "bad", prompt: "Bad", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }]
    })),
    { code: "INVALID_DEFINITION" }
  );
});

test("optional question images survive normalization and role-specific snapshots", () => {
  const image = {
    url: "/decks/deck-1/knowledge-assets/question-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    mimeType: "image/jpeg",
    width: 1600,
    height: 900,
    sizeBytes: 120000
  };
  const item = createExecution({
    id: "execution-image",
    presentationSessionId: "presentation-1",
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definition: definition("contest", {
      questions: [{
        id: "q1",
        prompt: "Primera",
        image,
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        correctOptionId: "a"
      }]
    }),
    nowMs: 1000,
    random: () => 0.999
  });
  const participant = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-image",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  assert.deepEqual(stateForRole(item, { role: "presenter", nowMs: 5000 }).currentQuestion.image, image);
  assert.deepEqual(stateForRole(item, { role: "screen", nowMs: 5000 }).currentQuestion.image, image);
  assert.deepEqual(stateForRole(item, { role: "audience", participantId: participant.id, tabId: "tab-1", nowMs: 5000 }).currentQuestion.image, image);
});

test("contest uses a shared question order and individual option orders", () => {
  const item = execution("contest");
  const first = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0 });
  const second = joinParticipant(item, { participantId: "p2", tabId: "tab-2", random: () => 0.999 });
  assert.deepEqual(first.questionOrder, item.questionOrder);
  assert.deepEqual(second.questionOrder, item.questionOrder);
  assert.notDeepEqual(first.optionOrders, second.optionOrders);
  assert.equal(first.label, "Usuario 001");
  assert.equal(second.label, "Usuario 002");
});

test("assessment persists an individual question order and supports changed selections", () => {
  const item = execution("assessment");
  const participant = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0 });
  controllerCommand(item, {
    commandId: "start-1",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  const questionId = participant.questionOrder[0];
  const question = item.definition.questions.find((candidate) => candidate.id === questionId);
  submitAnswer(item, {
    participantId: "p1",
    questionId,
    optionId: question.options[0].id,
    tabId: "tab-1",
    nowMs: 6000
  });
  submitAnswer(item, {
    participantId: "p1",
    questionId,
    optionId: question.options[1].id,
    tabId: "tab-1",
    nowMs: 7000
  });
  assert.equal(item.answers.length, 1);
  assert.equal(item.answers[0].optionId, question.options[1].id);
  submitAssessment(item, { participantId: "p1", tabId: "tab-1", nowMs: 8000 });
  assert.equal(participant.state, "INCOMPLETE");
});

test("contest locks one answer and advances through reveal automatically", () => {
  const item = execution("contest");
  const participant = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-1",
    expectedRevision: item.revision,
    actorRole: "stage",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  assert.equal(item.substate, "QUESTION_ACTIVE");
  const audienceState = stateForRole(item, {
    role: "audience",
    participantId: participant.id,
    tabId: "tab-1",
    nowMs: 5000
  });
  assert.equal(audienceState.questionIndex, 0);
  assert.equal(audienceState.questionCount, 2);
  const question = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[0]);
  submitAnswer(item, {
    participantId: participant.id,
    questionId: question.id,
    optionId: question.correctOptionId,
    tabId: "tab-1",
    nowMs: 6000
  });
  assert.throws(() => submitAnswer(item, {
    participantId: participant.id,
    questionId: question.id,
    optionId: question.correctOptionId,
    tabId: "tab-1",
    nowMs: 6500
  }), { code: "DUPLICATE" });
  tickExecution(item, 15000);
  assert.equal(item.substate, "REVEAL");
  assert.equal(item.questionDeadlineAt, null);
  tickExecution(item, 20000);
  assert.equal(item.substate, "QUESTION_ACTIVE");
  assert.equal(item.questionIndex, 1);
});

test("ranking uses correct answers, correct-answer time, real ties, and competitive positions", () => {
  const item = execution("contest");
  for (const id of ["p1", "p2", "p3", "p4"]) joinParticipant(item, { participantId: id, tabId: `tab-${id}`, random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  const first = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[0]);
  submitAnswer(item, { participantId: "p1", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p1", nowMs: 6000 });
  submitAnswer(item, { participantId: "p2", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p2", nowMs: 7000 });
  submitAnswer(item, { participantId: "p3", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p3", nowMs: 7000 });
  submitAnswer(item, { participantId: "p4", questionId: first.id, optionId: first.options.find((option) => option.id !== first.correctOptionId).id, tabId: "tab-p4", nowMs: 5500 });
  tickExecution(item, 20000);
  const second = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[1]);
  submitAnswer(item, { participantId: "p1", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p1", nowMs: 21000 });
  submitAnswer(item, { participantId: "p2", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p2", nowMs: 21000 });
  submitAnswer(item, { participantId: "p3", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p3", nowMs: 21000 });
  tickExecution(item, 35000);
  tickExecution(item, 38000);
  assert.equal(item.state, "RESULTS_VISIBLE");
  assert.deepEqual(item.result.rows.map((row) => row.position), [1, 2, 2, 4]);
  assert.equal(item.result.rows[0].participantId, "p1");
});

test("zero answers are ignored and incomplete participation remains in results", () => {
  const item = execution("assessment");
  joinParticipant(item, { participantId: "zero", tabId: "tab-zero", random: () => 0.999 });
  joinParticipant(item, { participantId: "partial", tabId: "tab-partial", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  submitAnswer(item, { participantId: "partial", questionId: "q1", optionId: "a", tabId: "tab-partial", nowMs: 6000 });
  finalizeExecution(item, 7000);
  tickExecution(item, 10000);
  assert.equal(item.result.participantCount, 1);
  assert.equal(item.result.rows[0].participantId, "partial");
  assert.equal(item.result.rows[0].state, "INCOMPLETE");
  assert.equal(item.result.rows[0].grade, 50);
  assert.equal(item.result.rows[0].completionMode, "forced");
  assert.deepEqual(item.result.gradeDistribution, [
    { range: "0–59", count: 1 },
    { range: "60–69", count: 0 },
    { range: "70–79", count: 0 },
    { range: "80–89", count: 0 },
    { range: "90–100", count: 0 }
  ]);
});

test("controller commands are revision checked and idempotent across Speaker and Stage", () => {
  const item = execution("assessment");
  const expectedRevision = item.revision;
  const first = controllerCommand(item, {
    commandId: "same-command",
    expectedRevision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  const second = controllerCommand(item, {
    commandId: "same-command",
    expectedRevision,
    actorRole: "stage",
    intent: "cancel",
    nowMs: 2100
  });
  assert.deepEqual(second, first);
  assert.equal(item.state, "COUNTDOWN");
  assert.throws(() => controllerCommand(item, {
    commandId: "stale",
    expectedRevision,
    actorRole: "stage",
    intent: "cancel",
    nowMs: 2200
  }), { code: "STALE_REVISION" });
});

test("active tab follows the WhatsApp Web transfer rule", () => {
  const item = execution("contest");
  const participant = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  assert.equal(stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-2" }).participant.tabActive, false);
  claimParticipantTab(item, { participantId: "p1", tabId: "tab-2", nowMs: 1500 });
  assert.equal(participant.activeTabId, "tab-2");
  assert.equal(stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-1" }).participant.tabActive, false);
});

test("forced results exclude damaged responses and report only the operational count", () => {
  const item = execution("assessment");
  joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  item.state = "PROCESSING_ERROR";
  item.answers = [
    {
      participantId: "p1",
      questionId: "q1",
      optionId: "a",
      correct: true,
      receivedAt: "2026-07-26T00:00:00.000Z",
      elapsedMs: null
    },
    {
      participantId: "p1",
      questionId: "missing",
      optionId: "bad",
      correct: false,
      receivedAt: "damaged",
      elapsedMs: null
    }
  ];
  const result = forceResults(item, { nowMs: 9000 });
  assert.equal(result.mode, "forced");
  assert.equal(result.excludedResponseCount, 1);
  assert.equal(result.participantCount, 1);
});

test("role payloads keep assessment answers private and expose only released grade", () => {
  const item = execution("assessment");
  joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 5000);
  submitAnswer(item, { participantId: "p1", questionId: "q1", optionId: "a", tabId: "tab-1", nowMs: 6000 });
  finalizeExecution(item, 7000);
  forceResults(item, { nowMs: 7001 });
  const retained = stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-1" });
  assert.equal(retained.personalResult, null);
  controllerCommand(item, {
    commandId: "show",
    expectedRevision: item.revision,
    actorRole: "stage",
    intent: "show_results",
    nowMs: 8000
  });
  const visible = stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-1" });
  assert.deepEqual(visible.personalResult, { grade: 50 });
  assert.equal(visible.questions.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(visible.personalResult, "answers"), false);
});
