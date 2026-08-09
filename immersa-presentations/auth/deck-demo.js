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
    demoEditable: true,
    plan: DEMO_CAPABILITY_PLAN,
    sourceSizeBytes: 0
  };
}

function shapeIds(values) {
  return (Array.isArray(values) ? values : []).map((item) => String(item?.id || ""));
}

function sameIds(candidate, master) {
  const left = shapeIds(candidate);
  const right = shapeIds(master);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function preservesKnowledgeStructure(candidate, master) {
  if (!sameIds(candidate, master)) return false;
  return candidate.every((activity, activityIndex) => {
    const masterActivity = master[activityIndex];
    if (!sameIds(activity?.questions, masterActivity?.questions)) return false;
    return activity.questions.every((question, questionIndex) =>
      sameIds(question?.options, masterActivity.questions[questionIndex]?.options)
    );
  });
}

function assertDemoConfigurationStructure(candidate, master) {
  const candidatePolls = Array.isArray(candidate?.interactions) ? candidate.interactions : [];
  const masterPolls = Array.isArray(master?.interactions) ? master.interactions : [];
  const pollsMatch = sameIds(candidatePolls, masterPolls)
    && candidatePolls.every((poll, index) => sameIds(poll?.options, masterPolls[index]?.options));
  const contestsMatch = preservesKnowledgeStructure(candidate?.contests || [], master?.contests || []);
  const assessmentsMatch = preservesKnowledgeStructure(candidate?.assessments || [], master?.assessments || []);
  if (pollsMatch && contestsMatch && assessmentsMatch) return;
  const error = new Error("En el Demo puedes editar el contenido, pero no agregar ni eliminar preguntas u opciones.");
  error.statusCode = 400;
  error.code = "DEMO_STRUCTURE_LOCKED";
  throw error;
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
  demoManifest,
  assertDemoConfigurationStructure
};
