const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DEMO_MASTER_DECK_ID,
  DEMO_PUBLISHED_DECK_ID,
  DEMO_SESSION_VISIBILITY_TTL_MS,
  isImmersaAdmin,
  demoSessionIdForAccount,
  createDemoSessionVisibilityStore,
  updateMasterSlidePlan,
  publishMasterDeck,
  seedSystemDemoDeck,
  readSystemDemoManifest
} = require("../system-demo-deck");

const appDir = path.join(__dirname, "..");

async function makeMaster(t, planLevels = ["FREE", "SPEAKER", "SPEAKER_PRO"]) {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-demo-master-"));
  t.after(() => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const decksDir = path.join(dataDir, "decks");
  const masterDir = path.join(decksDir, DEMO_MASTER_DECK_ID);
  await fs.promises.mkdir(path.join(masterDir, "slides"), { recursive: true });
  await fs.promises.mkdir(path.join(masterDir, "thumbs"), { recursive: true });
  const slides = [];
  for (let index = 0; index < planLevels.length; index += 1) {
    const id = "slide-" + String(index + 1).padStart(3, "0");
    await fs.promises.writeFile(path.join(masterDir, "slides", id + ".jpg"), "slide-" + index);
    await fs.promises.writeFile(path.join(masterDir, "thumbs", id + ".jpg"), "thumb-" + index);
    slides.push({ id, src: "slides/" + id + ".jpg", thumb: "thumbs/" + id + ".jpg", planLevel: planLevels[index] });
  }
  await fs.promises.writeFile(path.join(masterDir, "interactions.json"), JSON.stringify({ interactions: [{ id: "poll-a" }] }));
  await fs.promises.writeFile(path.join(masterDir, "manifest.json"), JSON.stringify({
    deckId: DEMO_MASTER_DECK_ID,
    title: "Deck Demo Maestro",
    session_id: "s_masterdemo1",
    status: "converted",
    conversion: { status: "completed" },
    systemDemo: { role: "master" },
    slides
  }));
  return { dataDir, decksDir, masterDir };
}

test("IMMERSA administrator access is explicit and case insensitive", () => {
  const env = { IMMERSA_ADMIN_EMAILS: "arturo@example.com, ops@example.com" };
  assert.equal(isImmersaAdmin({ user: { email: "ARTURO@example.com" } }, env), true);
  assert.equal(isImmersaAdmin({ user: { email: "speaker@example.com" } }, env), false);
});

test("each account receives a stable private Demo session", () => {
  const env = { IMMERSA_ROUTE_GUARD_SECRET: "test-secret" };
  const first = demoSessionIdForAccount({ user: { id: "user-a" } }, env);
  assert.equal(first, demoSessionIdForAccount({ user: { id: "user-a" } }, env));
  assert.notEqual(first, demoSessionIdForAccount({ user: { id: "user-b" } }, env));
  assert.match(first, /^demo_[a-f0-9]{20}$/);
});

test("published Demo slide visibility is isolated per temporary session", () => {
  let currentTime = 1_000;
  const store = createDemoSessionVisibilityStore({ now: () => currentTime, ttlMs: 100 });
  const slideIds = ["slide-001", "slide-002", "slide-003"];

  assert.deepEqual(store.get("session-a", slideIds, ["slide-001"]), ["slide-001"]);
  assert.deepEqual(store.set("session-a", ["slide-002", "missing"], slideIds), ["slide-002"]);
  assert.deepEqual(store.get("session-a", slideIds), ["slide-002"]);
  assert.deepEqual(store.get("session-b", slideIds), []);
  assert.throws(
    () => store.set("session-a", slideIds, slideIds),
    (error) => error.statusCode === 400
  );

  currentTime += 101;
  assert.deepEqual(store.get("session-a", slideIds, ["slide-003"]), ["slide-003"]);
  assert.equal(DEMO_SESSION_VISIBILITY_TTL_MS, 30 * 60 * 1000);
});

test("the Master stores plan level by stable slide id", async (t) => {
  const { decksDir } = await makeMaster(t, [null, "SPEAKER"]);
  await updateMasterSlidePlan(decksDir, "slide-001", "speaker pro");
  const manifest = await readSystemDemoManifest(decksDir, DEMO_MASTER_DECK_ID);
  assert.equal(manifest.slides[0].planLevel, "SPEAKER_PRO");
  assert.equal(manifest.slides[1].planLevel, "SPEAKER");
});

test("publishing makes an immutable system copy and preserves Master configuration", async (t) => {
  const { decksDir, masterDir } = await makeMaster(t);
  const published = await publishMasterDeck(decksDir);
  assert.equal(published.deckId, DEMO_PUBLISHED_DECK_ID);
  assert.equal(published.systemDemo.role, "published");
  assert.equal(published.slides[2].planLevel, "SPEAKER_PRO");
  assert.notEqual(published.session_id, "s_masterdemo1");
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(path.join(decksDir, DEMO_PUBLISHED_DECK_ID, "interactions.json"), "utf8")),
    { interactions: [{ id: "poll-a" }] }
  );
  assert.equal((await readSystemDemoManifest(decksDir, DEMO_MASTER_DECK_ID)).systemDemo.role, "master");
  assert.equal(await fs.promises.readFile(path.join(masterDir, "slides", "slide-001.jpg"), "utf8"), "slide-0");
});

