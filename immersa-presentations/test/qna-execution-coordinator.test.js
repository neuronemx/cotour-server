const assert = require("node:assert/strict");
const test = require("node:test");
const { QnaExecutionCoordinator } = require("../qna-execution-coordinator");

function repositoryStub() {
  const calls = [];
  let active = null;
  let sequence = 0;
  return {
    calls,
    get active() { return active; },
    set active(value) { active = value; },
    async getActivePresentationSession(payload) {
      calls.push({ method: "getActivePresentationSession", payload });
      return active;
    },
    async startPresentationSession(payload) {
      calls.push({ method: "startPresentationSession", payload });
      sequence += 1;
      active = {
        presentationSessionId: `presentation-${sequence}`,
        deckId: payload.deckId,
        sourceSessionId: payload.sourceSessionId,
        startedAt: null
      };
      return { ...active, qnaRoundId: `round-${sequence}`, roundNumber: 1, questionsOpen: false };
    }
  };
}

const screen = {
  deckId: "deck-a",
  sourceSessionId: "room-a",
  screenLinkId: "screen-link-1"
};

test("opening a new Screen link creates only a non-historical draft session", async () => {
  const repository = repositoryStub();
  const result = await new QnaExecutionCoordinator(repository).openScreen(screen);
  assert.equal(result.presentationSessionId, "presentation-1");
  assert.equal(result.created, true);
  const start = repository.calls.find((call) => call.method === "startPresentationSession");
  assert.deepEqual(start.payload, { deckId: "deck-a", sourceSessionId: "room-a", replaceActive: true });
});

test("refreshing the same Screen link resumes its active execution", async () => {
  const repository = repositoryStub();
  const coordinator = new QnaExecutionCoordinator(repository);
  await coordinator.openScreen(screen);
  const result = await coordinator.openScreen(screen);
  assert.equal(result.presentationSessionId, "presentation-1");
  assert.equal(result.created, false);
  assert.equal(repository.calls.filter((call) => call.method === "startPresentationSession").length, 1);
});

test("a new Screen link replaces the active draft execution", async () => {
  const repository = repositoryStub();
  const coordinator = new QnaExecutionCoordinator(repository);
  await coordinator.openScreen(screen);
  const result = await coordinator.openScreen({ ...screen, screenLinkId: "screen-link-2" });
  assert.equal(result.presentationSessionId, "presentation-2");
  assert.equal(result.created, true);
  assert.equal(repository.calls.filter((call) => call.method === "startPresentationSession").length, 2);
});

test("opening an older bound Screen link joins the current execution instead of reviving history", async () => {
  const repository = repositoryStub();
  const coordinator = new QnaExecutionCoordinator(repository);
  await coordinator.openScreen(screen);
  await coordinator.openScreen({ ...screen, screenLinkId: "screen-link-2" });
  const result = await coordinator.openScreen(screen);
  assert.equal(result.presentationSessionId, "presentation-2");
  assert.equal(result.created, false);
  assert.equal(repository.calls.filter((call) => call.method === "startPresentationSession").length, 2);
});

test("a persisted Screen binding survives process state without creating a duplicate", async () => {
  const repository = repositoryStub();
  repository.active = {
    presentationSessionId: "presentation-existing",
    deckId: "deck-a",
    sourceSessionId: "room-a",
    startedAt: new Date()
  };
  const result = await new QnaExecutionCoordinator(repository).openScreen({
    ...screen,
    presentationSessionId: "presentation-existing"
  });
  assert.equal(result.presentationSessionId, "presentation-existing");
  assert.equal(result.created, false);
  assert.equal(repository.calls.some((call) => call.method === "startPresentationSession"), false);
});

test("concurrent opens of one Screen link create only one execution", async () => {
  const repository = repositoryStub();
  const originalStart = repository.startPresentationSession.bind(repository);
  repository.startPresentationSession = async (payload) => {
    await new Promise((resolve) => setImmediate(resolve));
    return originalStart(payload);
  };
  const coordinator = new QnaExecutionCoordinator(repository);
  const [first, second] = await Promise.all([
    coordinator.openScreen(screen),
    coordinator.openScreen(screen)
  ]);
  assert.equal(first.presentationSessionId, second.presentationSessionId);
  assert.equal(repository.calls.filter((call) => call.method === "startPresentationSession").length, 1);
});

test("Speaker can prepare one draft execution before Screen connects", async () => {
  const repository = repositoryStub();
  const coordinator = new QnaExecutionCoordinator(repository);
  const first = await coordinator.ensureExecution({ deckId: "deck-a", sourceSessionId: "room-a" });
  const second = await coordinator.ensureExecution({ deckId: "deck-a", sourceSessionId: "room-a" });
  assert.equal(first.presentationSessionId, "presentation-1");
  assert.equal(second.presentationSessionId, "presentation-1");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(repository.calls.find((call) => call.method === "startPresentationSession").payload, {
    deckId: "deck-a",
    sourceSessionId: "room-a",
    replaceActive: false
  });
});
