const test = require("node:test");
const assert = require("node:assert/strict");
const { canRegisterAudience, registerAudience, unregisterAudience } = require("../audience-registry");

function createSession() {
  return { audience: new Map() };
}

test("old socket disconnect does not remove replacement socket for same audienceId", () => {
  const session = createSession();

  registerAudience(session, { audienceId: "X", socketId: "socket-A", joinedAt: 1 });
  registerAudience(session, { audienceId: "X", socketId: "socket-B", joinedAt: 2 });

  assert.equal(session.audience.size, 1);
  assert.equal(session.audience.get("X").socketId, "socket-B");

  assert.equal(unregisterAudience(session, "X", "socket-A"), false);
  assert.equal(session.audience.has("X"), true);
  assert.equal(session.audience.get("X").socketId, "socket-B");

  assert.equal(unregisterAudience(session, "X", "socket-B"), true);
  assert.equal(session.audience.has("X"), false);
});

test("two distinct audienceIds are counted as two connected audience", () => {
  const session = createSession();

  registerAudience(session, { audienceId: "A", socketId: "socket-A" });
  registerAudience(session, { audienceId: "B", socketId: "socket-B" });

  assert.equal(session.audience.size, 2);
  assert.deepEqual(Array.from(session.audience.keys()).sort(), ["A", "B"]);
});

test("audience capacity blocks only new people and preserves reconnections", () => {
  const session = createSession();
  registerAudience(session, { audienceId: "A", socketId: "socket-A" });
  registerAudience(session, { audienceId: "B", socketId: "socket-B" });

  assert.equal(canRegisterAudience(session, "C", 2), false);
  assert.equal(canRegisterAudience(session, "A", 2), true);
});
