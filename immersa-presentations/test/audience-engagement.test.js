const test = require("node:test");
const assert = require("node:assert/strict");
const { AudienceRegistrationRepository } = require("../audience-registration");
const { AudienceEngagementRepository, createEngagementHandler } = require("../audience-engagement");
const { PresentationMetricsRepository } = require("../presentation-metrics");
const { ReactionRuntime } = require("../reaction-runtime");
const { participantIdFor } = require("../knowledge-activity-sockets");
const { BrandMentionRuntime } = require("../brand-mention-runtime");

test("Contact registration requires explicit consent and a current revision and stores only a token hash", async () => {
  const writes = [];
  const repository = new AudienceRegistrationRepository({
    async execute(sql, params) {
      if (sql.startsWith("SELECT mode")) return [[{ mode: "required", terms_url: "https://example.com/terms", revision: 2 }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
  });
  const input = { name: "Ana", email: "ana@example.com", phone: "+52 55 1234 5678",
    company: "Ejemplo", audienceId: "aud_12345678", revision: 2 };
  await assert.rejects(repository.register("deck-a", input), /Acepta los términos/);
  await assert.rejects(repository.register("deck-a", { ...input, revision: 1, termsAccepted: true }), /vigentes/);
  await assert.rejects(repository.register("deck-a", { ...input, email: "bad", termsAccepted: true }), /correo/);
  assert.equal(writes.length, 0);
  const saved = await repository.register("deck-a", { ...input, termsAccepted: true });
  assert.match(saved.token, /^[a-f0-9]{64}$/);
  assert.equal(saved.revision, 2);
  assert.equal(writes[0].params.includes(saved.token), false);
  assert.equal(writes[0].params[6], "https://example.com/terms");
  assert.ok(writes[0].params[7] instanceof Date);
});

test("Mandatory and optional contact registration require a real HTTPS terms destination and versioned changes", async () => {
  const repository = new AudienceRegistrationRepository({ async execute() { return [{ affectedRows: 0 }]; } });
  for (const mode of ["optional", "required"]) {
    await assert.rejects(repository.saveConfig("deck", { mode, revision: 0, termsUrl: "" }), /términos/);
    await assert.rejects(repository.saveConfig("deck", { mode, revision: 0, termsUrl: "javascript:alert(1)" }), /términos/);
  }
  await assert.rejects(repository.saveConfig("deck", { mode: "name", revision: 2 }), { statusCode: 409 });
  assert.equal(await repository.verify("deck", "aud_12345678", "not-a-token"), null);
});

test("Engagement rejects a session from another Deck before reading attendees or contact details", async () => {
  let calls = 0;
  const repository = new AudienceEngagementRepository({ async execute(sql, params) {
    calls++;
    assert.match(sql, /id = \? AND deck_id = \?/);
    assert.deepEqual(params, ["foreign-session", "owned-deck"]);
    return [[]];
  } });
  assert.equal(await repository.details("owned-deck", "foreign-session"), null);
  assert.equal(calls, 1);
});

test("The attendee view joins saved poll responses, questions and derived knowledge identities without mixing people", async () => {
  const queries = [];
  const repository = new AudienceEngagementRepository({ async execute(sql, params) {
    queries.push({ sql, params });
    if (sql.includes("SELECT id, engagement_started")) return [[{ id: "session", engagement_started_at: "2026-11-12" }]];
    if (sql.includes("COUNT(*) AS total")) return [[{ total: 1 }]];
    if (sql.includes("a.display_name")) return [[{ audience_id: "aud_12345678", display_name: "Ana", email: "ana@example.com", locale: "es" }]];
    if (sql.includes("MAX(target_url)")) return [[{ brand_id: "brand", brand_name: "Marca", target_url: "https://example.com", impressions: 3, displays: 2, viewers: 1 }]];
    if (sql.includes("AS clickers")) return [[{ brand_id: "brand", clicks: 2, clickers: 1 }]];
    if (sql.includes("r.submitted_at")) return [[{ audience_id: "aud_12345678", prompt: "¿Perfil?", title: "Encuesta", label: "Creativo", submitted_at: "2026-11-12" }]];
    if (sql.includes("q.question_text")) return [[{ audience_id: "aud_12345678", question_text: "¿Cómo funciona?", created_at: "2026-11-12" }]];
    if (sql.includes("SUM(reaction_count)")) return [[{ audience_id: "aud_12345678", emoji: "❤️", total: 4 }]];
    if (sql.includes("FROM knowledge_activity_executions")) return [[{
      id: "execution", title: "Evaluación", category: "assessment",
      snapshot_json: { definition: { questions: [{ id: "q1", prompt: "¿Respuesta?", options: [{ id: "o1", label: "Uno" }] }] } }
    }]];
    if (sql.includes("FROM knowledge_activity_answers")) return [[{
      participant_id: participantIdFor("execution", "aud_12345678"), question_id: "q1", option_id: "o1", correct: 1, received_at: "2026-11-12"
    }]];
    if (sql.includes("AS views")) return [[{ audience_id: "aud_12345678", brand_id: "brand", brand_name: "Marca", views: 3, clicks: 2 }]];
    throw Error("Unexpected query: " + sql);
  } });
  const result = await repository.details("deck", "session");
  assert.equal(result.attendees[0].answers.length, 2);
  assert.equal(result.attendees[0].answers.find(a => a.type === "assessment").question, "¿Respuesta?");
  assert.equal(result.attendees[0].answers.find(a => a.type === "assessment").answer, "Uno");
  assert.equal(result.attendees[0].actions, 9);
  assert.equal(result.banners[0].clickers, 1);
  assert.equal(result.banners[0].clicks, 2);
  assert.match(queries.find(q => q.sql.includes("a.display_name")).sql, /LIMIT 100 OFFSET 0/);
});

test("Accepted reactions retain per-person counts when the first flush fails and is retried", async () => {
  const runtime = new ReactionRuntime({ emitScreen() {} });
  runtime.setRecording("session");
  const socket = { emit() {} };
  runtime.react({ socket, audienceId: "Ana", emoji: "❤️" });
  runtime.react({ socket, audienceId: "Ana", emoji: "❤️" });
  runtime.react({ socket, audienceId: "Luis", emoji: "👏" });
  let fail = true, saved;
  const repository = {
    async recordReactionSnapshot() {},
    async recordAudienceReactions(snapshot) {
      if (fail) throw Error("temporary write failure");
      saved = snapshot;
    }
  };
  await assert.rejects(runtime.flush(repository, {}));
  fail = false;
  await runtime.flush(repository, {});
  assert.deepEqual(saved.audience, [["Ana", { "❤️": 2 }], ["Luis", { "👏": 1 }]]);
  assert.equal(saved.presentationSessionId, "session");
});

test("Banner reports accept only server-issued occurrences and an audience identity", async () => {
  const calls = [];
  const runtime = new BrandMentionRuntime({
    io: { to: () => ({ emit() {} }) }, store: {}, getRoleRoomKey: x => x, now: () => 1000,
    recordEvent: async (...args) => { calls.push(args); return true; }
  });
  const context = { roomKey: "room", role: "audience", audienceId: "aud_12345678" };
  const state = runtime.stateFor(context);
  state.recent.set("display", { display_id: "display", visible_until: 8000 });
  const event = { kind: "click", displayId: "display", eventId: "1".repeat(36) };
  assert.equal(await runtime.recordAudienceEvent({ ...context, role: "screen" }, event), false);
  assert.equal(await runtime.recordAudienceEvent(context, { ...event, displayId: "forged" }), false);
  assert.equal(await runtime.recordAudienceEvent(context, event), true);
  assert.equal(calls.length, 1);
  runtime.close();
});

test("View and click retries use idempotent inserts and take the brand and target from the server", async () => {
  const writes = [];
  const repository = new PresentationMetricsRepository({ async execute(sql, params) {
    if (sql.startsWith("SELECT id")) return [[{ id: "session" }]];
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  } });
  const context = { deckId: "deck", sessionId: "live", audienceId: "aud_12345678" };
  const mention = { display_id: "display", id: "brand", name: "Marca", target_url: "https://example.com", shown_at: Date.now() };
  await repository.recordBannerEvent(context, mention, "click", "event");
  await repository.recordBannerEvent(context, mention, "click", "event");
  assert.ok(writes.every(row => row.sql.includes("INSERT IGNORE")));
  assert.deepEqual(writes[0].params, ["session", "display", "aud_12345678", "brand", "Marca", "https://example.com"]);
  assert.deepEqual(writes[1].params, ["session", "event", "display", "aud_12345678"]);
});

test("Engagement paging rejects invalid offsets without running queries", async () => {
  const handler = createEngagementHandler({ details() { throw Error("must not query"); } });
  let code, body;
  const response = { status(value) { code = value; return this; }, json(value) { body = value; } };
  await handler({ query: { page: "-1" } }, response);
  assert.equal(code, 400);
  assert.match(body.error, /Página/);
});
