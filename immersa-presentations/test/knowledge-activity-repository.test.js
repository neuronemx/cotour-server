const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createExecution, joinParticipant } = require("../knowledge-activity-engine");
const { KnowledgeActivityRepository, mysqlDateTime, snapshotForStorage, hydrateExecution } = require("../db/knowledge-activity-repository");

function fakePool(responses = []) {
  const queue = responses.slice();
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ type: "begin" }); },
    async commit() { calls.push({ type: "commit" }); },
    async rollback() { calls.push({ type: "rollback" }); },
    release() { calls.push({ type: "release" }); },
    async execute(sql, values) {
      calls.push({ type: "execute", sql: String(sql), values });
      const response = queue.shift();
      if (response instanceof Error) throw response;
      return response || [{ affectedRows: 1 }, []];
    }
  };
  return {
    calls,
    async getConnection() { return connection; },
    async execute(sql, values) { return connection.execute(sql, values); }
  };
}

function definition() {
  return {
    id: "contest-1",
    category: "contest",
    title: "Concurso",
    identificationMode: "anonymous",
    questionDurationSeconds: 20,
    questions: [{
      id: "q1",
      prompt: "Pregunta",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      correctOptionId: "a"
    }]
  };
}

function execution() {
  return createExecution({
    id: "00000000-0000-0000-0000-000000000001",
    presentationSessionId: "00000000-0000-0000-0000-000000000002",
    sourceSessionId: "source-1",
    deckId: "deck-1",
    definition: definition(),
    nowMs: 1000,
    random: () => 0.999
  });
}

test("migration defines additive execution, participant, order, answer, result, and command tables", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "004_knowledge_activities.sql"), "utf8");
  for (const table of [
    "knowledge_activity_executions",
    "knowledge_activity_participants",
    "knowledge_activity_participant_orders",
    "knowledge_activity_answers",
    "knowledge_activity_results",
    "knowledge_activity_commands"
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /UNIQUE KEY uq_knowledge_activity_active_session \(active_session_key\)/);
  assert.match(sql, /PRIMARY KEY \(execution_id, participant_id, question_id\)/);
  assert.match(sql, /PRIMARY KEY \(execution_id\),/);
});

