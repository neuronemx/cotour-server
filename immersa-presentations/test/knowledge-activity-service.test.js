const test = require("node:test");
const assert = require("node:assert/strict");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");
const { InteractionStore } = require("../interaction-store");
const { RaffleStore } = require("../raffle-store");
const { KnowledgeActivityService } = require("../knowledge-activity-service");

function definition() {
  return {
    id: "contest-1",
    category: "contest",
    title: "Concurso",
    identificationMode: "anonymous",
    questionDurationSeconds: 5,
    questions: [{
      id: "q1",
      prompt: "Pregunta",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      correctOptionId: "a"
    }]
  };
}

function repository() {
  const active = new Map();
  const saves = [];
  return {
    saves,
    async ensurePresentationSession() { return "00000000-0000-0000-0000-000000000001"; },
    async createExecution(execution) {
      if ([...active.values()].some((item) => item.presentationSessionId === execution.presentationSessionId)) {
        const error = new Error("busy");
        error.code = "INTERACTION_BUSY";
        throw error;
      }
      active.set(execution.sourceSessionId, JSON.parse(JSON.stringify(execution)));
    },
    async saveExecution(execution, { expectedRevision, participants, answers } = {}) {
      const stored = active.get(execution.sourceSessionId);
      assert.equal(stored.revision, expectedRevision);
      active.set(execution.sourceSessionId, JSON.parse(JSON.stringify(execution)));
      saves.push({
        execution: JSON.parse(JSON.stringify(execution)),
        expectedRevision,
        participants: participants ? JSON.parse(JSON.stringify(participants)) : null,
        answers: answers ? JSON.parse(JSON.stringify(answers)) : null
      });
    },
    async saveAnswerBatch(execution, { expectedRevision, participants, answers } = {}) {
      const stored = active.get(execution.sourceSessionId);
      assert.equal(stored.revision, expectedRevision);
      active.set(execution.sourceSessionId, JSON.parse(JSON.stringify(execution)));
      saves.push({ execution: JSON.parse(JSON.stringify(execution)), expectedRevision, participants: participants ? JSON.parse(JSON.stringify(participants)) : null, answers: answers ? JSON.parse(JSON.stringify(answers)) : null, batched: true });
    },
    async loadActiveExecution({ sourceSessionId }) {
      const item = active.get(sourceSessionId);
      return item ? JSON.parse(JSON.stringify(item)) : null;
    },
    async listActiveExecutions() {
      return [...active.values()].map((item) => JSON.parse(JSON.stringify(item)));
    }
  };
}

function setup(nowRef = { value: 1000 }) {
  const interactionStore = new InteractionStore();
  const raffleStore = new RaffleStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore, raffleStore });
  const repo = repository();
  const timers = [];
  const service = new KnowledgeActivityService({
    repository: repo,
    coordinator,
    loadDefinitionsForDeck: async () => ({ contests: [definition()], assessments: [] }),
    now: () => nowRef.value,
    setTimeoutFn: (fn, delay) => {
      const handle = { fn, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    clearTimeoutFn() {},
    random: () => 0.999
  });
  return { service, coordinator, interactionStore, raffleStore, repo, timers, nowRef };
}

test("opening reserves the global interaction coordinator and blocks a poll", async () => {
  const { service, coordinator, interactionStore } = setup();
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  assert.equal(service.hasActive("session-1"), true);
  assert.equal(coordinator.hasAnyActive("session-1"), true);
  interactionStore.launch({
    sessionId: "session-1",
    interaction: { id: "poll", type: "poll", prompt: "Poll", options: [{ id: "a", label: "A" }] }
  });
  assert.equal(coordinator.hasAnyActive("session-1", "interaction"), true);
  assert.equal(execution.state, "LOBBY");
});

test("service persists every accepted mutation with optimistic revision", async () => {
  const { service, repo } = setup();
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  const revision = execution.revision;
  await service.join(execution, { participantId: "participant-1", tabId: "tab-1" });
  assert.equal(repo.saves[0].expectedRevision, revision);
  assert.equal(repo.saves[0].execution.participants.length, 1);
});

test("an accepted contest answer persists only its participant and answer", async () => {
  const nowRef = { value: 1000 };
  const { service, repo } = setup(nowRef);
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  await service.join(execution, { participantId: "participant-1", tabId: "tab-1" });
  await service.join(execution, { participantId: "participant-2", tabId: "tab-2" });
  await service.command(execution, {
    commandId: "start",
    expectedRevision: execution.revision,
    actorRole: "stage",
    intent: "start"
  });
  nowRef.value = 6000;
  await service.reconcile(execution);
  const answer = await service.answer(execution, {
    participantId: "participant-1",
    questionId: "q1",
    optionId: "a",
    tabId: "tab-1",
    receivedAtMs: nowRef.value
  });
  await service.flushAnswers(execution);
  const persisted = repo.saves.at(-1);
  assert.deepEqual(persisted.participants.map((participant) => participant.id), ["participant-1"]);
  assert.deepEqual(persisted.answers, [answer]);
  assert.equal(persisted.batched, true);
});

test("a thousand answers acknowledge before one persistence batch", async () => {
  const nowRef = { value: 1000 };
  const { service, repo } = setup(nowRef);
  const execution = await service.open({ sourceSessionId: "session-1", deckId: "deck-1", definitionId: "contest-1", category: "contest" });
  for (let number = 1; number <= 1000; number += 1) await service.join(execution, { participantId: `participant-${number}`, tabId: `tab-${number}` });
  await service.command(execution, { commandId: "start", expectedRevision: execution.revision, actorRole: "stage", intent: "start" });
  nowRef.value = 6000;
  await service.reconcile(execution);
  for (let number = 1; number <= 1000; number += 1) await service.answer(execution, { participantId: `participant-${number}`, questionId: "q1", optionId: "a", tabId: `tab-${number}`, receivedAtMs: nowRef.value });
  assert.equal(repo.saves.filter((item) => item.batched).length, 0);
  await service.flushAnswers(execution);
  const batches = repo.saves.filter((item) => item.batched);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].answers.length, 1000);
  assert.equal(batches[0].participants.length, 1000);
});

