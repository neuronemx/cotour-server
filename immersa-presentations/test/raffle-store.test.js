const test = require("node:test");
const assert = require("node:assert/strict");
const { RaffleStore, RAFFLE_REVEAL_DELAY_MS, AUTO_REVEAL_DELAY_MS, countdownRemainingMs } = require("../raffle-store");
const { InteractionStore } = require("../interaction-store");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");

const pollInteraction = {
  id: "poll-1",
  type: "poll",
  title: "Poll",
  prompt: "Pick one",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" }
  ]
};

const visualKeyConfig = {
  mode: "visual_key",
  title: "Visual key",
  prompt: "Pick the marked option",
  entryKey: "b",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" }
  ]
};

function freeConfig() {
  return { mode: "free", title: "Free raffle" };
}

function pollRaffleConfig() {
  return {
    mode: "poll",
    title: "Poll raffle",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" }
    ]
  };
}

function connected(...ids) {
  return ids.map((audienceId) => ({ audienceId }));
}

function createCoordinator(random = () => 0) {
  const interactionStore = new InteractionStore();
  const raffleStore = new RaffleStore(random);
  const coordinator = new ActiveInteractionCoordinator({ interactionStore, raffleStore });
  return { interactionStore, raffleStore, coordinator };
}

test("one active interaction per session blocks raffle when poll is active", async () => {
  const { interactionStore, raffleStore, coordinator } = createCoordinator();
  interactionStore.launch({ sessionId: "s1", interaction: pollInteraction });

  const result = await coordinator.withSessionLock("s1", () => {
    if (coordinator.hasActiveInteraction("s1")) return { ok: false, reason: "active_interaction_exists" };
    return raffleStore.create({ sessionId: "s1", config: freeConfig() });
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "active_interaction_exists");
  assert.equal(raffleStore.getActive("s1"), null);
});

test("one active interaction per session blocks poll launch when raffle is active", async () => {
  const { interactionStore, raffleStore, coordinator } = createCoordinator();
  raffleStore.create({ sessionId: "s1", config: freeConfig() });

  const result = await coordinator.withSessionLock("s1", () => {
    if (coordinator.hasActiveRaffle("s1")) return { ok: false, reason: "active_raffle_exists" };
    return { ok: true, active: interactionStore.launch({ sessionId: "s1", interaction: pollInteraction }) };
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "active_raffle_exists");
  assert.equal(interactionStore.hasActive("s1"), false);
});

test("double simultaneous Speaker and Stage action leaves only one active item", async () => {
  const { interactionStore, raffleStore, coordinator } = createCoordinator();
  const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

  const raffleAction = coordinator.withSessionLock("s1", async () => {
    await delay();
    if (coordinator.hasActiveInteraction("s1")) return { ok: false, reason: "active_interaction_exists" };
    return raffleStore.create({ sessionId: "s1", config: freeConfig() });
  });
  const interactionAction = coordinator.withSessionLock("s1", () => {
    if (coordinator.hasActiveRaffle("s1")) return { ok: false, reason: "active_raffle_exists" };
    return { ok: true, active: interactionStore.launch({ sessionId: "s1", interaction: pollInteraction }) };
  });

  const results = await Promise.all([raffleAction, interactionAction]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(Boolean(raffleStore.getActive("s1")) !== interactionStore.hasActive("s1"), true);
});

test("visual_key requires valid config and no default correct option", () => {
  const store = new RaffleStore();
  assert.equal(store.create({ sessionId: "s1", config: { mode: "unknown" } }).reason, "invalid_raffle_mode");
  assert.equal(store.create({ sessionId: "s1", config: { ...visualKeyConfig, options: visualKeyConfig.options.slice(0, 3) } }).reason, "visual_key_requires_four_options");
  assert.equal(store.create({ sessionId: "s1", config: { ...visualKeyConfig, entryKey: "" } }).reason, "entry_key_required");
  assert.equal(store.create({ sessionId: "s1", config: { ...visualKeyConfig, entryKey: "x" } }).reason, "entry_key_must_match_option");
});

test("visual_key stores one editable selection and evaluates only on close", () => {
  const store = new RaffleStore();
  assert.equal(store.create({ sessionId: "s1", config: visualKeyConfig }).ok, true);

  const wrong = store.enter({ sessionId: "s1", audienceId: "a1", optionId: "a" });
  assert.equal(wrong.ok, true);
  assert.equal(store.getAudienceState("s1", "a1").active.ownSelection.selectedOptionId, "a");
  assert.equal(store.getAudienceState("s1", "a1").active.ownEntry, null);
  assert.equal(store.getControllerState("s1").active.entryCount, 0);

  const changed = store.enter({ sessionId: "s1", audienceId: "a1", optionId: "b" });
  assert.equal(changed.ok, true);
  const collecting = store.getAudienceState("s1", "a1").active;
  assert.equal(collecting.ownSelection.selectedOptionId, "b");
  assert.equal(collecting.ownEntry, null);

  store.enter({ sessionId: "s1", audienceId: "a2", optionId: "a" });
  assert.equal(store.closeEntries("s1", connected("a1", "a2")).ok, true);
  const state = store.getControllerState("s1").active;
  assert.equal(state.entryCount, 1);
  assert.equal(state.eligibleCount, 1);
  assert.equal(store.getAudienceState("s1", "a1").active.ownEntry.selectedOptionId, "b");
  assert.equal(store.getAudienceState("s1", "a2").active.ownEntry, null);
  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1", optionId: "a" }).reason, "entries_not_collecting");
});

test("visual_key refresh preserves the latest audience selection", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  store.enter({ sessionId: "s1", audienceId: "a1", optionId: "a" });
  store.enter({ sessionId: "s1", audienceId: "a1", optionId: "c" });

  const refreshed = store.getAudienceState("s1", "a1");
  assert.equal(refreshed.active.ownSelection.raffleId, refreshed.active.id);
  assert.equal(refreshed.active.ownSelection.selectedOptionId, "c");
  assert.equal(refreshed.active.ownEntry, null);
});

test("poll raffle accepts one response per audience", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: pollRaffleConfig() });
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "yes" }).ok, true);
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "no" }).reason, "duplicate_entry");
});

