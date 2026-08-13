const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SESSION_INACTIVITY_MINUTES,
  resolveSessionInactivityMs,
  isMeaningfulSessionEvent,
  isSessionInactive
} = require("../session-inactivity");

test("session inactivity defaults to 60 minutes and remains configurable", () => {
  assert.equal(DEFAULT_SESSION_INACTIVITY_MINUTES, 60);
  assert.equal(resolveSessionInactivityMs({}), 60 * 60 * 1000);
  assert.equal(resolveSessionInactivityMs({ IMMERSA_SESSION_INACTIVITY_MINUTES: "15" }), 15 * 60 * 1000);
  assert.equal(resolveSessionInactivityMs({ IMMERSA_SESSION_INACTIVITY_MINUTES: "invalid" }), 60 * 60 * 1000);
});

test("passive synchronization does not keep a session alive", () => {
  assert.equal(isMeaningfulSessionEvent("pong:request_state"), false);
  assert.equal(isMeaningfulSessionEvent("time:sync:request"), false);
  assert.equal(isMeaningfulSessionEvent("presentation:lifecycle:request"), false);
  assert.equal(isMeaningfulSessionEvent("qna:submit"), true);
  assert.equal(isMeaningfulSessionEvent("slide_next"), true);
});

test("session expires once the inactivity limit is reached", () => {
  const session = { lastActivityAt: 1_000 };
  assert.equal(isSessionInactive(session, 60_999, 60_000), false);
  assert.equal(isSessionInactive(session, 61_000, 60_000), true);
});
