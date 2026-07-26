const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createExecution, joinParticipant } = require("../knowledge-activity-engine");
const { KnowledgeActivityRepository } = require("../db/knowledge-activity-repository");

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

test("a definitive result is insert-only so a late calculation cannot overwrite it", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db", "knowledge-activity-repository.js"), "utf8");
  assert.match(source, /INSERT IGNORE INTO knowledge_activity_results/);
  assert.doesNotMatch(source, /ON DUPLICATE KEY UPDATE[\s\S]{0,200}result_json/);
});