test("publishing is blocked until every slide has a commercial level", async (t) => {
  const { decksDir } = await makeMaster(t, ["FREE", null]);
  await assert.rejects(
    publishMasterDeck(decksDir),
    (error) => error.statusCode === 409 && error.code === "DEMO_SLIDE_LEVELS_REQUIRED" && error.unassignedSlides.includes("slide-002")
  );
  assert.equal(await readSystemDemoManifest(decksDir, DEMO_PUBLISHED_DECK_ID), null);
});

test("the official Demo seed bootstraps Master and published decks when storage is empty", async (t) => {
  const seedRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-demo-seed-source-"));
  const dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-demo-seed-data-"));
  t.after(() => fs.promises.rm(seedRoot, { recursive: true, force: true }));
  t.after(() => fs.promises.rm(dataRoot, { recursive: true, force: true }));
  const { masterDir } = await makeMaster(t);
  await fs.promises.cp(masterDir, seedRoot, { recursive: true });

  const result = await seedSystemDemoDeck(dataRoot, seedRoot);
  const master = await readSystemDemoManifest(dataRoot, DEMO_MASTER_DECK_ID);
  const published = await readSystemDemoManifest(dataRoot, DEMO_PUBLISHED_DECK_ID);

  assert.equal(result.seededMaster, true);
  assert.equal(result.published, true);
  assert.equal(master.systemDemo.role, "master");
  assert.equal(published.systemDemo.role, "published");
  assert.equal(await fs.promises.readFile(path.join(dataRoot, DEMO_PUBLISHED_DECK_ID, "slides", "slide-001.jpg"), "utf8"), "slide-0");
});

test("the official Demo seed never overwrites existing Master or published data", async (t) => {
  const seedRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-demo-seed-source-"));
  t.after(() => fs.promises.rm(seedRoot, { recursive: true, force: true }));
  const { decksDir, masterDir } = await makeMaster(t);
  await fs.promises.cp(masterDir, seedRoot, { recursive: true });
  await publishMasterDeck(decksDir);
  await fs.promises.writeFile(path.join(masterDir, "marker.txt"), "admin-edit");
  const publishedDir = path.join(decksDir, DEMO_PUBLISHED_DECK_ID);
  await fs.promises.writeFile(path.join(publishedDir, "marker.txt"), "published-edit");

  const result = await seedSystemDemoDeck(decksDir, seedRoot);

  assert.equal(result.seededMaster, false);
  assert.equal(result.published, false);
  assert.equal(await fs.promises.readFile(path.join(masterDir, "marker.txt"), "utf8"), "admin-edit");
  assert.equal(await fs.promises.readFile(path.join(publishedDir, "marker.txt"), "utf8"), "published-edit");
});

