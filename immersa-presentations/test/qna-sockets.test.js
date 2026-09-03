const assert = require("node:assert/strict");
const test = require("node:test");
const { QnaError } = require("../db/qna-repository");
const { createQnaSocketHandlers } = require("../qna-sockets");

function fakeSocket() {
  const handlers = new Map();
  const emissions = [];
  return {
    emissions,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emissions.push({ event, payload }); },
    async trigger(event, payload) {
      const handler = handlers.get(event);
      assert.ok(handler, `Missing handler for ${event}`);
      await handler(payload);
    }
  };
}

function fakeIo() {
  const emissions = [];
  return {
    emissions,
    to(room) {
      return { emit(event, payload) { emissions.push({ room, event, payload }); } };
    }
  };
}

function repositoryStub() {
  const calls = [];
  const state = {
    roundId: "round-1",
    roundNumber: 1,
    questionsOpen: true,
    selectedQuestionId: null,
    questions: [
      { id: "q-1", text: "¿Primera?", name: "Ana", allowNameOnScreen: true, status: "new", answered: false },
      { id: "q-2", text: "¿Segunda?", name: "Luis", allowNameOnScreen: false, status: "new", answered: false }
    ]
  };
  return {
    calls,
    state,
    async getActiveState() { return structuredClone(state); },
    async getAudienceState({ audienceId }) {
      return { roundNumber: state.roundNumber, questionsOpen: state.questionsOpen, hasSubmitted: audienceId === "audience-1" };
    },
    async setQuestionsOpen(payload) { calls.push({ method: "setQuestionsOpen", payload }); state.questionsOpen = payload.open; },
    async submitQuestion(payload) { calls.push({ method: "submitQuestion", payload }); },
    async selectQuestion(payload) {
      calls.push({ method: "selectQuestion", payload });
      state.questions.forEach((question) => { question.status = question.id === payload.questionId ? "selected" : "new"; });
      state.selectedQuestionId = payload.questionId;
    },
    async projectQuestion(payload) {
      calls.push({ method: "projectQuestion", payload });
      await this.selectQuestion(payload);
      state.questions.find((question) => question.id === payload.questionId).answered = true;
    },
    async deleteQuestion(payload) { calls.push({ method: "deleteQuestion", payload }); },
    async newRound(payload) {
      calls.push({ method: "newRound", payload });
      state.roundNumber += 1;
      state.selectedQuestionId = null;
      state.questions = [];
    }
  };
}

function setup(role = "presenter", options = {}) {
  const socket = fakeSocket();
  const io = fakeIo();
  const repository = options.repository || repositoryStub();
  const context = {
    roomKey: "room-a",
    sessionId: "source-session-1",
    role,
    audienceId: role === "audience" ? "audience-1" : null
  };
  const handlers = createQnaSocketHandlers({
    io,
    repository,
    getRoleRoomKey: (room, targetRole) => `${room}::${targetRole}`,
    resolvePresentationSessionId: async () => "presentation-session-1",
    getConnectedAudience: () => [{ audienceId: "audience-1" }]
  });
  handlers.attach(socket, () => context);
  return { socket, io, repository, context, handlers };
}

test("Público receives the frozen confirmation and cannot spoof its audience id", async () => {
  const { socket, repository } = setup("audience");
  await socket.trigger("qna:submit", {
    audienceId: "spoofed",
    question: "¿Cómo funciona?",
    name: "Ana",
    allowNameOnScreen: true
  });
  const submission = repository.calls.find((call) => call.method === "submitQuestion");
  assert.equal(submission.payload.audienceId, "audience-1");
  assert.equal(submission.payload.presentationSessionId, "presentation-session-1");
  assert.deepEqual(socket.emissions.find((item) => item.event === "qna:submitted").payload, {
    message: "Tu pregunta ha sido enviada"
  });
  const publicState = socket.emissions.find((item) => item.event === "qna:state").payload;
  assert.deepEqual(publicState, { roundNumber: 1, questionsOpen: true, hasSubmitted: true });
  assert.equal(Object.hasOwn(publicState, "questions"), false);
});

test("Público sees questions closed and cannot use moderation actions", async () => {
  const { socket, repository, handlers, context } = setup("audience");
  repository.state.questionsOpen = false;
  await handlers.sendCurrentState(socket, context);
  assert.equal(socket.emissions.find((item) => item.event === "qna:state").payload.questionsOpen, false);
  await socket.trigger("qna:select", { questionId: "q-1" });
  assert.equal(repository.calls.some((call) => call.method === "selectQuestion"), false);
  assert.deepEqual(socket.emissions.at(-1), {
    event: "qna:rejected",
    payload: { event: "qna:select", reason: "QNA_FORBIDDEN" }
  });
});

test("Speaker and Stage both have complete Q&A control", async () => {
  for (const role of ["presenter", "stage"]) {
    const { socket, repository } = setup(role);
    await socket.trigger("qna:set_open", { open: false });
    await socket.trigger("qna:select", { questionId: "q-1" });
    await socket.trigger("qna:delete", { questionId: "q-2" });
    await socket.trigger("qna:new_round");
    assert.deepEqual(repository.calls.filter((call) => call.method !== "selectQuestion" || call.payload.questionId === "q-1").map((call) => call.method), [
      "setQuestionsOpen", "selectQuestion", "deleteQuestion", "newRound"
    ]);
  }
});

