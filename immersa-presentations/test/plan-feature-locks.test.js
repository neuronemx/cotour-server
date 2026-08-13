const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const {
  CAPABILITIES,
  featureAccessForPlan,
  canUseFeature,
  requiredCapabilityForControllerEvent,
  isPaidMetricsEvent,
  changedDeckCapabilities
} = require("../auth/plan-features");
const { WorkspaceRepository } = require("../auth/workspace-repository");

test("FREE, SPEAKER and SPEAKER PRO expose the approved capability matrix", () => {
  const free = featureAccessForPlan("free");
  assert.equal(free.plan, "FREE");
  assert.equal(canUseFeature(free, CAPABILITIES.ACCESS_SCREEN), true);
  assert.equal(canUseFeature(free, CAPABILITIES.ACCESS_BACKSTAGE), false);
  assert.equal(canUseFeature(free, CAPABILITIES.POLLS_RUN), false);

  const speaker = featureAccessForPlan("speaker");
  for (const capability of [
    CAPABILITIES.ACCESS_BACKSTAGE,
    CAPABILITIES.POLLS_CONFIGURE,
    CAPABILITIES.POLLS_RUN,
    CAPABILITIES.QNA_RUN,
    CAPABILITIES.METRICS_BASIC
  ]) assert.equal(canUseFeature(speaker, capability), true, capability);
  for (const capability of [
    CAPABILITIES.RAFFLES_RUN,
    CAPABILITIES.TRIVIA_RUN,
    CAPABILITIES.ASSESSMENTS_RUN,
    CAPABILITIES.METRICS_EXPORT,
    CAPABILITIES.GAMES_RUN
  ]) assert.equal(canUseFeature(speaker, capability), false, capability);

  const pro = featureAccessForPlan("speaker-pro");
  for (const capability of [
    CAPABILITIES.RAFFLES_RUN,
    CAPABILITIES.TRIVIA_RUN,
    CAPABILITIES.ASSESSMENTS_RUN,
    CAPABILITIES.METRICS_EXPORT,
    CAPABILITIES.BRANDING_CUSTOM
  ]) assert.equal(canUseFeature(pro, capability), true, capability);
  assert.equal(canUseFeature(pro, CAPABILITIES.GAMES_RUN), false);
});

test("controller events resolve to an exact plan capability", () => {
  assert.equal(requiredCapabilityForControllerEvent("interaction:launch"), CAPABILITIES.POLLS_RUN);
  assert.equal(requiredCapabilityForControllerEvent("qna:set_open"), CAPABILITIES.QNA_RUN);
  assert.equal(requiredCapabilityForControllerEvent("raffle:create"), CAPABILITIES.RAFFLES_RUN);
  assert.equal(requiredCapabilityForControllerEvent("interaction:execution:open"), CAPABILITIES.TRIVIA_RUN);
  assert.equal(requiredCapabilityForControllerEvent("games:queue:start"), CAPABILITIES.GAMES_RUN);
  assert.equal(requiredCapabilityForControllerEvent("slide_next"), "");
});

test("presentation lifecycle is the basic Metrics capability", () => {
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:start"), true);
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:finish"), true);
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:request"), false);
});

test("Deck writes are checked per interaction family", () => {
  const current = {
    interactions: [{ id: "poll-1", prompt: "Actual" }],
    contests: [{ id: "contest-1" }],
    assessments: []
  };
  assert.deepEqual(changedDeckCapabilities({
    interactions: current.interactions,
    videos: [{ id: "video-1", slide_id: "slide-001" }],
    hidden_slide_ids: ["slide-002"]
  }, current), []);
  assert.deepEqual(changedDeckCapabilities({ interactions: [] }, current), [CAPABILITIES.POLLS_CONFIGURE]);
  assert.deepEqual(changedDeckCapabilities({ contests: [] }, current), [CAPABILITIES.TRIVIA_RUN]);
});

