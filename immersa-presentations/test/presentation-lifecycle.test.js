const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PresentationLifecycleRepository,
  createPresentationLifecycleRuntime
} = require("../presentation-lifecycle");

function fakePool(results = []) {
  const calls = [];
  const queue = [...results];
  const connection = {
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { calls.push({ kind: "commit" }); },
    async rollback() { calls.push({ kind: "rollback" }); },
    release() { calls.push({ kind: "release" }); },
    async execute(sql, values = []) {
      calls.push({ kind: "execute", sql, values });
      return queue.shift() || [{ affectedRows: 1 }, []];
    }
  };
  return {
    calls,
    async getConnection() { return connection; },
    async execute(sql, values = []) {
      calls.push({ kind: "execute", sql, values });
      return queue.shift() || [[], []];
    }
  };
}

function ioStub() {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        }
      };
    }
  };
}

function socketStub() {
  const handlers = new Map();
  const events = [];
  return {
    handlers,
    events,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { events.push({ event, payload }); }
  };
}

test("starting promotes the draft session after deleting all test answers", async () => {
  const draft = {
    id: "draft-1",
    deck_id: "deck-a",
    source_session_id: "source-a",
    recording_started_at: null
  };
  const live = {
    ...draft,
    recording_started_at: new Date("2026-07-28T10:00:00.000Z")
  };
  const pool = fakePool([
    [[draft], []],
    [{ affectedRows: 2 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [[live], []]
  ]);
  const repository = new PresentationLifecycleRepository(pool, {
    createId: () => "round-live"
  });

  const state = await repository.start({ deckId: "deck-a", sourceSessionId: "source-a" });
  assert.equal(state.mode, "live");
  assert.equal(state.presentationSessionId, "draft-1");
  const sql = pool.calls.filter((call) => call.kind === "execute").map((call) => call.sql).join("\n");
  assert.match(sql, /DELETE FROM knowledge_activity_executions/);
  assert.match(sql, /DELETE FROM qna_rounds/);
  assert.match(sql, /recording_started_at = CURRENT_TIMESTAMP/);
  assert.equal(pool.calls.some((call) => call.kind === "commit"), true);
});

test("automatic promotion preserves an active interaction and its test data", async () => {
  const draft = {
    id: "draft-active",
    deck_id: "deck-a",
    source_session_id: "source-a",
    recording_started_at: null
  };
  const live = {
    ...draft,
    recording_started_at: new Date("2026-07-28T10:00:00.000Z")
  };
  const pool = fakePool([
    [[draft], []],
    [{ affectedRows: 1 }, []],
    [[live], []]
  ]);
  const repository = new PresentationLifecycleRepository(pool);

  const state = await repository.start(
    { deckId: "deck-a", sourceSessionId: "source-a" },
    { preserveTestData: true }
  );

  assert.equal(state.mode, "live");
  const sql = pool.calls.filter((call) => call.kind === "execute").map((call) => call.sql).join("\n");
  assert.doesNotMatch(sql, /DELETE FROM knowledge_activity_executions/);
  assert.doesNotMatch(sql, /DELETE FROM qna_rounds/);
  assert.doesNotMatch(sql, /INSERT INTO qna_rounds/);
  assert.match(sql, /recording_started_at = CURRENT_TIMESTAMP/);
});

test("finishing closes the live session and creates a fresh test session", async () => {
  const live = {
    id: "live-1",
    deck_id: "deck-a",
    source_session_id: "source-a",
    recording_started_at: new Date("2026-07-28T10:00:00.000Z")
  };
  const ids = ["draft-2", "round-2"];
  const pool = fakePool([
    [[live], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new PresentationLifecycleRepository(pool, {
    createId: () => ids.shift()
  });

  const state = await repository.finish({ deckId: "deck-a", sourceSessionId: "source-a" });
  assert.deepEqual(state, {
    available: true,
    mode: "test",
    presentationSessionId: "draft-2",
    startedAt: null
  });
  const inserts = pool.calls.filter((call) => /INSERT INTO (presentation_sessions|qna_rounds)/.test(call.sql || ""));
  assert.equal(inserts.length, 2);
  assert.match(pool.calls.find((call) => /SET ended_at/.test(call.sql || "")).sql, /COALESCE/);
});

test("Speaker and Stage receive one synchronized live state", async () => {
  const io = ioStub();
  const socket = socketStub();
  const order = [];
  const repository = {
    async state() { return { available: true, mode: "test" }; },
    async start() {
      order.push("repository");
      return { available: true, mode: "live", presentationSessionId: "live-1" };
    },
    async finish() { throw new Error("not used"); }
  };
  const runtime = createPresentationLifecycleRuntime({
    io,
    repository,
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    beforeStart: async () => order.push("reset"),
    afterStart: async () => order.push("sync")
  });
  runtime.attach(socket, () => ({
    roomKey: "room-a",
    role: "presenter",
    sessionId: "source-a",
    deckId: "deck-a"
  }));

  await socket.handlers.get("presentation:lifecycle:start")();
  assert.deepEqual(order, ["reset", "repository", "sync"]);
  assert.deepEqual(
    io.events.map(({ room, payload }) => [room, payload.mode]),
    [["room-a::presenter", "live"], ["room-a::stage", "live"]]
  );
});

test("ten-person automatic start preserves an interaction and synchronizes En vivo", async () => {
  const io = ioStub();
  const order = [];
  let startOptions = null;
  const runtime = createPresentationLifecycleRuntime({
    io,
    repository: {
      async state() { return { available: true, mode: "test" }; },
      async start(_payload, options) {
        order.push("repository");
        startOptions = options;
        return { available: true, mode: "live", presentationSessionId: "live-auto" };
      },
      async finish() { throw new Error("not used"); }
    },
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    beforeStart: async () => order.push("reset"),
    afterStart: async () => order.push("sync"),
    preserveAutomaticStart: async () => true
  });

  const state = await runtime.startAutomatically({
    roomKey: "room-a",
    role: "audience",
    sessionId: "source-a",
    deckId: "deck-a",
    audienceId: "audience-10"
  });

  assert.equal(state.mode, "live");
  assert.deepEqual(order, ["repository"]);
  assert.deepEqual(startOptions, { preserveTestData: true });
  assert.deepEqual(
    io.events.map(({ room, payload }) => [room, payload.mode]),
    [["room-a::presenter", "live"], ["room-a::stage", "live"]]
  );
});

test("automatic start without an active interaction clears test state normally", async () => {
  const io = ioStub();
  const order = [];
  let startOptions = null;
  const runtime = createPresentationLifecycleRuntime({
    io,
    repository: {
      async state() { return { available: true, mode: "test" }; },
      async start(_payload, options) {
        order.push("repository");
        startOptions = options;
        return { available: true, mode: "live", presentationSessionId: "live-auto" };
      },
      async finish() { throw new Error("not used"); }
    },
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    beforeStart: async () => order.push("reset"),
    afterStart: async () => order.push("sync"),
    preserveAutomaticStart: async () => false
  });

  await runtime.startAutomatically({
    roomKey: "room-a",
    role: "audience",
    sessionId: "source-a",
    deckId: "deck-a",
    audienceId: "audience-10"
  });

  assert.deepEqual(order, ["reset", "repository", "sync"]);
  assert.deepEqual(startOptions, { preserveTestData: false });
});

test("only Público can trigger the automatic lifecycle entrypoint", async () => {
  let states = 0;
  const runtime = createPresentationLifecycleRuntime({
    io: ioStub(),
    repository: {
      async state() { states += 1; return { available: true, mode: "test" }; },
      async start() { return { available: true, mode: "live" }; },
      async finish() { return { available: true, mode: "test" }; }
    },
    getRoleRoomKey: (room, role) => `${room}::${role}`
  });

  const result = await runtime.startAutomatically({
    roomKey: "room-a",
    role: "screen",
    sessionId: "source-a",
    deckId: "deck-a"
  });

  assert.equal(result, null);
  assert.equal(states, 0);
});

test("finalization is rejected while an interaction is active", async () => {
  const io = ioStub();
  const socket = socketStub();
  let finishes = 0;
  const runtime = createPresentationLifecycleRuntime({
    io,
    repository: {
      async state() { return { available: true, mode: "live" }; },
      async start() { return { available: true, mode: "live" }; },
      async finish() { finishes += 1; return { available: true, mode: "test" }; }
    },
    getRoleRoomKey: (room, role) => `${room}::${role}`,
    beforeFinish: async () => ({
      ok: false,
      reason: "ACTIVE_INTERACTION",
      message: "Cierra la interacción activa antes de finalizar"
    }),
    logger: { error() {} }
  });
  runtime.attach(socket, () => ({
    roomKey: "room-a",
    role: "stage",
    sessionId: "source-a",
    deckId: "deck-a"
  }));

  await socket.handlers.get("presentation:lifecycle:finish")();
  assert.equal(finishes, 0);
  assert.deepEqual(socket.events.at(-1), {
    event: "presentation:lifecycle:rejected",
    payload: {
      event: "finish",
      reason: "ACTIVE_INTERACTION",
      message: "Cierra la interacción activa antes de finalizar"
    }
  });
});

test("the lifecycle slider is mounted on Backstage with basic Metrics and remains hidden from Speaker", () => {
  const root = path.join(__dirname, "..");
  const control = fs.readFileSync(path.join(root, "public/shared/presentation-lifecycle-control.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public/shared/presentation-lifecycle.css"), "utf8");
  const presenter = fs.readFileSync(path.join(root, "public/presenter/index.html"), "utf8");
  const stage = fs.readFileSync(path.join(root, "public/stage/index.html"), "utf8");
  const stageScript = fs.readFileSync(path.join(root, "public/stage/stage.js"), "utf8");

  assert.match(control, /state\.mode === "live" \? "En vivo" : "Iniciar"/);
  assert.match(control, /arming \? "Finalizar" : "En vivo"/);
  assert.match(control, /presentation:lifecycle:\$\{action\}/);
  assert.match(styles, /\.presenter-lifecycle-host[\s\S]*left: 80px/);
  assert.doesNotMatch(presenter, /presentationLifecycle/);
  assert.match(stage, /stage-brand[\s\S]*presentationLifecycle/);
  assert.match(stageScript, /syncPresentationLifecycleFeature\(planAllows\("metrics\.basic"\)\)/);
  assert.match(stageScript, /presentationLifecycleControl\?\.destroy\?\.\(\)/);
  assert.doesNotMatch(presenter, /presentation-lifecycle-control\.js/);
  assert.match(stage, /presentation-lifecycle-control\.js\?v=1/);
});

test("only explicitly started sessions appear in Q&A and knowledge history", () => {
  const root = path.join(__dirname, "..");
  const qna = fs.readFileSync(path.join(root, "db/qna-repository.js"), "utf8");
  const knowledge = fs.readFileSync(path.join(root, "db/knowledge-activity-repository.js"), "utf8");
  const migration = fs.readFileSync(path.join(root, "db/migrations/005_presentation_lifecycle.sql"), "utf8");

  assert.match(qna, /ps\.recording_started_at IS NOT NULL/g);
  assert.match(knowledge, /ps\.recording_started_at IS NOT NULL/);
  assert.match(migration, /recording_started_at DATETIME\(3\) NULL/);
  assert.match(migration, /SET recording_started_at = started_at/);
});

test("server starts immediately at ten unique connected Público participants", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

  assert.match(server, /const AUTO_START_AUDIENCE_THRESHOLD = 10/);
  assert.match(
    server,
    /role === "audience"[\s\S]*session\.audience\.size >= AUTO_START_AUDIENCE_THRESHOLD[\s\S]*!session\.automaticLifecycleStarted[\s\S]*session\.automaticLifecycleStarted = true;[\s\S]*presentationLifecycleRuntime\.startAutomatically\(joinedContext\)/
  );
  assert.match(server, /if \(state\?\.mode !== "live"\) session\.automaticLifecycleStarted = false/);
  assert.doesNotMatch(server, /AUTO_START_AUDIENCE_THRESHOLD[\s\S]{0,240}(?:setTimeout|15000)/);
});
