const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PresentationMetricsRepository } = require("../presentation-metrics");

test("attendance stores unique audience members and the connected peak", async () => {
  const calls = [];
  const pool = { async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const repository = new PresentationMetricsRepository(pool);
  await repository.recordAudienceSnapshot({
    presentationSessionId: "session-1",
    audience: [{ audienceId: "a-1" }, { audienceId: "a-1" }, { audienceId: "a-2" }],
    connectedCount: 5
  });
  assert.match(calls[0].sql, /INSERT IGNORE INTO presentation_session_attendance/);
  assert.deepEqual(calls[0].params, ["session-1", "a-1", "session-1", "a-2"]);
  assert.match(calls[1].sql, /GREATEST\(audience_peak_count, \?\)/);
  assert.deepEqual(calls[1].params, [5, "session-1"]);
});

test("poll snapshots persist options and one response per audience", async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new PresentationMetricsRepository(pool, { createPollExecutionId: () => "poll-run-1" });
  assert.equal(await repository.recordPollSnapshot({
    presentationSessionId: "session-1",
    snapshot: {
      active: {
        id: "poll-1", title: "Preferencia", prompt: "¿Cuál?", launchedAt: "2026-08-14T05:00:00.000Z",
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }]
      },
      responses: [{ audienceId: "aud-1", optionId: "b", submittedAt: "2026-08-14T05:01:00.000Z" }]
    },
    closedAt: "2026-08-14T05:02:00.000Z"
  }), true);
  assert.equal(calls.filter((call) => /INSERT INTO presentation_poll_options/.test(call.sql)).length, 2);
  assert.equal(calls.filter((call) => /INSERT INTO presentation_poll_responses/.test(call.sql)).length, 1);
  assert.equal(calls.some((call) => /SET closed_at = COALESCE/.test(call.sql)), true);
  assert.equal(calls.some((call) => /SELECT id FROM presentation_poll_executions/.test(call.sql)), false);
  assert.equal(calls.filter((call) => call.params?.[0] === "poll-run-1").length >= 4, true);
});

test("poll execution ids are stable for repeated snapshots of one launch", async () => {
  const ids = [];
  const pool = { async execute(sql, params) { if (/INSERT INTO presentation_poll_executions/.test(sql)) ids.push(params[0]); return [{ affectedRows: 1 }]; } };
  const repository = new PresentationMetricsRepository(pool);
  const snapshot = {
    active: {
      id: "poll-1", title: "Encuesta", prompt: "¿Cuál?", launchedAt: "2026-08-14T05:00:00.123Z",
      options: [{ id: "a", label: "A" }]
    },
    responses: []
  };
  await repository.recordPollSnapshot({ presentationSessionId: "session-1", snapshot });
  await repository.recordPollSnapshot({ presentationSessionId: "session-1", snapshot });
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
});

test("socket sessionId resolves the active live presentation for poll persistence", async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/FROM presentation_sessions/.test(sql)) return [[{ id: "live-1" }]];
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new PresentationMetricsRepository(pool, { createPollExecutionId: () => "poll-run-1" });
  const result = await repository.recordPollForContext(
    { deckId: "deck-1", sessionId: "source-room-1" },
    { active: { id: "poll-1", title: "Encuesta", prompt: "¿Cuál?", launchedAt: "2026-08-14T05:00:00.000Z", options: [{ id: "a", label: "A" }] }, responses: [] }
  );
  assert.equal(result, true);
  assert.deepEqual(calls[0].params, ["deck-1", "source-room-1"]);
  assert.equal(calls.some((call) => /INSERT INTO presentation_poll_executions/.test(call.sql)), true);
});

test("basic metrics combine session, attendance, polls and Q&A", async () => {
  let query = 0;
  const pool = {
    async execute() {
      query += 1;
      if (query === 1) return [[{
        id: "session-1", source_session_id: "room-1", recording_started_at: "2026-08-14T05:00:00.000Z",
        ended_at: "2026-08-14T05:30:00.000Z", duration_seconds: 1800, audience_peak_count: 8, participant_count: 10
      }]];
      if (query === 2) return [[
        { id: "run-1", presentation_session_id: "session-1", interaction_id: "poll-1", title: "Encuesta", prompt: "¿A?", launched_at: "2026-08-14T05:10:00.000Z", closed_at: "2026-08-14T05:12:00.000Z", option_id: "a", label: "A", sort_order: 0, response_count: 6 },
        { id: "run-1", presentation_session_id: "session-1", interaction_id: "poll-1", title: "Encuesta", prompt: "¿A?", launched_at: "2026-08-14T05:10:00.000Z", closed_at: "2026-08-14T05:12:00.000Z", option_id: "b", label: "B", sort_order: 1, response_count: 4 }
      ]];
      return [[{ presentation_session_id: "session-1", questions_received: 7, questions_projected: 3 }]];
    }
  };
  const [session] = await new PresentationMetricsRepository(pool).listDeckSessions("deck-1");
  assert.equal(session.durationSeconds, 1800);
  assert.deepEqual(session.participants, { connected: 10, peak: 8 });
  assert.equal(session.polls[0].totalResponses, 10);
  assert.deepEqual(session.polls[0].options.map((option) => option.count), [6, 4]);
  assert.deepEqual(session.polls[0].options.map((option) => option.percentage), [60, 40]);
  assert.deepEqual(session.qna, { received: 7, projected: 3 });
});

test("session metrics count attendance per session without grouping the full audience join", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "presentation-metrics.js"), "utf8");
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*presentation_session_attendance/);
  assert.doesNotMatch(source, /LEFT JOIN presentation_session_attendance psa ON psa\.presentation_session_id = ps\.id/);
});

test("server exposes Speaker basic metrics only through deck ownership and plan capability", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const migration = fs.readFileSync(path.join(root, "db", "migrations", "015_speaker_basic_metrics.sql"), "utf8");
  assert.match(server, /AUTO_START_AUDIENCE_THRESHOLD = 5/);
  assert.match(server, /\/api\/decks\/:deckId\/metrics\/basic/);
  assert.match(server, /requireDeckFeature\(CAPABILITIES\.METRICS_BASIC\)/);
  assert.match(server, /persistMetricsForPresentation\?\.\(context, presentationSessionId\)/);
  assert.match(migration, /presentation_session_attendance/);
  assert.match(migration, /presentation_poll_executions/);
  assert.match(migration, /presentation_poll_responses/);
});
