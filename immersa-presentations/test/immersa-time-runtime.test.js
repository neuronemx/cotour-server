const test = require("node:test");
const assert = require("node:assert/strict");
const { createImmersaTimeState, applyCommand, snapshot } = require("../immersa-time-runtime");

test("Speaker Timer accumulates only while it is running", () => {
  const state = createImmersaTimeState();
  assert.equal(applyCommand(state, { target: "speaker", action: "start" }, 1_000).changed, true);
  assert.equal(snapshot(state, 4_250).speaker.elapsedMs, 3_250);
  assert.equal(applyCommand(state, { target: "speaker", action: "stop" }, 4_250).changed, true);
  assert.equal(snapshot(state, 9_000).speaker.elapsedMs, 3_250);
  applyCommand(state, { target: "speaker", action: "reset" }, 9_000);
  assert.equal(snapshot(state, 9_000).speaker.elapsedMs, 0);
});

test("Screen stopwatch is independent from the private Speaker Timer", () => {
  const state = createImmersaTimeState();
  applyCommand(state, { target: "screen", action: "start", mode: "stopwatch" }, 2_000);
  const stateAtFiveSeconds = snapshot(state, 7_000);
  assert.equal(stateAtFiveSeconds.screen.mode, "stopwatch");
  assert.equal(stateAtFiveSeconds.screen.visible, true);
  assert.equal(stateAtFiveSeconds.screen.elapsedMs, 5_000);
  assert.equal(stateAtFiveSeconds.speaker.elapsedMs, 0);
});

test("Screen countdown remains visible at zero until Speaker closes it", () => {
  const state = createImmersaTimeState();
  applyCommand(state, { target: "screen", action: "start", mode: "countdown", hours: 0, minutes: 0, seconds: 5 }, 2_000);
  const finished = snapshot(state, 7_100);
  assert.equal(finished.screen.visible, true);
  assert.equal(finished.screen.remainingMs, 0);
  assert.equal(finished.screen.running, false);
  applyCommand(state, { target: "screen", action: "hide" }, 7_100);
  assert.equal(snapshot(state, 7_100).screen.visible, false);
});

test("Screen clock opens and closes without becoming a duration timer", () => {
  const state = createImmersaTimeState();
  applyCommand(state, { target: "screen", action: "start", mode: "clock" }, 12_000);
  const open = snapshot(state, 14_000);
  assert.equal(open.screen.mode, "clock");
  assert.equal(open.screen.visible, true);
  assert.equal(open.screen.running, false);
  applyCommand(state, { target: "screen", action: "hide" }, 14_000);
  assert.equal(snapshot(state, 14_000).screen.mode, null);
});