test("free mode snapshots connected audience on close", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: freeConfig() });
  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1" }).reason, "free_mode_does_not_use_entries");
  assert.equal(store.closeEntries("s1", connected("a1", "a2")).ok, true);
  const state = store.getControllerState("s1");
  assert.equal(state.active.entryCount, 2);
  assert.equal(state.active.eligibleCount, 2);
});

test("previous winners are excluded from eligibility in the same session", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"]);
  store.revealWinner("s1");
  store.close("s1");

  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  const state = store.getControllerState("s1");
  assert.equal(state.active.entryCount, 2);
  assert.equal(state.active.eligibleCount, 1);
  assert.equal(state.active.entries.some((entry) => entry.audienceId === "a1"), true);
});

test("reset_winners in entries_closed preserves entries and recalculates eligibility", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"]);
  store.revealWinner("s1");
  store.close("s1");

  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  const before = store.getControllerState("s1").active;
  assert.equal(before.state, "entries_closed");
  assert.equal(before.entryCount, 2);
  assert.equal(before.eligibleCount, 1);

  const result = store.resetWinners("s1");
  const after = store.getControllerState("s1");
  assert.equal(result.ok, true);
  assert.equal(after.active.state, "entries_closed");
  assert.equal(after.active.entryCount, 2);
  assert.equal(after.active.eligibleCount, 2);
  assert.equal(after.previousWinnerCount, 0);
});

test("reset_winners is rejected during drawing and winner", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"]);
  assert.equal(store.resetWinners("s1").reason, "invalid_state");
  store.revealWinner("s1");
  assert.equal(store.resetWinners("s1").reason, "invalid_state");
});

test("disconnected snapshot entries are filtered before draw", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  assert.equal(store.drawWinner("s1", []).reason, "no_connected_eligible_entries");
  const result = store.drawWinner("s1", ["a2"]);
  assert.equal(result.ok, true);
  store.revealWinner("s1");
  assert.equal(store.getControllerState("s1").active.winner.audienceId, "a2");
});

test("role payloads keep audience and screen private", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: pollRaffleConfig() });
  store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "yes" });

  const controller = store.getControllerState("s1");
  const screen = store.getScreenState("s1");
  const audience = store.getAudienceState("s1", "a1");

  assert.ok(controller.active.pollResults);
  assert.ok(Array.isArray(controller.active.entries));
  assert.equal("pollResults" in screen.active, false);
  assert.equal("entries" in screen.active, false);
  assert.equal("winner" in screen.active, false);
  assert.equal("entryKey" in screen.active, false);
  assert.equal("entryKey" in audience.active, false);
  assert.equal("pollResults" in audience.active, false);
  assert.equal("entryCount" in audience.active, false);
  assert.equal("winners" in audience, false);
  assert.equal("previousWinnerCount" in audience, false);
});

