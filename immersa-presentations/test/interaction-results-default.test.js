const assert = require("node:assert/strict");
const test = require("node:test");
const { InteractionStore } = require("../interaction-store");

test("poll results are visible on Screen by default and can be hidden", () => {
  const store = new InteractionStore();
  store.launch({
    sessionId: "session-1",
    interaction: {
      id: "poll-1",
      type: "poll",
      title: "Encuesta",
      prompt: "¿Qué opinas?",
      options: [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }]
    }
  });
  assert.equal(store.getState("session-1").resultsVisible, true);
  store.hideResults("session-1");
  assert.equal(store.getState("session-1").resultsVisible, false);
  store.revealResults("session-1");
  assert.equal(store.getState("session-1").resultsVisible, true);
});

test("poll metrics snapshot keeps option definitions and unique responses before close", () => {
  const store = new InteractionStore();
  store.launch({
    sessionId: "session-1",
    interaction: {
      id: "poll-1", type: "poll", title: "Encuesta", prompt: "¿Qué opinas?",
      options: [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }]
    }
  });
  store.submitResponse({ sessionId: "session-1", interactionId: "poll-1", audienceId: "aud-1", optionId: "yes" });
  const snapshot = store.getMetricsSnapshot("session-1");
  assert.equal(snapshot.active.id, "poll-1");
  assert.deepEqual(snapshot.active.options.map((option) => option.id), ["yes", "no"]);
  assert.deepEqual(snapshot.responses.map((response) => [response.audienceId, response.optionId]), [["aud-1", "yes"]]);
});