test("cached audience lookups do not flush an in-flight Trivia answer batch", async () => {
  const nowRef = { value: 1000 };
  const { service, repo } = setup(nowRef);
  const execution = await service.open({ sourceSessionId: "session-1", deckId: "deck-1", definitionId: "contest-1", category: "contest" });
  await service.join(execution, { participantId: "participant-1", tabId: "tab-1" });
  await service.command(execution, { commandId: "start", expectedRevision: execution.revision, actorRole: "stage", intent: "start" });
  nowRef.value = 6000;
  await service.reconcile(execution);
  await service.answer(execution, { participantId: "participant-1", questionId: "q1", optionId: "a", tabId: "tab-1", receivedAtMs: nowRef.value });
  await service.getActive({ sourceSessionId: "session-1", deckId: "deck-1" });
  assert.equal(repo.saves.filter((item) => item.batched).length, 0);
  await service.flushAnswers(execution);
  assert.equal(repo.saves.filter((item) => item.batched).length, 1);
});

test("a disconnected participant is discarded after waiting for the session lock", async () => {
  const { service, repo } = setup();
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  await assert.rejects(
    service.join(execution, { participantId: "participant-1", tabId: "tab-1", isConnected: () => false }),
    { code: "PARTICIPANT_DISCONNECTED" }
  );
  assert.equal(repo.saves.length, 0);
  assert.equal(execution.participants.length, 0);
});

test("server restart reconstructs and advances an expired countdown", async () => {
  const nowRef = { value: 1000 };
  const initial = setup(nowRef);
  const execution = await initial.service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  await initial.service.join(execution, { participantId: "participant-1", tabId: "tab-1" });
  await initial.service.command(execution, {
    commandId: "start",
    expectedRevision: execution.revision,
    actorRole: "presenter",
    intent: "start"
  });
  nowRef.value = 7000;
  const coordinator = new ActiveInteractionCoordinator({
    interactionStore: new InteractionStore(),
    raffleStore: new RaffleStore()
  });
  const recovered = new KnowledgeActivityService({
    repository: initial.repo,
    coordinator,
    loadDefinitionsForDeck: async () => ({ contests: [definition()], assessments: [] }),
    now: () => nowRef.value,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn() {}
  });
  await recovered.start();
  const active = await recovered.getActive({ sourceSessionId: "session-1", deckId: "deck-1" });
  assert.equal(active.state, "ACTIVE");
  assert.equal(active.substate, "QUESTION_ACTIVE");
});

test("terminal command releases the coordinator reservation", async () => {
  const { service, coordinator } = setup();
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  await service.command(execution, {
    commandId: "cancel",
    expectedRevision: execution.revision,
    actorRole: "stage",
    intent: "cancel"
  });
  assert.equal(service.hasActive("session-1"), false);
  assert.equal(coordinator.hasAnyActive("session-1"), false);
});
