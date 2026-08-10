const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appDir = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(appDir, relativePath), "utf8");
const {
  DEMO_MASTER_DECK_ID,
  DEMO_PLAN,
  DEMO_CAPABILITY_PLAN,
  createDemoBinding,
  isDemoDeckId,
  demoDeckSummary,
  demoManifest,
  assertDemoConfigurationStructure
} = require("../auth/deck-demo");
const { featureAccessForPlan } = require("../auth/plan-features");

test("the official Demo uses one master resource and isolated workspace identities", () => {
  const first = createDemoBinding("workspace-a");
  const second = createDemoBinding("workspace-b");
  assert.equal(first.workspaceId, "workspace-a");
  assert.equal(isDemoDeckId(first.deckId), true);
  assert.equal(isDemoDeckId(second.deckId), true);
  assert.notEqual(first.deckId, second.deckId);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(DEMO_MASTER_DECK_ID, "immersa-demo");
  assert.equal(DEMO_PLAN, "DEMO");
  assert.equal(DEMO_CAPABILITY_PLAN, "SPEAKER_PRO");
});

test("Demo identity replaces only runtime identity and preserves the central content", () => {
  const binding = { workspaceId: "workspace-a", deckId: "immersa-demo-aaaaaaaaaaaaaaaaaaaaaaaa", sessionId: "demo-session-a" };
  const master = { deckId: "immersa-demo", session_id: "master", title: "Conoce IMMERSA", slides: [{ id: "slide-001" }] };
  const summary = demoDeckSummary(master, binding);
  assert.equal(summary.deckId, binding.deckId);
  assert.equal(summary.session_id, binding.sessionId);
  assert.equal(summary.isDemo, true);
  assert.equal(summary.readOnly, true);
  assert.equal(summary.plan, "SPEAKER_PRO");
  assert.equal(summary.sourceSizeBytes, 0);
  const manifest = demoManifest(master, binding);
  assert.equal(manifest.deckId, binding.deckId);
  assert.equal(manifest.session_id, binding.sessionId);
  assert.equal(manifest.slides, master.slides);
});

test("Demo mode grants paid live capabilities without changing the workspace plan", () => {
  const access = featureAccessForPlan(DEMO_PLAN);
  assert.deepEqual(access, {
    plan: "DEMO",
    features: { interactions: true, metrics: true }
  });
});

