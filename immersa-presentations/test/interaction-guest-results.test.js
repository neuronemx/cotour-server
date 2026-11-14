const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionStore, createInteractionSocketHandlers } = require("../interaction-store");

test("guest public-result notifications track launch, votes, hide, reveal, close and reset", async () => {
  const store = new InteractionStore();
  const snapshots = [];
  const runtime = createInteractionSocketHandlers({
    io: { to() { return { emit() {} }; } }, store,
    getRoleRoomKey: (room, role) => room + role,
    loadInteractionsForDeck: async () => [{ id: "poll", type: "poll", prompt: "Choose", options: [{ id: "a", label: "A" }] }],
    onPublicResultsChanged: (room, session) => snapshots.push({ room, results: store.getSession(session).resultsVisible ? store.getResults(session) : null })
  });
  function socket(role) {
    const events = new Map();
    const value = { on: (name, fn) => events.set(name, fn), emit() {}, receive: (name, payload) => events.get(name)(payload) };
    runtime.attach(value, () => ({ roomKey: "room", deckId: "deck", sessionId: "session", role, audienceId: "audience" }));
    return value;
  }
  const stage = socket("stage"), audience = socket("audience");
  await stage.receive("interaction:launch", { interactionId: "poll" });
  assert.equal(snapshots.at(-1).results.totalResponses, 0);
  await audience.receive("interaction:submit_response", { interactionId: "poll", optionId: "a", audienceId: "audience" });
  assert.equal(snapshots.at(-1).results.totalResponses, 1);
  stage.receive("interaction:hide_results");
  assert.equal(snapshots.at(-1).results, null);
  stage.receive("interaction:reveal_results");
  assert.equal(snapshots.at(-1).results.totalResponses, 1);
  await stage.receive("interaction:close");
  assert.equal(snapshots.at(-1).results, null);
  await stage.receive("interaction:launch", { interactionId: "poll" });
  runtime.resetSession({ roomKey: "room", sessionId: "session" });
  assert.equal(snapshots.at(-1).results, null);
  assert.equal(snapshots.every(value => value.room === "room"), true);
});
