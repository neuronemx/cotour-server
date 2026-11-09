const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { ReactionRuntime } = require("../reaction-runtime");
const { PresentationMetricsRepository } = require("../presentation-metrics");

function fixture() {
  let now = 1000;
  const screen = [], own = [], other = [];
  const runtime = new ReactionRuntime({ emitScreen: (payload) => screen.push(payload), now: () => now });
  const socket = { emit: (event, payload) => own.push({ event, payload }) };
  const react = (audienceId, emoji = "❤️", showOnScreen = true) => runtime.react({ socket, audienceId, emoji, showOnScreen });
  return { runtime, screen, own, other, react, advance: (ms) => { now += ms; } };
}

test("100 valid reactions count and echo to their sender; only 40 fan out to Screen", () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) assert.equal(f.react(`aud-${i}`), true);
  assert.equal(f.own.length, 100);
  assert.equal(f.screen.length, 40);
  assert.equal(f.runtime.bucket.counts["❤️"], 100);
  assert.equal(f.own.every((event) => event.payload.target === "audience"), true);
  assert.equal(f.screen.every((event) => event.target === "screen"), true);
  f.advance(3099);
  assert.equal(f.react("new"), true);
  assert.equal(f.screen.length, 40);
  f.advance(1);
  f.react("next");
  assert.equal(f.screen.length, 41);
});

test("disabled Screen still counts and confirms own reactions", () => {
  const f = fixture();
  assert.equal(f.react("aud", "🔥", false), true);
  assert.equal(f.runtime.bucket.counts["🔥"], 1);
  assert.equal(f.own.length, 1);
  assert.equal(f.screen.length, 0);
});

test("spam, invalid emoji and missing identity are rejected without counting or sending", () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) assert.equal(f.react("aud"), true);
  for (let i = 0; i < 500; i++) assert.equal(f.react("aud"), false);
  // Changing the socket does not replenish the identity's budget.
  assert.equal(f.runtime.react({ socket: { emit() { throw Error("unexpected echo"); } }, audienceId: "aud", emoji: "👏", showOnScreen: true }), false);
  assert.equal(f.react("different", "💩"), false);
  assert.equal(f.react(null), false);
  assert.equal(f.runtime.bucket.version, 4);
  f.advance(499);
  assert.equal(f.react("aud"), false);
  f.advance(1);
  assert.equal(f.react("aud", "👏"), true);
  assert.equal(f.runtime.bucket.version, 5);
});

test("metrics snapshots retry safely and preserve all reactions beyond the visual cap", async () => {
  const f = fixture();
  f.runtime.setRecording("live-1");
  for (let i = 0; i < 100; i++) f.react(`aud-${i}`);
  const calls = [];
  let fail = true;
  const repository = { async recordReactionSnapshot(payload) { calls.push(payload); if (fail) throw Error("temporary DB failure"); } };
  await assert.rejects(f.runtime.flush(repository, {}));
  fail = false;
  await f.runtime.flush(repository, {});
  assert.equal(calls[1].counts["❤️"], 100);
  assert.equal(calls[0].collectorId, calls[1].collectorId);
  await f.runtime.flush(repository, {});
  assert.equal(calls.length, 2);
  const sqlCalls = [];
  await new PresentationMetricsRepository({ async execute(sql, params) { sqlCalls.push({ sql, params }); return [{}]; } }).recordReactionSnapshot(calls[1]);
  assert.match(sqlCalls[0].sql, /GREATEST\(reaction_count, VALUES\(reaction_count\)\)/);
  assert.equal(sqlCalls[0].params[3], 100);
});

test("finalization flushes to the completed recording and a new recording uses a separate collector", async () => {
  const f = fixture();
  f.runtime.setRecording("live-1");
  f.react("aud", "👏");
  f.runtime.accepting = false;
  assert.equal(f.react("aud"), false);
  const calls = [];
  const repository = { async recordReactionSnapshot(payload) { calls.push(payload); } };
  await f.runtime.flush(repository, {}, "live-1");
  f.runtime.setRecording("live-2");
  f.react("aud", "🔥");
  await f.runtime.flush(repository, {});
  assert.equal(calls[0].presentationSessionId, "live-1");
  assert.equal(calls[0].counts["👏"], 1);
  assert.equal(calls[1].presentationSessionId, "live-2");
  assert.equal(calls[1].counts["👏"], 0);
  assert.equal(calls[1].counts["🔥"], 1);
  assert.notEqual(calls[0].collectorId, calls[1].collectorId);
});

test("pending test-mode snapshots cannot leak into a newly started recording", async () => {
  const f = fixture();
  f.react("aud");
  let resolve;
  const calls = [];
  const repository = { activeLiveSession: () => new Promise((done) => { resolve = done; }), recordReactionSnapshot: async (payload) => calls.push(payload) };
  const pending = f.runtime.flush(repository, {});
  await Promise.resolve(); await Promise.resolve();
  f.runtime.setRecording("live-1");
  resolve("live-1");
  await pending;
  assert.equal(calls.length, 0);
});

test("Screen DOM never exceeds 40 even if incoming messages arrive in a burst", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/screen/screen.js"), "utf8");
  const functionSource = source.slice(source.indexOf("function popReaction("), source.indexOf("function initDrawingOverlay("));
  const children = [], timers = [];
  const container = { get childElementCount() { return children.length; }, appendChild(node) { children.push(node); } };
  const context = { overlays: { showReactions: true }, Math, setTimeout: (callback) => timers.push(callback), document: {
    getElementById: () => container,
    createElement: () => ({ style: { setProperty() {} }, remove() { children.splice(children.indexOf(this), 1); } })
  } };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  for (let i = 0; i < 100; i++) context.popReaction("❤️");
  assert.equal(children.length, 40);
  timers.shift()();
  context.popReaction("👏");
  assert.equal(children.length, 40);
});
