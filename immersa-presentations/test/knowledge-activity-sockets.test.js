const test = require("node:test");
const assert = require("node:assert/strict");
const {
  participantIdFor,
  recoveryTokenHashFor,
  createKnowledgeActivitySocketHandlers
} = require("../knowledge-activity-sockets");
const { knowledgeActivitiesEnabled, createKnowledgeActivityRuntime } = require("../knowledge-activity-runtime");

function fakeIo() {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(event, payload) { events.push({ room, event, payload }); }
      };
    }
  };
}

function fakeSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    handlers,
    emitted,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); }
  };
}

function execution() {
  return {
    id: "execution-1",
    sourceSessionId: "session-1",
    deckId: "deck-1",
    state: "LOBBY"
  };
}

function service() {
  const item = execution();
  let listener = null;
  const calls = [];
  return {
    calls,
    subscribe(next) { listener = next; return () => { listener = null; }; },
    async getActive() { return item; },
    isExecutionActive(value) { return Boolean(value && !["CANCELLED", "CLOSED"].includes(value.state)); },
    state(value, options) {
      return value
        ? { executionId: value.id, role: options.role, participantId: options.participantId || "" }
        : { available: true, execution: null };
    },
    async open(payload) { calls.push({ action: "open", payload }); return item; },
    async command(_execution, payload) { calls.push({ action: "command", payload }); return { ok: true, revision: 2 }; },
    async join(_execution, payload) { calls.push({ action: "join", payload }); return { id: payload.participantId, label: "Usuario 001" }; },
    async claimTab(_execution, payload) { calls.push({ action: "claim", payload }); },
    async answer(_execution, payload) {
      calls.push({ action: "answer", payload });
      return { questionId: payload.questionId, optionId: payload.optionId, receivedAt: "now" };
    },
    async submit(_execution, payload) { calls.push({ action: "submit", payload }); return { submittedAt: "now" }; },
    notify(eventName, state = item.state) {
      item.state = state;
      listener?.({ execution: item, eventName });
    }
  };
}

test("participant id is stable per execution and audience without exposing raw audience id", () => {
  const first = participantIdFor("execution-1", "audience-1");
  const second = participantIdFor("execution-1", "audience-1");
  assert.equal(first, second);
  assert.equal(first.length, 36);
  assert.doesNotMatch(first, /audience/);
  assert.notEqual(first, participantIdFor("execution-1", "audience-2"));
});

test("recovery identity is stored as a full one-way hash", () => {
  const hash = recoveryTokenHashFor("execution-1", "audience-secret");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(hash, /audience-secret/);
});

test("socket handlers trust server context for participant identity and controller role", async () => {
  const io = fakeIo();
  const runtimeService = service();
  const socket = fakeSocket();
  const context = {
    roomKey: "room",
    sessionId: "session-1",
    deckId: "deck-1",
    role: "audience",
    audienceId: "audience-1"
  };
  const handlers = createKnowledgeActivitySocketHandlers({
    io,
    service: runtimeService,
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getRoomKey: (session, deck) => `${session}::${deck}`,
    getConnectedAudience: () => []
  });
  handlers.attach(socket, () => context);
  await socket.handlers.get("interaction:participant:join")({ name: "", tabId: "tab-1", participantId: "spoofed" });
  const joined = runtimeService.calls.find((call) => call.action === "join");
  assert.equal(joined.payload.participantId, participantIdFor("execution-1", "audience-1"));
  await socket.handlers.get("interaction:participant:submit_answer")({
    questionId: "q1",
    optionId: "a",
    participantId: "spoofed",
    tabId: "tab-1"
  });
  const answer = runtimeService.calls.find((call) => call.action === "answer");
  assert.equal(answer.payload.participantId, participantIdFor("execution-1", "audience-1"));
});

test("Speaker and Stage commands use the authoritative context role", async () => {
  const io = fakeIo();
  const runtimeService = service();
  const socket = fakeSocket();
  const context = {
    roomKey: "room",
    sessionId: "session-1",
    deckId: "deck-1",
    role: "stage"
  };
  const handlers = createKnowledgeActivitySocketHandlers({
    io,
    service: runtimeService,
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getRoomKey: (session, deck) => `${session}::${deck}`
  });
  handlers.attach(socket, () => context);
  await socket.handlers.get("interaction:execution:start")({
    executionId: "execution-1",
    commandId: "command-1",
    expectedRevision: 1,
    actorRole: "presenter"
  });
  const command = runtimeService.calls.find((call) => call.action === "command");
  assert.equal(command.payload.actorRole, "stage");
  assert.equal(command.payload.intent, "start");
});

test("state broadcasts are role-specific and audience payloads use private rooms", () => {
  const io = fakeIo();
  const runtimeService = service();
  createKnowledgeActivitySocketHandlers({
    io,
    service: runtimeService,
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getRoomKey: (session, deck) => `${session}::${deck}`,
    getConnectedAudience: () => [{ audienceId: "audience-1" }]
  });
  runtimeService.notify("timer");
  const audience = io.events.find((event) => event.room.endsWith("::audience:audience-1"));
  const screen = io.events.find((event) => event.room.endsWith("::screen"));
  assert.equal(audience.payload.role, "audience");
  assert.equal(screen.payload.role, "screen");
  assert.equal(audience.payload.participantId, participantIdFor("execution-1", "audience-1"));
});

test("terminal cancellation clears the active execution for every role", () => {
  const io = fakeIo();
  const runtimeService = service();
  createKnowledgeActivitySocketHandlers({
    io,
    service: runtimeService,
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    getRoomKey: (session, deck) => `${session}::${deck}`,
    getConnectedAudience: () => [{ audienceId: "audience-1" }]
  });
  runtimeService.notify("cancel", "CANCELLED");
  assert.equal(io.events.length, 5);
  io.events.forEach((event) => {
    assert.deepEqual(event.payload, { available: true, execution: null });
  });
});

test("runtime is protected by the temporary environment feature flag", async () => {
  assert.equal(knowledgeActivitiesEnabled({ IMMERSA_KNOWLEDGE_ACTIVITIES_ENABLED: "true" }), true);
  assert.equal(knowledgeActivitiesEnabled({}), false);
  const disabled = createKnowledgeActivityRuntime({ env: {} });
  const socket = fakeSocket();
  await disabled.sendCurrentState(socket);
  assert.deepEqual(socket.emitted[0], {
    event: "interaction:execution:state",
    payload: { available: false, execution: null }
  });
});
