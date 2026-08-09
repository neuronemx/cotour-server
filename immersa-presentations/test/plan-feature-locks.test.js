const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const { featureAccessForPlan, canUseFeature, isPaidControllerEvent, isPaidMetricsEvent, changesPaidDeckContent } = require("../auth/plan-features");
const { WorkspaceRepository } = require("../auth/workspace-repository");

test("FREE locks Interacciones and Métricas while paid plans enable them", () => {
  const free = featureAccessForPlan("free");
  assert.deepEqual(free, {
    plan: "FREE",
    features: { interactions: false, metrics: false }
  });
  assert.equal(canUseFeature(free, "interactions"), false);
  assert.equal(canUseFeature(free, "metrics"), false);

  const speaker = featureAccessForPlan("SPEAKER");
  assert.equal(canUseFeature(speaker, "interactions"), true);
  assert.equal(canUseFeature(speaker, "metrics"), true);
});

test("the central live guard covers paid interaction commands without blocking FREE tools", () => {
  for (const event of [
    "interaction:launch",
    "interaction:reveal_results",
    "raffle:create",
    "qna:set_open",
    "interaction:execution:open",
    "games:queue:start",
    "pong:start",
    "breakout:prepare",
    "time:command"
  ]) assert.equal(isPaidControllerEvent(event), true, event);

  for (const event of [
    "slide_next",
    "slide_prev",
    "drawing_stroke",
    "reaction",
    "overlay_update",
    "media:play"
  ]) assert.equal(isPaidControllerEvent(event), false, event);
});

test("the central live guard covers presentation Metrics recording", () => {
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:start"), true);
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:finish"), true);
  assert.equal(isPaidMetricsEvent("presentation:lifecycle:request"), false);
  assert.equal(isPaidMetricsEvent("slide_next"), false);
});

test("FREE can save Videos and slide visibility without changing paid Deck content", () => {
  const current = {
    interactions: [{ id: "poll-1", prompt: "Actual" }],
    contests: [{ id: "contest-1" }],
    assessments: []
  };
  assert.equal(changesPaidDeckContent({
    interactions: current.interactions,
    videos: [{ id: "video-1", slide_id: "slide-001" }],
    hidden_slide_ids: ["slide-002"]
  }, current), false);
  assert.equal(changesPaidDeckContent({
    interactions: [{ id: "poll-1", prompt: "Alterada" }],
    videos: []
  }, current), true);
  assert.equal(changesPaidDeckContent({ contests: [] }, current), true);
});

test("workspace plan is resolved from the Deck owner rather than the access link", async () => {
  const calls = [];
  const repository = new WorkspaceRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ plan: "FREE" }]];
    }
  });
  assert.equal(await repository.getDeckPlan("deck-a"), "FREE");
  assert.match(calls[0].sql, /FROM decks d[\s\S]+INNER JOIN workspaces w/);
  assert.deepEqual(calls[0].params, ["deck-a"]);
});

test("Speaker and Stage render a visible plan lock and cannot open Interacciones on FREE", () => {
  const presenterHtml = read("public/presenter/index.html");
  const presenter = read("public/presenter/presenter.js");
  const presenterStyles = read("public/shared/controller-tools.css");
  const stageHtml = read("public/stage/index.html");
  const stage = read("public/stage/stage.js");
  const stageStyles = read("public/stage/stage.css");

  assert.match(presenterHtml, /id="interactionToggle"[\s\S]+class="plan-feature-lock"/);
  assert.match(presenter, /roleOpenContext\.features\?\.interactions !== false/);
  assert.match(presenter, /interactionToggle\.disabled = true/);
  assert.match(presenter, /Disponible en planes de pago/);
  assert.match(presenterStyles, /\.interaction-button\.is-plan-locked \.plan-feature-lock/);

  assert.match(stageHtml, /id="stageActionsButton"[\s\S]*>Acciones<span class="plan-feature-lock"/);
  assert.match(stage, /roleOpenContext\.features\?\.interactions !== false/);
  assert.match(stage, /stageActionsButton\.disabled = true/);
  assert.match(stage, /Disponible en planes de pago/);
  assert.match(stageStyles, /\.actions-button\.is-plan-locked \.plan-feature-lock/);
  assert.match(stage, /syncPresentationLifecycleFeature\(roleOpenContext\.features\?\.metrics !== false\)/);
  assert.match(stage, /socket\.on\("plan:features"[\s\S]*access\.features\?\.metrics !== false/);
  assert.match(stage, /presentationLifecycleControl\?\.destroy\?\.\(\)/);
  assert.match(stageHtml, /\/stage\/stage\.js\?v=stage-v\d+/);
});

test("server enforces Interacciones and Métricas independently of disabled buttons", () => {
  const server = read("server.js");
  assert.match(server, /socket\.use\(\(\[eventName\], next\) =>/);
  assert.match(server, /isPaidControllerEvent\(eventName\)/);
  assert.match(server, /isPaidMetricsEvent\(eventName\)/);
  assert.match(server, /socket\.emit\("plan:feature_locked"/);
  assert.match(server, /feature === "metrics"[\s\S]*Métricas está disponible en planes de pago/);
  assert.match(server, /role === "audience"[\s\S]*canUseFeature\(currentFeatureAccess, "metrics"\)[\s\S]*AUTO_START_AUDIENCE_THRESHOLD/);
  assert.match(server, /app\.put\("\/api\/decks\/:deckId\/interactions", requireAccountOrControllerDeck, requireDeckConfigurationWrite/);
  assert.match(server, /changesPaidDeckContent\(req\.body, current\)/);
  assert.match(server, /\/api\/decks\/:deckId\/qna\/history"[\s\S]*requireDeckFeature\("metrics"\)/);
  assert.match(server, /\/api\/knowledge-activities\/:executionId\/export\/:access_token"[\s\S]*requireDeckFeature\("metrics"\)/);
  assert.match(server, /\/api\/qna\/history\/:access_token"[\s\S]*requireDeckFeature\("metrics"\)/);
});

test("Home keeps FREE Participación and Métricas visible but disabled", () => {
  const home = read("public/home/index.html");
  assert.match(home, /id="deckTabParticipation"[^>]+disabled[^>]+aria-disabled="true"[^>]*>[\s\S]*?<span>Participación<\/span>/);
  assert.match(home, /id="deckTabMetrics"[^>]+disabled[^>]+aria-disabled="true"[^>]*>[\s\S]*?<span>Métricas<\/span>/);
});