test("presentation session is ensured independently of Screen", async () => {
  const pool = fakePool([
    [[], []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new KnowledgeActivityRepository(pool, {
    createId: () => "00000000-0000-0000-0000-000000000099"
  });
  const id = await repository.ensurePresentationSession({ deckId: "deck-1", sourceSessionId: "source-1" });
  assert.equal(id, "00000000-0000-0000-0000-000000000099");
  const inserts = pool.calls.filter((call) => /INSERT INTO presentation_sessions/.test(call.sql || ""));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].values, [id, "deck-1", "source-1"]);
});

test("execution insert reserves one active activity for the presentation session", async () => {
  const pool = fakePool();
  const item = execution();
  await new KnowledgeActivityRepository(pool).createExecution(item);
  const insert = pool.calls.find((call) => /INSERT INTO knowledge_activity_executions/.test(call.sql || ""));
  assert.equal(insert.values[8], item.presentationSessionId);
  assert.equal(JSON.parse(insert.values[9]).definitionId, "contest-1");
  assert.equal(insert.values[10], "1970-01-01 00:00:01.000");
  assert.doesNotMatch(insert.values[10], /T|Z/);
});

test("ISO activity dates are converted to MySQL DATETIME(3) values", () => {
  assert.equal(mysqlDateTime("2026-07-26T08:11:12.345Z"), "2026-07-26 08:11:12.345");
  assert.equal(mysqlDateTime(null), null);
  assert.throws(() => mysqlDateTime("not-a-date"), { code: "INVALID_DATE" });
});

test("execution snapshots exclude high-cardinality participant and answer arrays", () => {
  const item = execution();
  joinParticipant(item, { participantId: "participant-1", tabId: "tab-1", nowMs: 2000, random: () => 0.999 });
  item.answers.push({ participantId: "participant-1", questionId: "q1", optionId: "a", receivedAt: "1970-01-01T00:00:03.000Z" });
  const snapshot = snapshotForStorage(item);
  assert.equal("participants" in snapshot, false);
  assert.equal("answers" in snapshot, false);
  assert.equal(snapshot.definitionId, item.definitionId);
});

test("active execution recovery does not sort every historical live row", async () => {
  const pool = fakePool([[[], []]]);
  await new KnowledgeActivityRepository(pool).listActiveExecutions();
  const query = pool.calls.find((call) => /FROM knowledge_activity_executions/.test(call.sql || ""));
  assert.match(query.sql, /WHERE active_session_key IS NOT NULL/);
  assert.doesNotMatch(query.sql, /ORDER BY/);
});

test("active execution lookup does not sort historical sessions", async () => {
  const pool = fakePool([[[], []]]);
  await new KnowledgeActivityRepository(pool).loadActiveExecution({ deckId: "deck-1", sourceSessionId: "session-1" });
  const query = pool.calls.find((call) => /INNER JOIN presentation_sessions/.test(call.sql || ""));
  assert.match(query.sql, /active_session_key IS NOT NULL/);
  assert.doesNotMatch(query.sql, /ORDER BY/);
});

test("hydration restores participants and answers from normalized rows", () => {
  const item = execution();
  const snapshot = snapshotForStorage(item);
  const restored = hydrateExecution(snapshot, [{
    participant_id: "participant-1", recovery_token_hash: "a".repeat(64), user_number: 1,
    display_name: "Ada", public_label: "Ada", active_tab_id: "tab-1", state: "ACTIVE",
    joined_at: "1970-01-01 00:00:02.000", submitted_at: null, completed_at: null,
    question_order_json: JSON.stringify(["q1"]), option_orders_json: JSON.stringify({ q1: ["a", "b"] }),
    current_question_index: 0
  }], [{
    participant_id: "participant-1", question_id: "q1", option_id: "a", client_attempt_id: "attempt-1",
    correct: 1, elapsed_ms: 35, received_at: "1970-01-01 00:00:03.000"
  }]);
  assert.equal(restored.participants[0].label, "Ada");
  assert.deepEqual(restored.participants[0].questionOrder, ["q1"]);
  assert.equal(restored.answers[0].correct, true);
  assert.equal(restored.answers[0].elapsedMs, 35);
});

test("save is optimistic and persists participant order without exposing recovery data", async () => {
  const pool = fakePool([
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const item = execution();
  const previousRevision = item.revision;
  joinParticipant(item, {
    participantId: "participant-1",
    tabId: "tab-1",
    recoveryTokenHash: "a".repeat(64),
    nowMs: 2000,
    random: () => 0.999
  });
  await new KnowledgeActivityRepository(pool).saveExecution(item, { expectedRevision: previousRevision });
  const update = pool.calls.find((call) => /UPDATE knowledge_activity_executions/.test(call.sql || ""));
  assert.equal(update.values.at(-1), previousRevision);
  const participant = pool.calls.find((call) => /INSERT INTO knowledge_activity_participants/.test(call.sql || ""));
  const order = pool.calls.find((call) => /INSERT INTO knowledge_activity_participant_orders/.test(call.sql || ""));
  assert.ok(participant);
  assert.ok(order);
  assert.equal(participant.values[2], "a".repeat(64));
  assert.doesNotMatch(participant.sql, /recovery_token(?!_hash)/);
  assert.deepEqual(JSON.parse(order.values[2]), ["q1"]);
});

test("admission persists only the newly admitted participant", async () => {
  const pool = fakePool();
  const item = execution();
  joinParticipant(item, { participantId: "participant-1", tabId: "tab-1", nowMs: 2000, random: () => 0.999 });
  joinParticipant(item, { participantId: "participant-2", tabId: "tab-2", nowMs: 3000, random: () => 0.999 });
  await new KnowledgeActivityRepository(pool).saveExecution(item, {
    expectedRevision: 1,
    participants: [item.participants[1]]
  });
  const participantWrites = pool.calls.filter((call) => /INSERT INTO knowledge_activity_participants/.test(call.sql || ""));
  const orderWrites = pool.calls.filter((call) => /INSERT INTO knowledge_activity_participant_orders/.test(call.sql || ""));
  assert.equal(participantWrites.length, 1);
  assert.equal(orderWrites.length, 1);
  assert.equal(participantWrites[0].values[1], "participant-2");
});

test("answer persistence does not rewrite the complete audience into snapshot JSON", async () => {
  const pool = fakePool();
  const item = execution();
  for (let number = 1; number <= 1000; number += 1) {
    joinParticipant(item, { participantId: `participant-${number}`, tabId: `tab-${number}`, nowMs: number + 1000, random: () => 0.999 });
  }
  await new KnowledgeActivityRepository(pool).saveExecution(item, {
    expectedRevision: 1,
    participants: [item.participants[999]],
    answers: []
  });
  const update = pool.calls.find((call) => /UPDATE knowledge_activity_executions/.test(call.sql || ""));
  const storedSnapshot = JSON.parse(update.values[7]);
  assert.equal("participants" in storedSnapshot, false);
  assert.equal("answers" in storedSnapshot, false);
});

test("answer batch writes one execution revision and bulk participant and answer rows", async () => {
  const pool = fakePool();
  const item = execution();
  const participants = [];
  const answers = [];
  for (let number = 1; number <= 1000; number += 1) {
    const participant = joinParticipant(item, { participantId: `participant-${number}`, tabId: `tab-${number}`, nowMs: number + 1000, random: () => 0.999 });
    participant.state = "ACTIVE";
    participants.push(participant);
    answers.push({ participantId: participant.id, questionId: "q1", optionId: "a", correct: true, elapsedMs: 25, receivedAt: "1970-01-01T00:00:03.000Z" });
  }
  await new KnowledgeActivityRepository(pool).saveAnswerBatch(item, { expectedRevision: 1, participants, answers });
  const statements = pool.calls.filter((call) => call.type === "execute");
  assert.equal(statements.length, 3);
  assert.equal(statements[0].values.length, 12);
  assert.match(statements[1].sql, /VALUES \(\?, \?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?, \?\)/);
  assert.match(statements[2].sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?, \?, \?, \?\)/);
});

test("a definitive result is insert-only so a late calculation cannot overwrite it", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db", "knowledge-activity-repository.js"), "utf8");
  assert.match(source, /INSERT IGNORE INTO knowledge_activity_results/);
  assert.doesNotMatch(source, /ON DUPLICATE KEY UPDATE[\s\S]{0,200}result_json/);
});
