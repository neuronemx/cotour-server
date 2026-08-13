const assert = require("node:assert/strict");
const test = require("node:test");
const { createQnaRuntime, qnaEnabled } = require("../qna-runtime");

function fakeIo() {
  return { to() { return { emit() {} }; } };
}

function fakeSocket() {
  const handlers = new Map();
  const emissions = [];
  return {
    handlers,
    emissions,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emissions.push({ event, payload }); }
  };
}

test("Q&A can be explicitly disabled without constructing a MySQL pool", async () => {
  let poolCreated = false;
  const runtime = createQnaRuntime({
    env: { IMMERSA_QNA_ENABLED: "false" },
    createPool() { poolCreated = true; throw new Error("must not run"); }
  });
  const socket = fakeSocket();
  runtime.attach(socket, () => ({}));
  await runtime.sendCurrentState(socket, {});
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.startScreenExecution, null);
  assert.equal(poolCreated, false);
  assert.equal(socket.handlers.size, 0);
  assert.deepEqual(socket.emissions, []);
});

test("Q&A is enabled by default and accepts an explicit opt-out", () => {
  for (const value of ["", "1", "true", "TRUE", "yes", "on", undefined]) {
    assert.equal(qnaEnabled({ IMMERSA_QNA_ENABLED: value }), true);
  }
  assert.equal(qnaEnabled({}), true);
  for (const value of ["0", "false", "no", "off", "disabled"]) {
    assert.equal(qnaEnabled({ IMMERSA_QNA_ENABLED: value }), false);
  }
});

test("enabled runtime resolves the active Screen execution for socket state", async () => {
  const calls = [];
  const repository = {
    async getActivePresentationSession(payload) {
      calls.push({ method: "getActivePresentationSession", payload });
      return { presentationSessionId: "presentation-session-1" };
    },
    async getAudienceState(payload) {
      calls.push({ method: "getAudienceState", payload });
      return { roundNumber: 1, questionsOpen: false, hasSubmitted: false };
    },
    async getActiveState() {
      return { roundId: "round-1", roundNumber: 1, questionsOpen: false, selectedQuestionId: null, questions: [] };
    }
  };
  const executionCoordinator = {
    async openScreen(payload) {
      calls.push({ method: "openScreen", payload });
      return { presentationSessionId: "presentation-session-1", created: true };
    }
  };
  const runtime = createQnaRuntime({
    env: { IMMERSA_QNA_ENABLED: "true" },
    pool: { async end() {} },
    repository,
    executionCoordinator,
    io: fakeIo(),
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getConnectedAudience: () => []
  });
  const socket = fakeSocket();
  const context = {
    roomKey: "room-a",
    role: "audience",
    sessionId: "source-session-1",
    deckId: "deck-a",
    audienceId: "audience-1"
  };
  runtime.attach(socket, () => context);
  await runtime.sendCurrentState(socket, context);
  assert.equal(runtime.enabled, true);
  assert.deepEqual(socket.emissions.at(-1), {
    event: "qna:state",
    payload: { roundNumber: 1, questionsOpen: false, hasSubmitted: false }
  });
  assert.deepEqual(calls[0], {
    method: "getActivePresentationSession",
    payload: { deckId: "deck-a", sourceSessionId: "source-session-1" }
  });
  const started = await runtime.startScreenExecution({ screenLinkId: "screen-link-1" });
  assert.equal(started.presentationSessionId, "presentation-session-1");
});

test("enabled runtime reports state failures without breaking the presentation join", async () => {
  const repository = {
    async getActivePresentationSession() { throw new Error("database unavailable"); }
  };
  const logger = { errors: [], error(...args) { this.errors.push(args); } };
  const runtime = createQnaRuntime({
    env: { IMMERSA_QNA_ENABLED: "1" },
    pool: { async end() {} },
    repository,
    executionCoordinator: { async openScreen() {} },
    io: fakeIo(),
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getConnectedAudience: () => [],
    logger
  });
  const socket = fakeSocket();
  await runtime.sendCurrentState(socket, {
    roomKey: "room-a",
    role: "audience",
    sessionId: "source-session-1",
    deckId: "deck-a",
    audienceId: "audience-1"
  });
  assert.deepEqual(socket.emissions, [{
    event: "qna:rejected",
    payload: { event: "qna:state", reason: "QNA_UNAVAILABLE" }
  }]);
  assert.equal(logger.errors.length, 1);
});

