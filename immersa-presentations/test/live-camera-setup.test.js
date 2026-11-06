const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLiveCameraSetup, pilotRoleUrls } = require("../event-hub/live-camera-setup");

test("Event Hub enrollment restricts LIVE to one activity and reloads its dedicated links", async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "immersa-live-pilot-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const env = {
    IMMERSA_LIVE_CAMERA_SETUP_EVENT_SLUG: "pilot-event",
    IMMERSA_LIVE_CAMERA_SETUP_ORIGIN: "https://beta.example.test"
  };
  const links = { speaker: "a_speaker001", stage: "a_stage00001", screen: "a_screen0001" };
  const created = [];
  const grants = [];
  const eventHub = {
    async getHub(workspaceId) {
      return { workspace_id: workspaceId, slug: workspaceId === "event-a" ? "pilot-event" : "other-event" };
    },
    async getActivity(activityId) {
      return {
        id: activityId, event_workspace_id: activityId === "wrong-event" ? "event-b" : "event-a",
        event_stage_id: "stage-a", deck_id: "deck-a", status: "LIVE"
      };
    },
    async grantStageOperatorAccess(grant) { grants.push(grant); }
  };
  const accessLinks = {
    async createAccessLinkForDeck({ deckId, role }) {
      assert.equal(deckId, "deck-a");
      created.push(role);
      return { access_token: links[role], session_id: "session-a" };
    }
  };
  const setup = createLiveCameraSetup({ env, dataDir, eventHub });
  const input = { workspaceId: "event-a", activityId: "activity-a", accessLinks };
  assert.equal(createLiveCameraSetup({ env: {}, dataDir, eventHub }), null);
  assert.equal(setup.getPilot(), null);
  assert.equal(setup.available({ slug: "other-event" }), false);
  await assert.rejects(setup.enroll({ ...input, workspaceId: "event-b" }), { code: "LIVE_EVENT_NOT_ALLOWED" });
  await assert.rejects(setup.enroll({ ...input, activityId: "wrong-event" }), { code: "ACTIVITY_WORKSPACE_MISMATCH" });
  assert.equal(created.length, 0);

  const [pilot, retry] = await Promise.all([setup.enroll(input), setup.enroll(input)]);
  assert.equal(retry, pilot);
  assert.deepEqual(created, ["speaker", "stage", "screen"]);
  assert.deepEqual(grants, [{ eventStageId: "stage-a", accessSecret: links.stage }]);
  assert.deepEqual(pilotRoleUrls(pilot), {
    speaker: "https://beta.example.test/speaker/a_speaker001?eventActivityId=activity-a",
    stage: "https://beta.example.test/stage/a_stage00001?eventActivityId=activity-a",
    screen: "https://beta.example.test/screen/a_screen0001?eventActivityId=activity-a"
  });
  await assert.rejects(setup.enroll({ ...input, activityId: "another-activity" }), { code: "LIVE_ALREADY_CONFIGURED" });

  const restarted = createLiveCameraSetup({ env, dataDir, eventHub });
  assert.deepEqual(restarted.getPilot(), pilot);
  assert.equal(await restarted.enroll(input), restarted.getPilot());
  assert.equal(created.length, 3);
  const relayEnv = {
    ...env,
    IMMERSA_LIVE_CAMERA_SETUP_TURN_URLS: "turn:turn.example.test:3478?transport=udp, turns:turn.example.test:443?transport=tcp",
    IMMERSA_LIVE_CAMERA_TURN_SECRET: "relay-test-secret"
  };
  const relay = createLiveCameraSetup({ env: relayEnv, dataDir, eventHub });
  assert.deepEqual(relay.getPilot().turnUrls, ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:443?transport=tcp"]);
  assert.deepEqual(pilotRoleUrls(relay.getPilot()), pilotRoleUrls(pilot));
  assert.equal(await relay.enroll(input), relay.getPilot());
  assert.equal(created.length, 3);
  const afterRollback = createLiveCameraSetup({ env, dataDir, eventHub });
  assert.deepEqual(afterRollback.getPilot(), pilot);
  const differentScope = createLiveCameraSetup({ env: { ...env, IMMERSA_LIVE_CAMERA_SETUP_EVENT_SLUG: "other-event" }, dataDir, eventHub });
  assert.equal(differentScope.getPilot(), null);

  const betaEnv = {
    RAILWAY_ENVIRONMENT_NAME: "beta",
    RAILWAY_SERVICE_NAME: "immersa-presentations",
    RAILWAY_GIT_BRANCH: "agent/immersa-live-v1-prototype"
  };
  const betaData = path.join(dataDir, "beta");
  assert.equal(createLiveCameraSetup({ env: { ...betaEnv, RAILWAY_GIT_BRANCH: "beta" }, dataDir: betaData, eventHub }), null);
  assert.equal(createLiveCameraSetup({ env: { ...betaEnv, RAILWAY_ENVIRONMENT_NAME: "production" }, dataDir: betaData, eventHub }), null);
  const beta = createLiveCameraSetup({ env: betaEnv, dataDir: betaData, eventHub });
  assert.equal(beta.origin, "https://beta.immersalive.com");
  assert.equal(beta.available({ workspace_id: "event-a", slug: "pilot-event" }), true);
  await beta.enroll(input);
  assert.equal(beta.available({ workspace_id: "event-b", slug: "other-event" }), false);
  await assert.rejects(beta.enroll({ ...input, workspaceId: "event-b" }), { code: "LIVE_EVENT_NOT_ALLOWED" });
});
