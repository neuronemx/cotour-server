const test = require("node:test");
const assert = require("node:assert/strict");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");

function createRuntime(activeSessions = []) {
  const active = new Set(activeSessions);
  const closed = [];
  return {
    active,
    closed,
    hasActive(sessionId) {
      return active.has(String(sessionId));
    },
    close(context) {
      const sessionId = String(context?.sessionId || "");
      closed.push({ sessionId, role: context?.role || "", roomKey: context?.roomKey || "" });
      active.delete(sessionId);
      return { ok: true };
    }
  };
}

test("coordinator registers multiple game runtimes and reports the active game", () => {
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakout = createRuntime(["session-breakout"]);
  const pong = createRuntime(["session-pong"]);

  coordinator.registerGame("breakout", breakout);
  coordinator.registerGame("pong", pong);

  assert.equal(coordinator.getActiveGameType("session-breakout"), "breakout");
  assert.equal(coordinator.getActiveGameType("session-pong"), "pong");
  assert.equal(coordinator.hasActiveBreakout("session-breakout"), true);
  assert.equal(coordinator.hasActiveGame("session-pong"), true);
  assert.equal(coordinator.hasAnyActive("session-pong", "pong"), false);
});

test("coordinator closes only competing games and preserves the requested game", () => {
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakout = createRuntime(["session-1"]);
  const pong = createRuntime(["session-1"]);
  coordinator.registerGame("breakout", breakout);
  coordinator.registerGame("pong", pong);

  const result = coordinator.closeActiveGames({
    sessionId: "session-1",
    roomKey: "room-1",
    role: "stage"
  }, "pong");

  assert.equal(result.ok, true);
  assert.equal(breakout.hasActive("session-1"), false);
  assert.equal(pong.hasActive("session-1"), true);
  assert.deepEqual(breakout.closed, [{ sessionId: "session-1", roomKey: "room-1", role: "stage" }]);
  assert.deepEqual(pong.closed, []);
});

test("coordinator rejects duplicate game registrations and runtimes without hasActive", () => {
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakout = createRuntime();
  coordinator.registerGame("breakout", breakout);

  assert.equal(coordinator.registerGame("breakout", breakout), breakout);
  assert.throws(() => coordinator.registerGame("breakout", createRuntime()), /already registered/);
  assert.throws(() => coordinator.registerGame("pong", {}), /must expose hasActive/);
});

test("legacy breakoutStore constructor option remains supported", () => {
  const breakoutStore = createRuntime(["session-1"]);
  const coordinator = new ActiveInteractionCoordinator({
    interactionStore: null,
    raffleStore: null,
    breakoutStore
  });

  assert.equal(coordinator.getGameRuntime("breakout"), breakoutStore);
  assert.equal(coordinator.hasActiveBreakout("session-1"), true);
  assert.equal(coordinator.hasActiveInteraction("session-1"), true);
});