test("Speaker state prepares a draft Q&A execution without starting Metrics", async () => {
  const calls = [];
  const repository = {
    async getActivePresentationSession() { return null; },
    async startPresentationSession(payload) {
      calls.push(payload);
      return { presentationSessionId: "draft-session", qnaRoundId: "round-1", roundNumber: 1, questionsOpen: false };
    },
    async getActiveState(id) {
      assert.equal(id, "draft-session");
      return { roundId: "round-1", roundNumber: 1, questionsOpen: false, selectedQuestionId: null, questions: [] };
    }
  };
  const runtime = createQnaRuntime({
    env: {},
    pool: { async end() {} },
    repository,
    io: fakeIo(),
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getConnectedAudience: () => []
  });
  const socket = fakeSocket();
  await runtime.sendCurrentState(socket, {
    roomKey: "room-a",
    role: "presenter",
    sessionId: "source-session-1",
    deckId: "deck-a"
  });
  assert.deepEqual(calls, [{ deckId: "deck-a", sourceSessionId: "source-session-1", replaceActive: false }]);
  assert.equal(socket.emissions.at(-1).event, "qna:state");
});

test("inactivity shutdown archives the old Q&A execution and starts closed", async () => {
  const calls = [];
  const repository = {
    async getActivePresentationSession() {
      return { presentationSessionId: "old-session", startedAt: "2026-08-12T10:00:00.000Z" };
    },
    async startPresentationSession(payload) {
      calls.push(payload);
      return { presentationSessionId: "fresh-session", qnaRoundId: "fresh-round", questionsOpen: false };
    },
    async getActiveState(presentationSessionId) {
      assert.equal(presentationSessionId, "fresh-session");
      return { roundId: "fresh-round", roundNumber: 1, questionsOpen: false, selectedQuestionId: null, questions: [] };
    }
  };
  const runtime = createQnaRuntime({
    env: { IMMERSA_QNA_ENABLED: "true" },
    pool: { async end() {} },
    repository,
    executionCoordinator: { async openScreen() {} },
    io: fakeIo(),
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getRoomKey: (sessionId, deckId) => `${sessionId}::${deckId}`,
    getConnectedAudience: () => []
  });

  const result = await runtime.shutdownSessionIfStale({
    deckId: "deck-a",
    sourceSessionId: "source-a",
    inactivityMs: 60 * 60 * 1000,
    now: Date.parse("2026-08-12T12:00:00.000Z")
  });

  assert.equal(result.expired, true);
  assert.deepEqual(calls, [{ deckId: "deck-a", sourceSessionId: "source-a", replaceActive: true }]);
});

test("enabled runtime lists history and exports every deck execution", async () => {
  const calls = [];
  const repository = {
    async listPresentationSessions(deckId) {
      calls.push({ method: "listPresentationSessions", deckId });
      return [{ presentationSessionId: "presentation-session-1", questionCount: 1 }];
    },
    async listExportQuestionsByDeck(deckId) {
      calls.push({ method: "listExportQuestionsByDeck", deckId });
      return [{
        presentationSessionId: "presentation-session-1",
        deckId,
        roundNumber: 2,
        question: "¿Se guarda?",
        name: "Ana",
        answered: true,
        createdAt: new Date("2026-07-19T06:00:00.000Z")
      }];
    },
    async clearDeckHistory(deckId) {
      calls.push({ method: "clearDeckHistory", deckId });
      return {
        deckId,
        deletedSessionCount: 2,
        deletedQuestionCount: 3,
        activePresentationSessionId: "presentation-session-1",
        sourceSessionId: "source-session-1"
      };
    },
    async getActiveState() {
      return { roundId: "round-1", roundNumber: 1, questionsOpen: true, selectedQuestionId: null, questions: [] };
    }
  };
  const runtime = createQnaRuntime({
    env: { IMMERSA_QNA_ENABLED: "true" },
    pool: { async end() {} },
    repository,
    executionCoordinator: { async openScreen() {} },
    io: fakeIo(),
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getConnectedAudience: () => []
  });

  const history = await runtime.listHistory({ deckId: "deck-a" });
  const result = await runtime.exportDeckCsv({ deckId: "deck-a" });
  const cleared = await runtime.clearHistory({ deckId: "deck-a" });
  assert.equal(history[0].presentationSessionId, "presentation-session-1");
  assert.equal(result.questionCount, 1);
  assert.match(result.csv, /^\uFEFF/);
  assert.match(result.csv, /"Respondida"/);
  assert.match(result.csv, /"Sí"/);
  assert.equal(cleared.deletedQuestionCount, 3);
  assert.deepEqual(calls, [
    { method: "listPresentationSessions", deckId: "deck-a" },
    { method: "listExportQuestionsByDeck", deckId: "deck-a" },
    { method: "clearDeckHistory", deckId: "deck-a" }
  ]);
});