test("the Demo schema stores only an isolated binding, not a copied Deck", () => {
  const migration = read("db/migrations/010_deck_demo.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS workspace_demo_sessions/);
  assert.match(migration, /PRIMARY KEY \(workspace_id\)/);
  assert.match(migration, /UNIQUE KEY uq_workspace_demo_deck \(deck_id\)/);
  assert.match(migration, /UNIQUE KEY uq_workspace_demo_session \(session_id\)/);
  assert.doesNotMatch(migration, /manifest|slides|interactions|source_size_bytes/);
});

test("the master Demo contains ten slides and Speaker Pro activities only", () => {
  const manifest = JSON.parse(read("public/decks/immersa-demo/manifest.json"));
  const config = JSON.parse(read("public/decks/immersa-demo/interactions.json"));
  assert.equal(manifest.slides.length, 10);
  assert.equal(new Set(manifest.slides.map((slide) => slide.id)).size, 10);
  manifest.slides.forEach((slide) => {
    assert.match(slide.src, /^\/decks\/immersa-demo\/slides\/slide-\d{3}\.svg$/);
    assert.equal(fs.existsSync(path.join(appDir, "public", slide.src)), true, slide.src);
  });
  assert.equal(config.interactions.length, 1);
  assert.equal(config.contests.length, 1);
  assert.equal(config.assessments.length, 1);
  assert.equal(config.videos.length, 0);
  assert.equal(fs.existsSync(path.join(appDir, "public/decks/demo/interactions.json")), false);
});

test("Demo slides explain the FREE, SPEAKER and SPEAKER PRO ladder", () => {
  const slide = (number) => read("public/decks/immersa-demo/slides/slide-" + String(number).padStart(3, "0") + ".svg");
  assert.match(slide(1), /FREE  →  SPEAKER  →  SPEAKER PRO/);
  [2, 3].forEach((number) => assert.match(slide(number), /INCLUIDO DESDE FREE/));
  [4, 5, 9].forEach((number) => assert.match(slide(number), /INCLUIDO DESDE SPEAKER/));
  [6, 7, 8].forEach((number) => assert.match(slide(number), /INCLUIDO DESDE SPEAKER PRO/));
  assert.match(slide(10), /FREE  →  SPEAKER  →  SPEAKER PRO/);
});

test("Home presents Demo as permanent, structurally protected and restorable", () => {
  const html = read("public/home/index.html");
  const home = read("public/home/home.js");
  const interactions = read("public/home/interactions-editor.js");
  const video = read("public/home/video-editor.js");
  const account = read("public/home/home-account.js");
  assert.match(html, /id="detailDemoReset"[^>]+hidden/);
  assert.match(home, /badge\.textContent = "Modo demostración"/);
  assert.match(home, /if \(!isDemoDeck\(deck\)\) row\.appendChild\(deleteButton\)/);
  assert.match(home, /detailRename\.hidden = demo/);
  assert.match(home, /detailReplace\.hidden = demo/);
  assert.match(home, /fetch\("\/api\/account\/demo\/reset"/);
  assert.match(interactions, /currentDeck\?\.demoEditable === true/);
  assert.match(interactions, /function canChangeStructure\(\)/);
  assert.match(video, /currentDeck\?\.demoEditable === true/);
  assert.match(video, /bodyNode\.appendChild\(add\)/);
  assert.match(account, /fetch\("\/api\/account\/demo\/reset", \{ method: "POST" \}\)/);
});

test("Demo content edits preserve the master question and answer structure", () => {
  const master = JSON.parse(read("public/decks/immersa-demo/interactions.json"));
  const edited = JSON.parse(JSON.stringify(master));
  edited.interactions[0].prompt = "Una pregunta temporal";
  edited.interactions[0].options[0].label = "Una respuesta temporal";
  edited.contests[0].questions[0].correctOptionId = edited.contests[0].questions[0].options[1].id;
  assert.doesNotThrow(() => assertDemoConfigurationStructure(edited, master));

  edited.contests[0].questions.push(JSON.parse(JSON.stringify(edited.contests[0].questions[0])));
  assert.throws(
    () => assertDemoConfigurationStructure(edited, master),
    (error) => error.code === "DEMO_STRUCTURE_LOCKED"
  );
});

test("server lists, protects and resets the Demo independently of normal Deck quota", () => {
  const server = read("server.js");
  const repository = read("auth/workspace-repository.js");
  assert.match(server, /res\.json\(\[await demoSummaryForBinding\(binding\), \.\.\.decks\]\)/);
  assert.match(server, /app\.post\("\/api\/account\/demo\/reset", requireAccount/);
  assert.match(server, /code: "DEMO_READ_ONLY"/);
  assert.match(server, /resolveDeckManifestBySessionId: resolveDemoDeckManifestBySessionId/);
  assert.match(server, /scheduleDisconnectedDemoRestore/);
  assert.match(server, /DEMO_DISCONNECT_RESTORE_DELAY_MS = 2 \* 60 \* 1000/);
  assert.match(server, /DEMO_INACTIVITY_RESTORE_DELAY_MS = 30 \* 60 \* 1000/);
  assert.match(server, /scheduleInactiveDemoRestore/);
  assert.match(server, /socket\.onAny/);
  assert.match(server, /DEMO_PASSIVE_SOCKET_EVENTS\.has\(eventName\)/);
  assert.match(server, /"media:playback_update"/);
  assert.match(server, /trackDemoConfigurationActivity/);
  assert.match(server, /removeDemoPracticeDir/);
  assert.match(repository, /INSERT INTO workspace_demo_sessions/);
  assert.match(repository, /DELETE FROM presentation_sessions WHERE deck_id = \?/);
  assert.match(repository, /reset_count = reset_count \+ 1/);
  assert.doesNotMatch(repository.match(/async getPlanUsage[\s\S]+?async listUnmeteredDeckIds/)[0], /workspace_demo_sessions/);
});

test("Speaker and Stage receive an explicit Demo context and visible badge", () => {
  const accessLinks = read("access-links.js");
  const presenterHtml = read("public/presenter/index.html");
  const presenter = read("public/presenter/presenter.js");
  const stageHtml = read("public/stage/index.html");
  const stage = read("public/stage/stage.js");
  assert.match(accessLinks, /demo_mode: featureAccess\.plan === "DEMO"/);
  assert.match(presenterHtml, /id="demoModeBadge"[^>]*hidden>Demo<\/span>/);
  assert.match(stageHtml, /id="demoModeBadge"[^>]*hidden>Demo<\/span>/);
  assert.match(presenter, /roleOpenContext\.demo_mode !== true/);
  assert.match(stage, /roleOpenContext\.demo_mode !== true/);
  assert.match(presenter, /planLabels: roleOpenContext\.demo_mode === true/);
  assert.match(stage, /planLabels: roleOpenContext\.demo_mode === true/);
});

test("inactive live Demo views reload after their isolated practice is restored", () => {
  [
    "public/presenter/presenter.js",
    "public/stage/stage.js",
    "public/screen/screen.js",
    "public/audience/audience.js"
  ].forEach((file) => {
    assert.match(read(file), /socket\.on\("demo:practice_restored", \(\) => window\.location\.reload\(\)\)/);
  });
});

test("all presentation roles resolve central Demo slide assets without duplicating the workspace path", () => {
  const presenter = read("public/presenter/presenter.js");
  const stage = read("public/stage/stage.js");
  const screen = read("public/screen/screen.js");
  const audience = read("public/audience/audience.js");
  [presenter, stage, screen, audience].forEach((source) => {
    assert.match(source, /value\.startsWith\("\/"\)/);
  });
});

test("Demo starts Q&A from Speaker or Stage and keeps Event Hub Games out of its actions", () => {
  const accessLinks = read("access-links.js");
  const presenter = read("public/presenter/presenter.js");
  const stage = read("public/stage/stage.js");
  assert.match(accessLinks, /deck\?\.demoMode && \['speaker', 'stage'\]\.includes\(accessLink\.role\)/);
  assert.match(presenter, /games: roleOpenContext\.demo_mode !== true/);
  assert.match(stage, /games: roleOpenContext\.demo_mode !== true/);
});