test("draw enters drawing and defines revealAt five seconds ahead", () => {
  const store = new RaffleStore(() => 0);
  const nowMs = 1_000_000;
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));

  const result = store.drawWinner("s1", ["a1", "a2"], { nowMs });
  const originalNow = Date.now;
  Date.now = () => nowMs;
  let state;
  try { state = store.getControllerState("s1").active; } finally { Date.now = originalNow; }
  assert.equal(result.ok, true);
  assert.equal(state.state, "drawing");
  assert.equal(RAFFLE_REVEAL_DELAY_MS, 5000);
  assert.equal(Date.parse(state.revealAt) - nowMs, RAFFLE_REVEAL_DELAY_MS);
  assert.equal(state.countdownRemainingMs, RAFFLE_REVEAL_DELAY_MS);
  assert.equal(AUTO_REVEAL_DELAY_MS, RAFFLE_REVEAL_DELAY_MS);
  assert.equal(state.drawingEndsAt, state.revealAt);
});


test("server countdownRemainingMs is relative to the server clock and reaches zero at deadline", () => {
  const store = new RaffleStore(() => 0);
  const originalNow = Date.now;
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"], { nowMs: 10_000 });
  const raffle = store.getActive("s1");

  Date.now = () => 10_000;
  try { assert.equal(countdownRemainingMs(raffle), RAFFLE_REVEAL_DELAY_MS); } finally { Date.now = originalNow; }
  Date.now = () => 13_200;
  try { assert.equal(store.getControllerState("s1").active.countdownRemainingMs, 1_800); } finally { Date.now = originalNow; }
  Date.now = () => 15_000;
  try { assert.equal(countdownRemainingMs(raffle), 0); } finally { Date.now = originalNow; }
});

test("winner is hidden before reveal and appears automatically after deadline", () => {
  const store = new RaffleStore(() => 0);
  const nowMs = 2_000_000;
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"], { nowMs });

  assert.equal(store.getControllerState("s1").active.winner, null);
  assert.equal(store.getScreenState("s1").active.hasWinner, false);
  assert.equal(store.revealDueWinners(nowMs + RAFFLE_REVEAL_DELAY_MS - 1).length, 0);
  assert.equal(store.getControllerState("s1").active.state, "drawing");

  const revealed = store.revealDueWinners(nowMs + RAFFLE_REVEAL_DELAY_MS);
  assert.equal(revealed.length, 1);
  assert.equal(store.getControllerState("s1").active.state, "winner");
  assert.equal(store.getScreenState("s1").active.hasWinner, true);
});

test("refresh during drawing preserves revealAt", () => {
  const store = new RaffleStore(() => 0);
  const nowMs = 3_000_000;
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"], { nowMs });

  const first = store.getControllerState("s1").active.revealAt;
  const afterRefresh = store.getControllerState("s1").active.revealAt;
  assert.equal(afterRefresh, first);
});

test("close before reveal deadline cancels automatic reveal", () => {
  const store = new RaffleStore(() => 0);
  const nowMs = 4_000_000;
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"], { nowMs });

  assert.equal(store.close("s1").ok, true);
  assert.equal(store.revealDueWinners(nowMs + RAFFLE_REVEAL_DELAY_MS).length, 0);
  assert.equal(store.getControllerState("s1").active, null);
});

test("manual reveal handler remains compatible while drawing", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", connected("a1", "a2"));
  store.drawWinner("s1", ["a1", "a2"]);

  assert.equal(store.getControllerState("s1").active.state, "drawing");
  assert.equal(store.getScreenState("s1").active.hasWinner, false);
  assert.equal(store.getAudienceState("s1", "a1").active.isWinner, false);

  store.revealWinner("s1");
  assert.equal(store.getControllerState("s1").active.state, "winner");
  assert.equal(store.getScreenState("s1").active.hasWinner, true);
  assert.equal(store.getAudienceState("s1", "a1").active.isWinner, true);
  assert.equal(store.getAudienceState("s1", "a2").active.isWinner, false);
});

test("close permits a new convocatoria", () => {
  const store = new RaffleStore();
  assert.equal(store.create({ sessionId: "s1", config: freeConfig() }).ok, true);
  assert.equal(store.create({ sessionId: "s1", config: freeConfig() }).reason, "active_raffle_exists");
  assert.equal(store.close("s1").ok, true);
  assert.equal(store.create({ sessionId: "s1", config: freeConfig() }).ok, true);
});
