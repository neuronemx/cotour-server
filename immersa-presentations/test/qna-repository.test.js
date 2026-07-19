const assert = require("node:assert/strict");
const test = require("node:test");
const { QnaError, QnaRepository } = require("../db/qna-repository");
const { buildQnaCsv } = require("../qna-csv");

function fakePool(responses = []) {
  const calls = [];
  const queue = [...responses];
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
    connection,
    async getConnection() { return connection; },
    async execute(sql, values) { return connection.execute(sql, values); }
  };
}

function ids() {
  const values = ["session-1", "round-1", "question-1", "round-2"];
  return () => values.shift();
}

test("starts each deck execution as a distinct historical session and first round", async () => {
  const pool = fakePool();
  const repository = new QnaRepository(pool, { createId: ids() });
  const result = await repository.startPresentationSession({ deckId: "deck-a", sourceSessionId: "room-a" });
  assert.deepEqual(result, {
    presentationSessionId: "session-1",
    qnaRoundId: "round-1",
    roundNumber: 1,
    questionsOpen: false
  });
  const inserts = pool.calls.filter((call) => /INSERT INTO/.test(call.sql || ""));
  assert.deepEqual(inserts[0].values, ["session-1", "deck-a", "room-a"]);
  assert.deepEqual(inserts[1].values, ["round-1", "session-1"]);
  assert.deepEqual(pool.calls.map((call) => call.type), ["begin", "execute", "execute", "commit", "release"]);
});

test("new Screen execution archives the previous active round and presentation session", async () => {
  const pool = fakePool();
  const repository = new QnaRepository(pool, { createId: ids() });
  await repository.startPresentationSession({
    deckId: "deck-a",
    sourceSessionId: "room-a",
    replaceActive: true
  });
  const statements = pool.calls.filter((call) => call.type === "execute");
  assert.match(statements[0].sql, /UPDATE qna_rounds/);
  assert.deepEqual(statements[0].values, ["deck-a", "room-a"]);
  assert.match(statements[1].sql, /UPDATE presentation_sessions/);
  assert.deepEqual(statements[1].values, ["deck-a", "room-a"]);
  assert.match(statements[2].sql, /INSERT INTO presentation_sessions/);
  assert.match(statements[3].sql, /INSERT INTO qna_rounds/);
});