test("an existing unpublished Master is left for the administrator to finish", async (t) => {
  const seedRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-demo-seed-source-"));
  t.after(() => fs.promises.rm(seedRoot, { recursive: true, force: true }));
  const { decksDir, masterDir } = await makeMaster(t, ["FREE", null]);
  await fs.promises.cp(masterDir, seedRoot, { recursive: true });

  const result = await seedSystemDemoDeck(decksDir, seedRoot);

  assert.equal(result.seededMaster, false);
  assert.equal(result.published, false);
  assert.equal(await readSystemDemoManifest(decksDir, DEMO_PUBLISHED_DECK_ID), null);
  assert.equal((await readSystemDemoManifest(decksDir, DEMO_MASTER_DECK_ID)).slides[1].planLevel, null);
});

test("the packaged Demo seed contains every referenced asset", async () => {
  const seedDir = path.join(appDir, "bootstrap", DEMO_MASTER_DECK_ID);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(seedDir, "manifest.json"), "utf8"));
  const interactions = JSON.parse(await fs.promises.readFile(path.join(seedDir, "interactions.json"), "utf8"));
  assert.equal(manifest.slides.length, 15);
  for (const slide of manifest.slides) {
    for (const asset of [slide.src, slide.thumb]) {
      await fs.promises.access(path.join(seedDir, String(asset).split("?")[0]), fs.constants.R_OK);
    }
  }
  for (const contest of interactions.contests || []) {
    for (const question of contest.questions || []) {
      if (!question.image?.url) continue;
      const relative = question.image.url.replace(/^\/decks\/immersa-demo-master\//, "");
      await fs.promises.access(path.join(seedDir, relative), fs.constants.R_OK);
    }
  }
});

test("Home and every live surface render Demo plan metadata outside slide artwork", () => {
  const home = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  const homeShell = fs.readFileSync(path.join(appDir, "public", "home", "deck-management-shell.js"), "utf8");
  const html = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const badge = fs.readFileSync(path.join(appDir, "public", "shared", "demo-plan-badge.js"), "utf8");
  const badgeCss = fs.readFileSync(path.join(appDir, "public", "shared", "demo-plan-badge.css"), "utf8");
  const server = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
  const presenter = fs.readFileSync(path.join(appDir, "public", "presenter", "presenter.js"), "utf8");
  assert.match(html, /id="detailDemoPlan"[\s\S]*FREE[\s\S]*SPEAKER PRO/);
  assert.match(home, /\/api\/admin\/demo\/slides\//);
  assert.match(home, /\/api\/admin\/demo\/publish/);
  assert.match(badge, /manifest\?\.systemDemo\?\.role === "published"/);
  assert.match(badgeCss, /\.stream-area > \.immersa-demo-plan-badge \{ top: 56px; \}/);
  assert.match(badgeCss, /\.slide-viewport > \.immersa-demo-plan-badge/);
  assert.match(badgeCss, /safe-area-inset-top/);
  for (const target of ["presenter/index.html", "stage/index.html", "screen/index.html", "audience/index.html"]) {
    assert.match(fs.readFileSync(path.join(appDir, "public", target), "utf8"), /demo-plan-badge\.css\?v=2/);
  }
  assert.match(homeShell, /deck\?\.demoRole === "master" && !deck\?\.missing/);
  assert.match(homeShell, /participationTab\.disabled = !enabled/);
  assert.match(server, /featureAccessForPlan\("SPEAKER_PRO"\)/);
  assert.match(server, /\/api\/demo-session\/decks\/:deckId\/slide-visibility/);
  assert.match(server, /demoSessionVisibilityStore\.set/);
  const publishRoute = server.slice(server.indexOf('app.post("\/api\/admin\/demo\/publish"'), server.indexOf('app.post("\/api\/access-links"'));
  assert.doesNotMatch(publishRoute, /assertDeckCanBeReplaced/);
  assert.match(presenter, /isPublishedDemo = roleOpenContext\.demo_role === "published" \|\| deckId === "immersa-demo"/);
  assert.match(presenter, /categoryEnabled: \{ games: !isPublishedDemo \}/);
  for (const target of ["presenter/presenter.js", "stage/stage.js", "screen/screen.js", "audience/audience.js"]) {
    assert.match(fs.readFileSync(path.join(appDir, "public", target), "utf8"), /ImmersaDemoPlanBadge\?\.update/);
  }
  assert.match(fs.readFileSync(path.join(appDir, "public", "presenter", "index.html"), "utf8"), /interactions-shell\.js\?v=2/);
});
