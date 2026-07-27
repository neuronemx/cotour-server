const { randomUUID } = require("node:crypto");

const CATEGORIES = new Set(["contest", "assessment"]);
const IDENTIFICATION_MODES = new Set(["anonymous", "optional_name", "required_name"]);
const TERMINAL_STATES = new Set(["CANCELLED", "CLOSED"]);
const CONTROL_ROLES = new Set(["presenter", "stage"]);
const CONTRACT_VERSION = "knowledge-activities-v1";
const COUNTDOWN_MS = 4700;
const REVEAL_MS = 5000;
const RECONCILIATION_MS = 3000;
const PROCESSING_LIMIT_MS = 10000;

class KnowledgeActivityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KnowledgeActivityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new KnowledgeActivityError(code, message);
}

function text(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function finiteInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function iso(nowMs) {
  return new Date(nowMs).toISOString();
}

function epoch(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shuffled(values, random = Math.random) {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function normalizeOption(option, index) {
  const label = text(option?.label, 500);
  if (!label) fail("INVALID_DEFINITION", "Every option requires a label");
  return {
    id: text(option?.id, 96) || `option-${index + 1}`,
    label,
    correct: Boolean(option?.correct)
  };
}

function normalizeQuestionImage(image) {
  if (!image) return null;
  const url = text(image.url || image.src, 1000);
  if (!/^\/decks\/[a-z0-9%_-]+\/knowledge-assets\/question-[a-f0-9]{24}\.(?:png|jpg|webp)$/i.test(url)) {
    fail("INVALID_DEFINITION", "Question image reference is invalid");
  }
  return {
    url,
    mimeType: text(image.mimeType || image.mime_type, 64),
    width: finiteInteger(image.width, 0, 0, 4096),
    height: finiteInteger(image.height, 0, 0, 4096),
    sizeBytes: finiteInteger(image.sizeBytes || image.size_bytes, 0, 0, 5 * 1024 * 1024)
  };
}

function normalizeQuestion(question, index) {
  const prompt = text(question?.prompt, 2000);
  if (!prompt) fail("INVALID_DEFINITION", "Every question requires a prompt");
  const options = Array.isArray(question?.options)
    ? question.options.map(normalizeOption)
    : [];
  if (options.length < 2 || options.length > 6) {
    fail("INVALID_DEFINITION", "Every question requires between two and six options");
  }
  const optionIds = new Set();
  for (const option of options) {
    if (optionIds.has(option.id)) fail("INVALID_DEFINITION", "Option ids must be unique inside a question");
    optionIds.add(option.id);
  }
  const explicitCorrectId = text(question?.correctOptionId, 96);
  const markedCorrect = options.filter((option) => option.correct).map((option) => option.id);
  const correctOptionId = explicitCorrectId || (markedCorrect.length === 1 ? markedCorrect[0] : "");
  if (!correctOptionId || !optionIds.has(correctOptionId) || (markedCorrect.length > 1)) {
    fail("INVALID_DEFINITION", "Every question requires one unambiguous correct option");
  }
  return {
    id: text(question?.id, 96) || `question-${index + 1}`,
    prompt,
    image: normalizeQuestionImage(question?.image),
    options: options.map(({ correct, ...option }) => option),
    correctOptionId
  };
}

function normalizeDefinition(definition) {
  const category = text(definition?.category, 32).toLowerCase();
  if (!CATEGORIES.has(category)) fail("INVALID_DEFINITION", "Category must be contest or assessment");
  const title = text(definition?.title, 240);
  if (!title) fail("INVALID_DEFINITION", "Activity title is required");
  const identificationMode = text(definition?.identificationMode, 32) || "anonymous";
  if (!IDENTIFICATION_MODES.has(identificationMode)) {
    fail("INVALID_DEFINITION", "Invalid identification mode");
  }
  const questions = Array.isArray(definition?.questions)
    ? definition.questions.map(normalizeQuestion)
    : [];
  if (!questions.length || questions.length > 100) {
    fail("INVALID_DEFINITION", "An activity requires between one and one hundred questions");
  }
  const questionIds = new Set();
  for (const question of questions) {
    if (questionIds.has(question.id)) fail("INVALID_DEFINITION", "Question ids must be unique");
    questionIds.add(question.id);
  }
  return {
    id: text(definition?.id, 96) || randomUUID(),
    category,
    title,
    identificationMode,
    questionDurationSeconds: category === "contest"
      ? finiteInteger(definition?.questionDurationSeconds, 15, 5, 300)
      : null,
    durationSeconds: category === "assessment"
      ? finiteInteger(definition?.durationSeconds, 900, 30, 10800)
      : null,
    questions,
    createdAt: definition?.createdAt || null,
    updatedAt: definition?.updatedAt || null
  };
}

function touch(execution, nowMs) {
  execution.revision += 1;
  execution.updatedAt = iso(nowMs);
  return execution;
}

function currentQuestion(execution) {
  if (execution.category !== "contest") return null;
  const questionId = execution.questionOrder[execution.questionIndex];
  return execution.definition.questions.find((question) => question.id === questionId) || null;
}

function participantAnswers(execution, participantId) {
  return execution.answers.filter((answer) => answer.participantId === participantId);
}

function participantById(execution, participantId) {
  return execution.participants.find((participant) => participant.id === participantId) || null;
}

function optionOrderFor(execution, participant, questionId) {
  return participant.optionOrders[questionId]
    || execution.definition.questions.find((question) => question.id === questionId)?.options.map((option) => option.id)
    || [];
}

function questionForParticipant(execution, participant, questionId) {
  const question = execution.definition.questions.find((item) => item.id === questionId);
  if (!question) return null;
  const options = optionOrderFor(execution, participant, questionId)
    .map((optionId) => question.options.find((option) => option.id === optionId))
    .filter(Boolean);
  return { id: question.id, prompt: question.prompt, image: clone(question.image), options };
}

function createExecution({
  id = randomUUID(),
  presentationSessionId,
  sourceSessionId,
  deckId,
  definition,
  nowMs = Date.now(),
  random = Math.random
}) {
  const normalized = normalizeDefinition(definition);
  const questionOrder = normalized.category === "contest"
    ? shuffled(normalized.questions.map((question) => question.id), random)
    : normalized.questions.map((question) => question.id);
  return {
    id: text(id, 96),
    presentationSessionId: text(presentationSessionId, 96),
    sourceSessionId: text(sourceSessionId, 191),
    deckId: text(deckId, 191),
    definitionId: normalized.id,
    contractVersion: CONTRACT_VERSION,
    category: normalized.category,
    title: normalized.title,
    state: "LOBBY",
    substate: null,
    revision: 1,
    definition: clone(normalized),
    questionOrder,
    questionIndex: -1,
    questionOpenedAt: null,
    questionDeadlineAt: null,
    revealDeadlineAt: null,
    countdownDeadlineAt: null,
    deadlineAt: null,
    processingStartedAt: null,
    processingReadyAt: null,
    processingDeadlineAt: null,
    resultsReadyAt: null,
    resultsVisibleAt: null,
    openedAt: iso(nowMs),
    startedAt: null,
    finalizedAt: null,
    finalizationMode: null,
    closedAt: null,
    cancelledAt: null,
    updatedAt: iso(nowMs),
    resultsVisible: false,
    result: null,
    participants: [],
    answers: [],
    commandLog: []
  };
}

function nextUserNumber(execution) {
  return execution.participants.reduce((maximum, participant) => Math.max(maximum, participant.userNumber || 0), 0) + 1;
}

function joinParticipant(execution, {
  participantId = randomUUID(),
  name = "",
  tabId = "",
  recoveryTokenHash = "",
  nowMs = Date.now(),
  random = Math.random
}) {
  const normalizedName = text(name, 120);
  const id = text(participantId, 96);
  let participant = participantById(execution, id);
  if (participant) {
    if (!participant.recoveryTokenHash && text(recoveryTokenHash, 64)) {
      participant.recoveryTokenHash = text(recoveryTokenHash, 64);
    }
    participant.activeTabId = text(tabId, 96) || participant.activeTabId;
    participant.connected = true;
    participant.lastSeenAt = iso(nowMs);
    touch(execution, nowMs);
    return participant;
  }
  if (execution.state !== "LOBBY") fail("INVALID_STATE", "Admission is closed");
  if (execution.definition.identificationMode === "required_name" && !normalizedName) {
    fail("INVALID_NAME", "A name is required");
  }
  const questionOrder = execution.category === "assessment"
    ? shuffled(execution.definition.questions.map((question) => question.id), random)
    : execution.questionOrder.slice();
  const optionOrders = {};
  for (const question of execution.definition.questions) {
    optionOrders[question.id] = shuffled(question.options.map((option) => option.id), random);
  }
  participant = {
    id,
    name: normalizedName,
    label: normalizedName || `Usuario ${String(nextUserNumber(execution)).padStart(3, "0")}`,
    userNumber: nextUserNumber(execution),
    state: "PENDING",
    connected: true,
    activeTabId: text(tabId, 96),
    recoveryTokenHash: text(recoveryTokenHash, 64) || null,
    questionOrder,
    optionOrders,
    currentQuestionIndex: 0,
    joinedAt: iso(nowMs),
    lastSeenAt: iso(nowMs),
    submittedAt: null,
    completedAt: null,
    completionMode: null
  };
  execution.participants.push(participant);
  touch(execution, nowMs);
  return participant;
}

function claimParticipantTab(execution, { participantId, tabId, nowMs = Date.now() }) {
  const participant = participantById(execution, participantId);
  if (!participant) fail("PARTICIPANT_NOT_FOUND", "Participant was not found");
  participant.activeTabId = text(tabId, 96);
  participant.lastSeenAt = iso(nowMs);
  touch(execution, nowMs);
  return participant;
}

function ensureActiveTab(participant, tabId) {
  const normalizedTabId = text(tabId, 96);
  if (participant.activeTabId && normalizedTabId !== participant.activeTabId) {
    fail("TAB_NOT_ACTIVE", "The activity is open in another tab");
  }
}

function startExecution(execution, nowMs = Date.now()) {
  if (execution.state !== "LOBBY") fail("INVALID_STATE", "Only a lobby can be started");
  if (!execution.participants.length) {
    fail("NO_READY_PARTICIPANTS", "Necesitas al menos una persona lista para iniciar.");
  }
  execution.state = "COUNTDOWN";
  execution.substate = null;
  execution.startedAt = iso(nowMs);
  execution.countdownDeadlineAt = iso(nowMs + COUNTDOWN_MS);
  touch(execution, nowMs);
  return execution;
}

function beginActive(execution, nowMs) {
  execution.state = "ACTIVE";
  execution.countdownDeadlineAt = null;
  if (execution.category === "contest") {
    execution.questionIndex = 0;
    execution.substate = "QUESTION_ACTIVE";
    execution.questionOpenedAt = iso(nowMs);
    execution.questionDeadlineAt = iso(nowMs + execution.definition.questionDurationSeconds * 1000);
  } else {
    execution.substate = null;
    execution.deadlineAt = iso(nowMs + execution.definition.durationSeconds * 1000);
  }
  touch(execution, nowMs);
}

function beginProcessing(execution, nowMs, finalizedAt = nowMs, finalizationMode = "deadline") {
  execution.state = "PROCESSING";
  execution.substate = null;
  execution.finalizedAt = execution.finalizedAt || iso(finalizedAt);
  execution.finalizationMode = execution.finalizationMode || finalizationMode;
  execution.questionDeadlineAt = null;
  execution.revealDeadlineAt = null;
  execution.deadlineAt = null;
  execution.processingStartedAt = iso(nowMs);
  execution.processingReadyAt = iso(nowMs + RECONCILIATION_MS);
  execution.processingDeadlineAt = iso(nowMs + PROCESSING_LIMIT_MS);
  touch(execution, nowMs);
}

function submitAnswer(execution, {
  participantId,
  questionId,
  optionId,
  tabId = "",
  clientAttemptId = "",
  nowMs = Date.now()
}) {
  if (execution.state !== "ACTIVE") fail("INVALID_STATE", "The activity is not accepting answers");
  const participant = participantById(execution, participantId);
  if (!participant) fail("PARTICIPANT_NOT_FOUND", "Participant was not found");
  ensureActiveTab(participant, tabId);
  if (participant.submittedAt) fail("INVALID_STATE", "The assessment was already submitted");
  const question = execution.definition.questions.find((item) => item.id === questionId);
  if (!question) fail("QUESTION_NOT_FOUND", "Question was not found");
  if (!question.options.some((option) => option.id === optionId)) fail("OPTION_NOT_FOUND", "Option was not found");
  if (execution.category === "contest") {
    const activeQuestion = currentQuestion(execution);
    if (execution.substate !== "QUESTION_ACTIVE" || activeQuestion?.id !== questionId) {
      fail("INVALID_STATE", "That contest question is not active");
    }
    if (nowMs >= epoch(execution.questionDeadlineAt)) fail("DEADLINE_PASSED", "The question deadline passed");
    if (execution.answers.some((answer) => answer.participantId === participant.id && answer.questionId === questionId)) {
      fail("DUPLICATE", "The contest answer was already confirmed");
    }
  } else if (nowMs >= epoch(execution.deadlineAt)) {
    fail("DEADLINE_PASSED", "The assessment deadline passed");
  }
  const correct = optionId === question.correctOptionId;
  const answer = {
    participantId: participant.id,
    questionId,
    optionId,
    correct,
    receivedAt: iso(nowMs),
    elapsedMs: execution.category === "contest"
      ? Math.max(0, nowMs - epoch(execution.questionOpenedAt))
      : null,
    clientAttemptId: text(clientAttemptId, 96)
  };
  const existingIndex = execution.answers.findIndex((item) =>
    item.participantId === participant.id && item.questionId === questionId
  );
  if (existingIndex >= 0) execution.answers[existingIndex] = answer;
  else execution.answers.push(answer);
  participant.state = "ACTIVE";
  participant.lastSeenAt = iso(nowMs);
  const answered = participantAnswers(execution, participant.id).length;
  if (execution.category === "assessment") {
    const orderIndex = participant.questionOrder.indexOf(questionId);
    if (orderIndex >= 0) participant.currentQuestionIndex = orderIndex;
  }
  if (answered === execution.definition.questions.length) {
    participant.completedAt = iso(nowMs);
    if (execution.category === "contest") participant.state = "COMPLETED";
  }
  touch(execution, nowMs);
  return answer;
}

function submitAssessment(execution, { participantId, tabId = "", nowMs = Date.now() }) {
  if (execution.category !== "assessment" || execution.state !== "ACTIVE") {
    fail("INVALID_STATE", "The assessment cannot be submitted");
  }
  if (nowMs >= epoch(execution.deadlineAt)) fail("DEADLINE_PASSED", "The assessment deadline passed");
  const participant = participantById(execution, participantId);
  if (!participant) fail("PARTICIPANT_NOT_FOUND", "Participant was not found");
  ensureActiveTab(participant, tabId);
  const answers = participantAnswers(execution, participant.id);
  if (!answers.length) fail("NO_CONFIRMED_ANSWERS", "At least one confirmed answer is required");
  participant.submittedAt = iso(nowMs);
  participant.completedAt = iso(nowMs);
  participant.completionMode = "early";
  participant.state = answers.length === execution.definition.questions.length ? "COMPLETED" : "INCOMPLETE";
  touch(execution, nowMs);
  return participant;
}

function rankContestRows(rows) {
  rows.sort((left, right) =>
    right.correctCount - left.correctCount
    || left.correctTimeMs - right.correctTimeMs
    || epoch(left.completedAt) - epoch(right.completedAt)
    || left.label.localeCompare(right.label, "es")
  );
  let previous = null;
  rows.forEach((row, index) => {
    const tied = previous
      && row.correctCount === previous.correctCount
      && row.correctTimeMs === previous.correctTimeMs;
    row.position = tied ? previous.position : index + 1;
    previous = row;
  });
  return rows;
}

function questionStatistics(execution, effectiveParticipants) {
  return execution.definition.questions.map((question) => {
    const answers = execution.answers.filter((answer) => answer.questionId === question.id
      && effectiveParticipants.some((participant) => participant.id === answer.participantId));
    const correct = answers.filter((answer) => answer.correct).length;
    return {
      questionId: question.id,
      prompt: question.prompt,
      correct,
      incorrect: answers.length - correct,
      omitted: effectiveParticipants.length - answers.length,
      correctPercentage: effectiveParticipants.length
        ? Math.round((correct / effectiveParticipants.length) * 10000) / 100
        : 0
    };
  });
}

function calculateResults(execution, { mode = "normal", nowMs = Date.now(), excludedResponseCount = 0 } = {}) {
  if (execution.result) return execution.result;
  const effectiveParticipants = execution.participants.filter((participant) =>
    participantAnswers(execution, participant.id).length > 0
  );
  for (const participant of effectiveParticipants) {
    const answers = participantAnswers(execution, participant.id);
    if (!participant.completedAt) participant.completedAt = execution.finalizedAt || iso(nowMs);
    participant.state = answers.length === execution.definition.questions.length ? "COMPLETED" : "INCOMPLETE";
    if (execution.category === "assessment" && !participant.completionMode) {
      participant.completionMode = execution.finalizationMode === "forced" ? "forced" : "deadline";
    }
  }
  let rows = effectiveParticipants.map((participant) => {
    const answers = participantAnswers(execution, participant.id);
    const correctAnswers = answers.filter((answer) => answer.correct);
    const correctCount = correctAnswers.length;
    const omittedCount = execution.definition.questions.length - answers.length;
    return {
      participantId: participant.id,
      label: participant.label,
      name: participant.name,
      userNumber: participant.userNumber,
      state: participant.state,
      correctCount,
      incorrectCount: answers.length - correctCount,
      omittedCount,
      totalQuestions: execution.definition.questions.length,
      correctTimeMs: execution.category === "contest"
        ? correctAnswers.reduce((total, answer) => total + (Number(answer.elapsedMs) || 0), 0)
        : 0,
      timeUsedMs: Math.max(0, epoch(participant.completedAt) - epoch(execution.startedAt)),
      grade: execution.category === "assessment"
        ? Math.round((correctCount / execution.definition.questions.length) * 10000) / 100
        : null,
      completedAt: participant.completedAt,
      completionMode: participant.completionMode,
      answers: answers.map((answer) => ({
        questionId: answer.questionId,
        optionId: answer.optionId,
        correctOptionId: execution.definition.questions.find((question) => question.id === answer.questionId)?.correctOptionId || "",
        correct: answer.correct,
        elapsedMs: answer.elapsedMs
      }))
    };
  });
  if (execution.category === "contest") rows = rankContestRows(rows);
  const result = {
    executionId: execution.id,
    category: execution.category,
    mode,
    calculatedAt: iso(nowMs),
    excludedResponseCount,
    participantCount: rows.length,
    completedCount: rows.filter((row) => row.state === "COMPLETED").length,
    incompleteCount: rows.filter((row) => row.state === "INCOMPLETE").length,
    averageGrade: execution.category === "assessment" && rows.length
      ? Math.round((rows.reduce((total, row) => total + row.grade, 0) / rows.length) * 100) / 100
      : null,
    gradeDistribution: execution.category === "assessment"
      ? [
        { range: "0–59", count: rows.filter((row) => row.grade < 60).length },
        { range: "60–69", count: rows.filter((row) => row.grade >= 60 && row.grade < 70).length },
        { range: "70–79", count: rows.filter((row) => row.grade >= 70 && row.grade < 80).length },
        { range: "80–89", count: rows.filter((row) => row.grade >= 80 && row.grade < 90).length },
        { range: "90–100", count: rows.filter((row) => row.grade >= 90).length }
      ]
      : [],
    questionStatistics: questionStatistics(execution, effectiveParticipants),
    rows,
    top10: execution.category === "contest" ? rows.filter((row) => row.position <= 10) : []
  };
  execution.result = result;
  execution.resultsReadyAt = iso(nowMs);
  execution.resultsVisible = execution.category === "contest";
  execution.resultsVisibleAt = execution.resultsVisible ? iso(nowMs) : null;
  execution.state = execution.resultsVisible ? "RESULTS_VISIBLE" : "RESULTS_READY";
  execution.processingReadyAt = null;
  execution.processingDeadlineAt = null;
  touch(execution, nowMs);
  return result;
}

function tickExecution(execution, nowMs = Date.now()) {
  let changed = false;
  let guard = 0;
  while (guard < 128) {
    guard += 1;
    if (execution.state === "COUNTDOWN" && nowMs >= epoch(execution.countdownDeadlineAt)) {
      beginActive(execution, epoch(execution.countdownDeadlineAt) || nowMs);
      changed = true;
      continue;
    }
    if (execution.category === "contest" && execution.state === "ACTIVE"
      && execution.substate === "QUESTION_ACTIVE" && nowMs >= epoch(execution.questionDeadlineAt)) {
      const closedAt = epoch(execution.questionDeadlineAt) || nowMs;
      execution.substate = "REVEAL";
      execution.questionDeadlineAt = null;
      execution.revealDeadlineAt = iso(closedAt + REVEAL_MS);
      touch(execution, closedAt);
      changed = true;
      continue;
    }
    if (execution.category === "contest" && execution.state === "ACTIVE"
      && execution.substate === "REVEAL" && nowMs >= epoch(execution.revealDeadlineAt)) {
      const nextAt = epoch(execution.revealDeadlineAt) || nowMs;
      if (execution.questionIndex + 1 >= execution.questionOrder.length) {
        beginProcessing(execution, nextAt);
      } else {
        execution.questionIndex += 1;
        execution.substate = "QUESTION_ACTIVE";
        execution.questionOpenedAt = iso(nextAt);
        execution.questionDeadlineAt = iso(nextAt + execution.definition.questionDurationSeconds * 1000);
        execution.revealDeadlineAt = null;
        touch(execution, nextAt);
      }
      changed = true;
      continue;
    }
    if (execution.category === "assessment" && execution.state === "ACTIVE"
      && nowMs >= epoch(execution.deadlineAt)) {
      beginProcessing(execution, epoch(execution.deadlineAt) || nowMs);
      changed = true;
      continue;
    }
    if (execution.state === "PROCESSING" && nowMs >= epoch(execution.processingReadyAt)) {
      try {
        calculateResults(execution, { nowMs: epoch(execution.processingReadyAt) || nowMs });
      } catch (_error) {
        if (nowMs >= epoch(execution.processingDeadlineAt)) {
          execution.state = "PROCESSING_ERROR";
          touch(execution, nowMs);
        } else {
          execution.processingReadyAt = iso(Math.min(
            nowMs + 250,
            epoch(execution.processingDeadlineAt)
          ));
          touch(execution, nowMs);
        }
      }
      changed = true;
      continue;
    }
    break;
  }
  return { changed, execution };
}

function finalizeExecution(execution, nowMs = Date.now()) {
  if (!["COUNTDOWN", "ACTIVE"].includes(execution.state)) {
    fail("INVALID_STATE", "The activity cannot be finalized now");
  }
  beginProcessing(execution, nowMs, nowMs, "forced");
  return execution;
}

function cancelExecution(execution, nowMs = Date.now()) {
  if (TERMINAL_STATES.has(execution.state)) fail("INVALID_STATE", "The activity is already terminal");
  execution.state = "CANCELLED";
  execution.substate = null;
  execution.cancelledAt = iso(nowMs);
  execution.deadlineAt = null;
  execution.questionDeadlineAt = null;
  execution.revealDeadlineAt = null;
  execution.processingReadyAt = null;
  execution.processingDeadlineAt = null;
  touch(execution, nowMs);
  return execution;
}

function showResults(execution, nowMs = Date.now()) {
  if (execution.state !== "RESULTS_READY" || execution.category !== "assessment") {
    fail("INVALID_STATE", "Results cannot be shown now");
  }
  execution.state = "RESULTS_VISIBLE";
  execution.resultsVisible = true;
  execution.resultsVisibleAt = iso(nowMs);
  touch(execution, nowMs);
  return execution;
}

function closeExecution(execution, nowMs = Date.now()) {
  if (!["RESULTS_READY", "RESULTS_VISIBLE"].includes(execution.state)) {
    fail("INVALID_STATE", "The activity cannot be closed now");
  }
  execution.state = "CLOSED";
  execution.closedAt = iso(nowMs);
  touch(execution, nowMs);
  return execution;
}

function retryProcessing(execution, nowMs = Date.now()) {
  if (execution.state !== "PROCESSING_ERROR") fail("INVALID_STATE", "Processing is not in error");
  execution.state = "PROCESSING";
  execution.processingStartedAt = iso(nowMs);
  execution.processingReadyAt = iso(nowMs);
  execution.processingDeadlineAt = iso(nowMs + PROCESSING_LIMIT_MS);
  touch(execution, nowMs);
  return execution;
}

function forceResults(execution, { nowMs = Date.now() } = {}) {
  if (!["PROCESSING", "PROCESSING_ERROR"].includes(execution.state)) {
    fail("INVALID_STATE", "Results cannot be forced now");
  }
  const validParticipantIds = new Set(execution.participants.map((participant) => participant.id));
  const validOptions = new Map(execution.definition.questions.map((question) => [
    question.id,
    new Set(question.options.map((option) => option.id))
  ]));
  const originalCount = execution.answers.length;
  execution.answers = execution.answers.filter((answer) =>
    validParticipantIds.has(answer.participantId)
    && validOptions.get(answer.questionId)?.has(answer.optionId)
    && epoch(answer.receivedAt) > 0
  );
  const excludedResponseCount = originalCount - execution.answers.length;
  return calculateResults(execution, { mode: "forced", nowMs, excludedResponseCount });
}

function controllerCommand(execution, {
  commandId,
  expectedRevision,
  actorRole,
  intent,
  nowMs = Date.now(),
  payload = {}
}) {
  if (!CONTROL_ROLES.has(actorRole)) fail("UNAUTHORIZED", "Only Speaker and Stage can control activities");
  const normalizedCommandId = text(commandId, 96);
  if (!normalizedCommandId) fail("INVALID_COMMAND", "command_id is required");
  const previous = execution.commandLog.find((command) => command.commandId === normalizedCommandId);
  if (previous) return clone(previous.result);
  const terminalIntent = intent === "cancel" || intent === "finalize";
  if (!terminalIntent && Number(expectedRevision) !== Number(execution.revision)) {
    fail("STALE_REVISION", "The execution revision changed");
  }
  let result;
  if (intent === "start") result = startExecution(execution, nowMs);
  else if (intent === "finalize") result = finalizeExecution(execution, nowMs);
  else if (intent === "cancel") result = cancelExecution(execution, nowMs);
  else if (intent === "show_results") result = showResults(execution, nowMs);
  else if (intent === "close") result = closeExecution(execution, nowMs);
  else if (intent === "retry_processing") result = retryProcessing(execution, nowMs);
  else if (intent === "force_results") {
    result = forceResults(execution, { nowMs });
  } else fail("INVALID_COMMAND", "Unknown controller intent");
  const response = { ok: true, executionId: execution.id, state: execution.state, revision: execution.revision };
  execution.commandLog.push({
    commandId: normalizedCommandId,
    actorRole,
    intent,
    result: response,
    appliedAt: iso(nowMs)
  });
  if (execution.commandLog.length > 256) execution.commandLog.splice(0, execution.commandLog.length - 256);
  return clone(response);
}

function baseRoleState(execution, nowMs) {
  return {
    available: true,
    executionId: execution.id,
    category: execution.category,
    title: execution.title,
    state: execution.state,
    substate: execution.substate,
    revision: execution.revision,
    serverNow: iso(nowMs),
    countdownDurationMs: COUNTDOWN_MS,
    countdownDeadlineAt: execution.countdownDeadlineAt,
    questionDeadlineAt: execution.questionDeadlineAt,
    revealDeadlineAt: execution.revealDeadlineAt,
    deadlineAt: execution.deadlineAt,
    processingStartedAt: execution.processingStartedAt,
    processingReadyAt: execution.processingReadyAt,
    processingDeadlineAt: execution.processingDeadlineAt,
    resultsVisible: execution.resultsVisible
  };
}

function stateForRole(execution, { role, participantId = "", tabId = "", nowMs = Date.now() }) {
  const base = baseRoleState(execution, nowMs);
  if (CONTROL_ROLES.has(role)) {
    return {
      ...base,
      definitionsSnapshot: clone(execution.definition),
      participantCount: execution.participants.length,
      effectiveParticipantCount: execution.participants.filter((participant) => participantAnswers(execution, participant.id).length).length,
      submittedCount: execution.participants.filter((participant) => participant.submittedAt).length,
      participants: execution.participants.map((participant) => ({
        id: participant.id,
        label: participant.label,
        state: participant.state,
        connected: participant.connected,
        answerCount: participantAnswers(execution, participant.id).length,
        submittedAt: participant.submittedAt
      })),
      questionIndex: execution.questionIndex,
      questionCount: execution.definition.questions.length,
      currentQuestion: currentQuestion(execution),
      result: execution.result
    };
  }
  if (role === "screen" || role === "viewer") {
    const current = currentQuestion(execution);
    const screen = {
      ...base,
      participantCount: execution.participants.length,
      effectiveParticipantCount: execution.participants.filter((participant) => participantAnswers(execution, participant.id).length).length,
      submittedCount: execution.participants.filter((participant) => participant.submittedAt).length,
      questionIndex: execution.questionIndex,
      questionCount: execution.definition.questions.length,
      currentQuestion: null,
      reveal: null,
      top10: []
    };
    if (execution.category === "contest" && current && ["QUESTION_ACTIVE", "REVEAL"].includes(execution.substate)) {
      screen.currentQuestion = {
        id: current.id,
        prompt: current.prompt,
        image: clone(current.image)
      };
      if (execution.substate === "REVEAL") {
        const answers = execution.answers.filter((answer) => answer.questionId === current.id);
        const correctOption = current.options.find((option) => option.id === current.correctOptionId);
        screen.reveal = {
          correctLabel: correctOption?.label || "",
          responseCount: answers.length,
          correctCount: answers.filter((answer) => answer.correct).length
        };
      }
    }
    if (execution.category === "contest" && execution.resultsVisible) {
      screen.top10 = execution.result?.top10?.filter((row) => row.correctCount > 0).map((row) => ({
        position: row.position,
        label: row.label,
        correctCount: row.correctCount,
        totalQuestions: row.totalQuestions,
        correctTimeMs: row.correctTimeMs
      })) || [];
    }
    return screen;
  }
  if (role !== "audience") return { available: true, execution: null };
  const participant = participantById(execution, participantId);
  if (!participant) {
    return {
      ...base,
      participant: null,
      registrationOpen: execution.state === "LOBBY",
      identificationMode: execution.definition.identificationMode
    };
  }
  const ownAnswers = participantAnswers(execution, participant.id);
  const ownResult = execution.result?.rows?.find((row) => row.participantId === participant.id) || null;
  const audience = {
    ...base,
    participant: {
      id: participant.id,
      label: participant.label,
      state: participant.state,
      activeTabId: participant.activeTabId,
      tabActive: !participant.activeTabId || !text(tabId, 96) || participant.activeTabId === text(tabId, 96),
      currentQuestionIndex: participant.currentQuestionIndex,
      submittedAt: participant.submittedAt
    },
    answerCount: ownAnswers.length,
    answers: ownAnswers.map((answer) => ({ questionId: answer.questionId, optionId: answer.optionId })),
    currentQuestion: null,
    questions: [],
    reveal: null,
    personalResult: null
  };
  if (execution.category === "contest") {
    audience.questionIndex = execution.questionIndex;
    audience.questionCount = execution.definition.questions.length;
    const current = currentQuestion(execution);
    if (current && ["QUESTION_ACTIVE", "REVEAL"].includes(execution.substate)) {
      audience.currentQuestion = questionForParticipant(execution, participant, current.id);
      if (execution.substate === "REVEAL") {
        const ownAnswer = ownAnswers.find((answer) => answer.questionId === current.id) || null;
        audience.reveal = {
          correctOptionId: current.correctOptionId,
          selectedOptionId: ownAnswer?.optionId || null,
          correct: Boolean(ownAnswer?.correct)
        };
      }
    }
    if (execution.result) {
      audience.personalResult = ownResult ? {
        correctCount: ownResult.correctCount,
        totalQuestions: ownResult.totalQuestions,
        correctTimeMs: ownResult.correctTimeMs,
        position: ownResult.position,
        answers: participant.questionOrder.map((questionId) => {
          const question = execution.definition.questions.find((item) => item.id === questionId);
          const answer = ownResult.answers.find((item) => item.questionId === questionId);
          const selected = question?.options.find((option) => option.id === answer?.optionId);
          const correct = question?.options.find((option) => option.id === question?.correctOptionId);
          return {
            questionId,
            prompt: question?.prompt || "",
            selectedLabel: selected?.label || null,
            correctLabel: correct?.label || "",
            status: !answer ? "omitted" : answer.correct ? "correct" : "incorrect"
          };
        })
      } : null;
    }
  } else if (execution.state === "ACTIVE" && !participant.submittedAt) {
    audience.questions = participant.questionOrder
      .map((questionId) => questionForParticipant(execution, participant, questionId))
      .filter(Boolean);
  } else if (execution.resultsVisible && ownResult) {
    audience.personalResult = { grade: ownResult.grade };
  }
  return audience;
}

module.exports = {
  CATEGORIES,
  IDENTIFICATION_MODES,
  TERMINAL_STATES,
  CONTROL_ROLES,
  CONTRACT_VERSION,
  COUNTDOWN_MS,
  REVEAL_MS,
  RECONCILIATION_MS,
  PROCESSING_LIMIT_MS,
  KnowledgeActivityError,
  normalizeDefinition,
  createExecution,
  joinParticipant,
  claimParticipantTab,
  startExecution,
  submitAnswer,
  submitAssessment,
  finalizeExecution,
  cancelExecution,
  showResults,
  closeExecution,
  retryProcessing,
  forceResults,
  calculateResults,
  tickExecution,
  controllerCommand,
  stateForRole,
  shuffled
};