test("workspace plan is resolved from the Deck owner rather than the access link", async () => {
  const calls = [];
  const repository = new WorkspaceRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ plan: "SPEAKER" }]];
    }
  });
  assert.equal(await repository.getDeckPlan("deck-a"), "SPEAKER");
  assert.match(calls[0].sql, /FROM decks d[\s\S]+INNER JOIN workspaces w/);
  assert.deepEqual(calls[0].params, ["deck-a"]);
});

test("manual plan changes reject invalid plans before opening a transaction", async () => {
  let connectionRequested = false;
  const repository = new WorkspaceRepository({
    async getConnection() {
      connectionRequested = true;
      throw new Error("must not connect");
    }
  });
  await assert.rejects(
    repository.changePlan({ workspaceId: "workspace-a", plan: "ENTERPRISE", changedByUserId: "admin-a" }),
    (error) => error.code === "INVALID_PLAN" && error.statusCode === 400
  );
  assert.equal(connectionRequested, false);
});

test("Speaker and Backstage render plan-aware interaction categories", () => {
  const presenterHtml = read("public/presenter/index.html");
  const presenter = read("public/presenter/presenter.js");
  const stageHtml = read("public/stage/index.html");
  const stage = read("public/stage/stage.js");
  const shell = read("public/shared/interactions-shell.js");
  assert.match(presenterHtml, /id="interactionToggle"/);
  assert.match(presenter, /planAllows/);
  assert.match(presenter, /polls\.run/);
  assert.match(stageHtml, /<strong>Backstage<\/strong>/);
  assert.match(stage, /planAllows/);
  assert.match(stage, /metrics\.basic/);
  assert.match(shell, /polls: "SPEAKER"/);
  assert.match(shell, /raffles: "SPEAKER PRO"/);
});

test("server enforces capabilities independently of the client", () => {
  const server = read("server.js");
  assert.match(server, /socket\.use\(\(\[eventName\], next\) =>/);
  assert.match(server, /requiredCapabilityForControllerEvent\(eventName\)/);
  assert.match(server, /socket\.emit\("plan:feature_locked"/);
  assert.match(server, /requireDeckFeature\(CAPABILITIES\.METRICS_BASIC\)/);
  assert.match(server, /requireDeckFeature\(CAPABILITIES\.METRICS_EXPORT\)/);
  assert.match(server, /changedDeckCapabilities\(req\.body, current\)/);
  assert.match(server, /requireRequestedRoleFeature/);
});

test("Home keeps the plan sections visible and filters Backstage on FREE", () => {
  const home = read("public/home/index.html");
  const source = read("public/home/home.js");
  const shell = read("public/home/deck-management-shell.js");
  assert.match(home, /id="deckTabParticipation"/);
  assert.match(home, /id="deckTabMetrics"/);
  assert.match(source, /deckTabParticipation\.dataset\.planEnabled = String\(participationEnabled\)/);
  assert.match(shell, /planEnabled = participationTab\.dataset\.planEnabled === "true"/);
  assert.match(shell, /enabled = planEnabled \|\| demoMasterEnabled/);
  assert.match(source, /access\.backstage/);
  assert.match(source, /Backstage/);
});

test("Participation locks Speaker Pro editors before their forms can open", () => {
  const editor = read("public/home/interactions-editor.js");
  assert.match(editor, /canConfigure\("assessments\.run"\)/);
  assert.match(editor, /canConfigure\("trivia\.run"\)/);
  assert.match(editor, /moduleCardMarkup\("assessments", "Evaluaciones"[\s\S]+enabled: assessmentsEnabled/);
  assert.match(editor, /moduleCardMarkup\("contests", "Trivias"[\s\S]+enabled: contestsEnabled/);
  assert.match(editor, /interaction-form-status/);
  assert.doesNotMatch(editor, /moduleCardMarkup\("contests", "Concursos"/);
});
