const crypto = require("node:crypto");

const DEMO_MASTER_DECK_ID = "immersa-demo";
const DEMO_DECK_PREFIX = DEMO_MASTER_DECK_ID + "-";
const DEMO_PLAN = "DEMO";
const DEMO_CAPABILITY_PLAN = "SPEAKER_PRO";

function randomDemoId(prefix) {
  return prefix + crypto.randomBytes(12).toString("hex");
}

function createDemoBinding(workspaceId) {
  return {
    workspaceId: String(workspaceId),
    deckId: randomDemoId(DEMO_DECK_PREFIX),
    sessionId: randomDemoId("demo-session-")
  };
}

function isDemoDeckId(value) {
  return new RegExp("^" + DEMO_DECK_PREFIX + "[a-f0-9]{24}$", "i").test(String(value || ""));
}

function demoDeckSummary(master, binding) {
  return {
    ...master,
    deckId: binding.deckId,
    session_id: binding.sessionId,
    title: master.title || "Conoce IMMERSA",
    isDemo: true,
    demoMode: true,
    systemResource: true,
    readOnly: true,
    plan: DEMO_CAPABILITY_PLAN,
    sourceSizeBytes: 0
  };
}

function demoManifest(master, binding) {
  return {
    ...master,
    deckId: binding.deckId,
    session_id: binding.sessionId,
    demo_mode: true,
    system_resource: true,
    read_only: true
  };
}

module.exports = {
  DEMO_MASTER_DECK_ID,
  DEMO_DECK_PREFIX,
  DEMO_PLAN,
  DEMO_CAPABILITY_PLAN,
  createDemoBinding,
  isDemoDeckId,
  demoDeckSummary,
  demoManifest
};