test("projecting a new question replaces the Screen overlay and filters name consent", async () => {
  const { socket, io } = setup("stage");
  await socket.trigger("qna:project", { questionId: "q-1" });
  let screen = io.emissions.filter((item) => item.room === "room-a::screen" && item.event === "qna:screen").at(-1).payload;
  assert.deepEqual(screen, {
    visible: true,
    question: { id: "q-1", text: "¿Primera?", name: "Ana" }
  });

  await socket.trigger("qna:project", { questionId: "q-2" });
  screen = io.emissions.filter((item) => item.room === "room-a::screen" && item.event === "qna:screen").at(-1).payload;
  assert.deepEqual(screen, {
    visible: true,
    question: { id: "q-2", text: "¿Segunda?", name: "" }
  });
  assert.equal(JSON.stringify(screen).includes("Pregunta del público"), false);
});

test("closing the modal hides Screen without reopening the projected question", async () => {
  const { socket, io, repository } = setup("presenter");
  await socket.trigger("qna:project", { questionId: "q-1" });
  const snapshot = structuredClone(repository.state);
  await socket.trigger("qna:panel_close");
  let screen = io.emissions.filter((item) => item.room === "room-a::screen" && item.event === "qna:screen").at(-1).payload;
  assert.deepEqual(screen, { visible: false, question: null });
  assert.deepEqual(repository.state, snapshot);

  await socket.trigger("qna:panel_open");
  screen = io.emissions.filter((item) => item.room === "room-a::screen" && item.event === "qna:screen").at(-1).payload;
  assert.deepEqual(screen, { visible: false, question: null });
  assert.deepEqual(repository.state, snapshot);
});

test("new round clears Screen while repository owns round archiving", async () => {
  const { socket, io, repository } = setup("stage");
  await socket.trigger("qna:project", { questionId: "q-1" });
  await socket.trigger("qna:new_round");
  const screen = io.emissions.filter((item) => item.room === "room-a::screen" && item.event === "qna:screen").at(-1).payload;
  assert.deepEqual(screen, { visible: false, question: null });
  assert.equal(repository.state.roundNumber, 2);
  assert.deepEqual(repository.state.questions, []);
});

test("history deletion immediately clears controllers, Screen and Público", async () => {
  const { io, repository, handlers } = setup("presenter");
  repository.state.questions = [];
  repository.state.selectedQuestionId = null;
  await handlers.resetAfterHistoryDelete({
    deckId: "deck-a",
    sourceSessionId: "source-session-1",
    presentationSessionId: "presentation-session-1"
  });
  const screen = io.emissions.filter((item) => item.room === "source-session-1::deck-a::screen" && item.event === "qna:screen").at(-1);
  assert.deepEqual(screen.payload, { visible: false, question: null });
  assert.ok(io.emissions.some((item) => item.room === "source-session-1::deck-a::presenter" && item.event === "qna:state"));
  assert.ok(io.emissions.some((item) => item.room === "source-session-1::deck-a::audience:audience-1" && item.event === "qna:state"));
});

test("roles reconnect to the empty active round after history deletion", async () => {
  const repository = repositoryStub();
  repository.state.questions = [];
  repository.state.selectedQuestionId = null;
  repository.getAudienceState = async () => ({ roundNumber: 1, questionsOpen: true, hasSubmitted: false });
  const { handlers } = setup("presenter", { repository });
  await handlers.resetAfterHistoryDelete({
    deckId: "deck-a",
    sourceSessionId: "source-session-1",
    presentationSessionId: "presentation-session-1"
  });

  const screen = fakeSocket();
  await handlers.sendCurrentState(screen, {
    roomKey: "source-session-1::deck-a",
    sessionId: "source-session-1",
    deckId: "deck-a",
    role: "screen"
  });
  assert.deepEqual(screen.emissions.at(-1), {
    event: "qna:screen",
    payload: { visible: false, question: null }
  });

  const audience = fakeSocket();
  await handlers.sendCurrentState(audience, {
    roomKey: "source-session-1::deck-a",
    sessionId: "source-session-1",
    deckId: "deck-a",
    role: "audience",
    audienceId: "audience-1"
  });
  assert.deepEqual(audience.emissions.at(-1), {
    event: "qna:state",
    payload: { roundNumber: 1, questionsOpen: true, hasSubmitted: false }
  });
});

test("domain errors are returned with stable public reasons", async () => {
  const repository = repositoryStub();
  repository.deleteQuestion = async () => { throw new QnaError("QNA_ALREADY_PROJECTED", "internal detail"); };
  const { socket } = setup("stage", { repository });
  await socket.trigger("qna:delete", { questionId: "q-1" });
  assert.deepEqual(socket.emissions.at(-1), {
    event: "qna:rejected",
    payload: { event: "qna:delete", reason: "QNA_ALREADY_PROJECTED" }
  });
});
