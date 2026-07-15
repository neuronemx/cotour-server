const test = require("node:test");
const assert = require("node:assert/strict");
const { BreakoutStore } = require("../breakout-store");
const { createBreakoutSocketHandlers } = require("../breakout-sockets");

test("client can request the current authoritative Breakout state", () => {
  const registered = new Map();
  const emitted = [];
  const socket = {
    on(event, handler) { registered.set(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); }
  };
  const io = { to() { return { emit() {} }; } };
  const store = new BreakoutStore();
  store.start("s1", "presenter");
  const handlers = createBreakoutSocketHandlers({
    io,
    store,
    setIntervalFn() { return { unref() {} }; },
    clearIntervalFn() {}
  });
  handlers.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "screen" }));
  registered.get("breakout:request_state")();
  assert.equal(emitted.at(-1).event, "breakout:state");
  assert.equal(emitted.at(-1).payload.status, "running");
});