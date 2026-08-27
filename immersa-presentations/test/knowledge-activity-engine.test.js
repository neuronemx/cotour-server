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
  stateForRole,
  COUNTDOWN_MS
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

test("contest defaults to fifteen seconds and cannot start without someone ready", () => {
  const item = createExecution({
    id: "execution-default-duration",
    presentationSessionId: "presentation-1",
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definition: definition("contest", { questionDurationSeconds: undefined }),
    nowMs: 1000,
    random: () => 0.999
  });
  assert.equal(item.definition.questionDurationSeconds, 15);
  assert.throws(() => controllerCommand(item, {
    commandId: "start-empty",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  }), { code: "NO_READY_PARTICIPANTS" });
  joinParticipant(item, { participantId: "ready", tabId: "tab-ready", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-ready",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  assert.equal(Date.parse(item.countdownDeadlineAt) - 2000, COUNTDOWN_MS);
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
  tickExecution(item, 7000);
  assert.deepEqual(stateForRole(item, { role: "presenter", nowMs: 7000 }).currentQuestion.image, image);
  assert.deepEqual(stateForRole(item, { role: "screen", nowMs: 7000 }).currentQuestion.image, image);
  assert.deepEqual(stateForRole(item, { role: "audience", participantId: participant.id, tabId: "tab-1", nowMs: 7000 }).currentQuestion.image, image);
});

test("Screen receives no possible answers and only gets the correct label during reveal", () => {
  const item = execution("contest");
  joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-screen-answer-contract",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 7000);
  const activeState = stateForRole(item, { role: "screen", nowMs: 7000 });
  assert.equal("options" in activeState.currentQuestion, false);
  assert.equal(activeState.reveal, null);

  const question = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[0]);
  tickExecution(item, 17000);
  const revealState = stateForRole(item, { role: "screen", nowMs: 17000 });
  assert.equal("options" in revealState.currentQuestion, false);
  assert.deepEqual(revealState.reveal, {
    correctLabel: question.options.find((option) => option.id === question.correctOptionId).label,
    responseCount: 0,
    correctCount: 0
  });
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
  tickExecution(item, 7000);
  const questionId = participant.questionOrder[0];
  const question = item.definition.questions.find((candidate) => candidate.id === questionId);
  submitAnswer(item, {
    participantId: "p1",
    questionId,
    optionId: question.options[0].id,
    tabId: "tab-1",
    nowMs: 8000
  });
  submitAnswer(item, {
    participantId: "p1",
    questionId,
    optionId: question.options[1].id,
    tabId: "tab-1",
    nowMs: 9000
  });
  assert.equal(item.answers.length, 1);
  assert.equal(item.answers[0].optionId, question.options[1].id);
  submitAssessment(item, { participantId: "p1", tabId: "tab-1", nowMs: 10000 });
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
  tickExecution(item, 7000);
  assert.equal(item.substate, "QUESTION_ACTIVE");
  const audienceState = stateForRole(item, {
    role: "audience",
    participantId: participant.id,
    tabId: "tab-1",
    nowMs: 7000
  });
  assert.equal(audienceState.questionIndex, 0);
  assert.equal(audienceState.questionCount, 2);
  const question = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[0]);
  submitAnswer(item, {
    participantId: participant.id,
    questionId: question.id,
    optionId: question.correctOptionId,
    tabId: "tab-1",
    nowMs: 8000
  });
  assert.throws(() => submitAnswer(item, {
    participantId: participant.id,
    questionId: question.id,
    optionId: question.correctOptionId,
    tabId: "tab-1",
    nowMs: 8500
  }), { code: "DUPLICATE" });
  tickExecution(item, 17000);
  assert.equal(item.substate, "REVEAL");
  assert.equal(item.questionDeadlineAt, null);
  tickExecution(item, 22000);
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
  tickExecution(item, 7000);
  const first = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[0]);
  submitAnswer(item, { participantId: "p1", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p1", nowMs: 8000 });
  submitAnswer(item, { participantId: "p2", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p2", nowMs: 9000 });
  submitAnswer(item, { participantId: "p3", questionId: first.id, optionId: first.correctOptionId, tabId: "tab-p3", nowMs: 9000 });
  submitAnswer(item, { participantId: "p4", questionId: first.id, optionId: first.options.find((option) => option.id !== first.correctOptionId).id, tabId: "tab-p4", nowMs: 7500 });
  tickExecution(item, 22000);
  const second = item.definition.questions.find((candidate) => candidate.id === item.questionOrder[1]);
  submitAnswer(item, { participantId: "p1", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p1", nowMs: 23000 });
  submitAnswer(item, { participantId: "p2", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p2", nowMs: 23000 });
  submitAnswer(item, { participantId: "p3", questionId: second.id, optionId: second.correctOptionId, tabId: "tab-p3", nowMs: 23000 });
  tickExecution(item, 32000);
  tickExecution(item, 40000);
  assert.equal(item.state, "RESULTS_VISIBLE");
  assert.deepEqual(item.result.rows.map((row) => row.position), [1, 2, 2, 4]);
  assert.equal(item.result.rows[0].participantId, "p1");
  const screenRows = stateForRole(item, { role: "screen", nowMs: 40000 }).top10;
  assert.equal(screenRows.length, 3);
  assert.equal(screenRows.some((row) => row.correctCount === 0), false);
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
  tickExecution(item, 7000);
  submitAnswer(item, { participantId: "partial", questionId: "q1", optionId: "a", tabId: "tab-partial", nowMs: 8000 });
  finalizeExecution(item, 9000);
  tickExecution(item, 12000);
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
  joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
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
    intent: "show_results",
    nowMs: 2200
  }), { code: "STALE_REVISION" });
});

test("cancel and finalize tolerate an automatic timer revision while confirmation is open", () => {
  for (const intent of ["cancel", "finalize"]) {
    const item = execution("contest");
    joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
    controllerCommand(item, {
      commandId: `start-${intent}`,
      expectedRevision: item.revision,
      actorRole: "presenter",
      intent: "start",
      nowMs: 2000
    });
    tickExecution(item, 6700);
    const revisionBeforeReveal = item.revision;
    tickExecution(item, 16700);
    assert.equal(item.substate, "REVEAL");
    assert.notEqual(item.revision, revisionBeforeReveal);
    controllerCommand(item, {
      commandId: `after-confirm-${intent}`,
      expectedRevision: revisionBeforeReveal,
      actorRole: "stage",
      intent,
      nowMs: 16800
    });
    assert.equal(item.state, intent === "cancel" ? "CANCELLED" : "PROCESSING");
  }
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
  tickExecution(item, 7000);
  submitAnswer(item, { participantId: "p1", questionId: "q1", optionId: "a", tabId: "tab-1", nowMs: 8000 });
  finalizeExecution(item, 9000);
  forceResults(item, { nowMs: 9001 });
  const retained = stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-1" });
  assert.equal(retained.personalResult, null);
  controllerCommand(item, {
    commandId: "show",
    expectedRevision: item.revision,
    actorRole: "stage",
    intent: "show_results",
    nowMs: 10000
  });
  const visible = stateForRole(item, { role: "audience", participantId: "p1", tabId: "tab-1" });
  assert.deepEqual(visible.personalResult, { grade: 50 });
  assert.equal(visible.questions.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(visible.personalResult, "answers"), false);
});

test("submitted assessments withhold the receipt grade until Speaker releases results", () => {
  const item = execution("assessment");
  joinParticipant(item, { participantId: "p1", tabId: "tab-1", name: "Arturo", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-receipt",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 7000);
  submitAnswer(item, { participantId: "p1", questionId: "q1", optionId: "a", tabId: "tab-1", nowMs: 8000 });
  submitAssessment(item, { participantId: "p1", tabId: "tab-1", nowMs: 8100 });

  const audience = stateForRole(item, {
    role: "audience",
    participantId: "p1",
    tabId: "tab-1",
    nowMs: 8200
  });
  assert.deepEqual(audience.submissionReceipt, {
    submittedAt: new Date(8100).toISOString(),
    answeredCount: 1,
    totalQuestions: 2
  });
  assert.equal(audience.personalResult, null);
  assert.equal(audience.questions.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(audience.submissionReceipt, "answers"), false);

  finalizeExecution(item, 9000);
  forceResults(item, { nowMs: 9001 });
  const ready = stateForRole(item, {
    role: "audience",
    participantId: "p1",
    tabId: "tab-1",
    nowMs: 9100
  });
  assert.equal(Object.prototype.hasOwnProperty.call(ready.submissionReceipt, "grade"), false);

  controllerCommand(item, {
    commandId: "show-receipt-grade",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "show_results",
    nowMs: 10000
  });
  const released = stateForRole(item, {
    role: "audience",
    participantId: "p1",
    tabId: "tab-1",
    nowMs: 10100
  });
  assert.equal(released.submissionReceipt.grade, 50);
});


test("controller progress state omits the participant roster while keeping contest progress", () => {
  const item = execution("contest");
  const first = joinParticipant(item, { participantId: "p1", tabId: "tab-1", random: () => 0.999 });
  joinParticipant(item, { participantId: "p2", tabId: "tab-2", random: () => 0.999 });
  controllerCommand(item, {
    commandId: "start-compact-progress",
    expectedRevision: item.revision,
    actorRole: "presenter",
    intent: "start",
    nowMs: 2000
  });
  tickExecution(item, 7000);
  submitAnswer(item, { participantId: first.id, questionId: "q1", optionId: "a", tabId: "tab-1", nowMs: 7100 });
  const progress = stateForRole(item, { role: "presenter", compact: true, nowMs: 7200 });
  assert.equal(progress.participantCount, 2);
  assert.equal(progress.effectiveParticipantCount, 1);
  assert.equal(progress.currentQuestion.id, "q1");
  assert.equal("participants" in progress, false);
  assert.equal("definitionsSnapshot" in progress, false);
});