test("submits one normalized question only while the active round is open", async () => {
  const pool = fakePool([
    [[{ id: "round-1", round_number: 1, questions_open: 1 }], []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new QnaRepository(pool, { createId: () => "question-1" });
  const result = await repository.submitQuestion({
    presentationSessionId: "session-1",
    audienceId: "audience-1",
    questionText: "  ¿Cómo funciona?  ",
    name: "  Ana  ",
    allowNameOnScreen: true
  });
  assert.deepEqual(result, { questionId: "question-1", qnaRoundId: "round-1" });
  const insert = pool.calls.find((call) => /INSERT INTO qna_questions/.test(call.sql || ""));
  assert.deepEqual(insert.values, ["question-1", "round-1", "audience-1", "¿Cómo funciona?", "Ana", 1]);
});

test("maps the database uniqueness rule to one question per audience and round", async () => {
  const duplicate = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY", errno: 1062 });
  const pool = fakePool([
    [[{ id: "round-1", round_number: 1, questions_open: 1 }], []],
    duplicate
  ]);
  const repository = new QnaRepository(pool, { createId: () => "question-1" });
  await assert.rejects(
    repository.submitQuestion({ presentationSessionId: "session-1", audienceId: "audience-1", questionText: "Otra" }),
    (error) => error instanceof QnaError && error.code === "QNA_ALREADY_SUBMITTED"
  );
  assert.ok(pool.calls.some((call) => call.type === "rollback"));
  assert.ok(!pool.calls.some((call) => call.type === "commit"));
});

test("selection atomically replaces the previously selected question", async () => {
  const pool = fakePool([
    [[{ id: "question-2", qna_round_id: "round-1", projected_at: null }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new QnaRepository(pool);
  await repository.selectQuestion({ presentationSessionId: "session-1", questionId: "question-2" });
  const updates = pool.calls.filter((call) => call.type === "execute").slice(1);
  assert.match(updates[0].sql, /status = 'new', selected_round_id = NULL/);
  assert.deepEqual(updates[0].values, ["round-1"]);
  assert.match(updates[1].sql, /status = 'selected', selected_round_id = qna_round_id/);
  assert.deepEqual(updates[1].values, ["question-2"]);
});

test("projection marks the answer once and physical deletion rejects answered questions", async () => {
  const projectionPool = fakePool([
    [[{ id: "question-1", qna_round_id: "round-1", projected_at: null }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new QnaRepository(projectionPool);
  await repository.projectQuestion({ presentationSessionId: "session-1", questionId: "question-1" });
  const projection = projectionPool.calls.find((call) => /COALESCE\(projected_at/.test(call.sql || ""));
  assert.ok(projection);

  const deletionPool = fakePool([
    [[{ id: "question-1", qna_round_id: "round-1", projected_at: new Date() }], []]
  ]);
  await assert.rejects(
    new QnaRepository(deletionPool).deleteQuestion({ presentationSessionId: "session-1", questionId: "question-1" }),
    (error) => error instanceof QnaError && error.code === "QNA_ALREADY_PROJECTED"
  );
  assert.ok(!deletionPool.calls.some((call) => /^DELETE FROM/.test((call.sql || "").trim())));
});

test("new round archives the current one and preserves the open-questions slider", async () => {
  const pool = fakePool([
    [[{ id: "session-1" }], []],
    [[{ id: "round-1", round_number: 1, questions_open: 1 }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new QnaRepository(pool, { createId: () => "round-2" });
  const result = await repository.newRound({ presentationSessionId: "session-1" });
  assert.deepEqual(result, { qnaRoundId: "round-2", roundNumber: 2, questionsOpen: true });
  const archive = pool.calls.find((call) => /SET archived_at/.test(call.sql || ""));
  const insert = pool.calls.find((call) => /INSERT INTO qna_rounds/.test(call.sql || ""));
  assert.deepEqual(archive.values, ["round-1"]);
  assert.deepEqual(insert.values, ["round-2", "session-1", 2, 1]);
});

test("reads the exact active round including the persisted selection and answer state", async () => {
  const createdAt = new Date("2026-07-19T05:00:00.000Z");
  const projectedAt = new Date("2026-07-19T05:01:00.000Z");
  const pool = fakePool([[[
    {
      qna_round_id: "round-2",
      round_number: 2,
      questions_open: 1,
      question_id: "question-2",
      question_text: "¿Qué sigue?",
      name: "Ana",
      allow_name_on_screen: 1,
      status: "selected",
      projected_at: projectedAt,
      created_at: createdAt
    }
  ], []]]);
  const state = await new QnaRepository(pool).getActiveState("session-1");
  assert.deepEqual(state, {
    roundId: "round-2",
    roundNumber: 2,
    questionsOpen: true,
    selectedQuestionId: "question-2",
    questions: [{
      id: "question-2",
      text: "¿Qué sigue?",
      name: "Ana",
      allowNameOnScreen: true,
      status: "selected",
      answered: true,
      projectedAt,
      createdAt
    }]
  });
});

test("audience state exposes opening and one-submission status without leaking questions", async () => {
  const pool = fakePool([[[{
    qna_round_id: "round-2",
    round_number: 2,
    questions_open: 1,
    question_id: "question-2"
  }], []]]);
  const state = await new QnaRepository(pool).getAudienceState({
    presentationSessionId: "session-1",
    audienceId: "audience-1"
  });
  assert.deepEqual(state, {
    roundId: "round-2",
    roundNumber: 2,
    questionsOpen: true,
    hasSubmitted: true,
    questionId: "question-2"
  });
  assert.equal(Object.hasOwn(state, "questions"), false);
});

test("exports every existing question with Respondida Sí/No and spreadsheet-safe cells", async () => {
  const createdAt = new Date("2026-07-19T05:00:00.000Z");
  const pool = fakePool([[[
    {
      presentation_session_id: "session-1",
      deck_id: "deck-a",
      round_number: 1,
      question_id: "question-1",
      question_text: "=HYPERLINK(\"bad\")",
      name: "Ana, MX",
      projected_at: null,
      created_at: createdAt
    },
    {
      presentation_session_id: "session-1",
      deck_id: "deck-a",
      round_number: 2,
      question_id: "question-2",
      question_text: "¿Qué sigue?",
      name: null,
      projected_at: createdAt,
      created_at: createdAt
    }
  ], []]]);
  const rows = await new QnaRepository(pool).listExportQuestions("session-1");
  const csv = buildQnaCsv(rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Respondida"/);
  assert.match(csv, /"No"/);
  assert.match(csv, /"Sí"/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"Ana, MX"/);
});
