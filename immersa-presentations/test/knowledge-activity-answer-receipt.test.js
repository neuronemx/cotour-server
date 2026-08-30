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
    title: "Contest",
    identificationMode: "anonymous",
    questionDurationSeconds: 5,
    questions: [{
      id: "q1",
      prompt: "Question",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      correctOptionId: "a"
    }]
  };
}

function repository() {
  const executions = new Map();
  return {
    async ensurePresentationSession() { return "presentation-1"; },
    async createExecution(execution) {
      executions.set(execution.sourceSessionId, JSON.parse(JSON.stringify(execution)));
    },
    async saveExecution(execution, { expectedRevision }) {
      const stored = executions.get(execution.sourceSessionId);
      assert.equal(stored.revision, expectedRevision);
      executions.set(execution.sourceSessionId, JSON.parse(JSON.stringify(execution)));
    },
    async loadActiveExecution({ sourceSessionId }) {
      const item = executions.get(sourceSessionId);
      return item ? JSON.parse(JSON.stringify(item)) : null;
    },
    async listActiveExecutions() { return []; }
  };
}

test("contest answer uses its server receipt time after a queue delay", async () => {
  const now = { value: 1000 };
  const service = new KnowledgeActivityService({
    repository: repository(),
    coordinator: new ActiveInteractionCoordinator({
      interactionStore: new InteractionStore(),
      raffleStore: new RaffleStore()
    }),
    loadDefinitionsForDeck: async () => ({ contests: [definition()], assessments: [] }),
    now: () => now.value,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn() {},
    random: () => 0.9
  });
  const execution = await service.open({
    sourceSessionId: "session-1",
    deckId: "deck-1",
    definitionId: "contest-1",
    category: "contest"
  });
  await service.join(execution, { participantId: "participant-1", tabId: "tab-1" });
  await service.command(execution, {
    commandId: "start",
    expectedRevision: execution.revision,
    actorRole: "stage",
    intent: "start"
  });

  now.value = 7000;
  await service.getActive({ sourceSessionId: "session-1", deckId: "deck-1" });
  now.value = 13000;

  const answer = await service.answer(execution, {
    participantId: "participant-1",
    questionId: "q1",
    optionId: "a",
    tabId: "tab-1",
    receivedAtMs: 8000
  });

  assert.equal(answer.questionId, "q1");
  assert.equal(execution.answers.length, 1);
  assert.equal(execution.answers[0].receivedAt, new Date(8000).toISOString());
});
