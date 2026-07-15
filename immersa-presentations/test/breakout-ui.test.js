const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BreakoutUi = require("../public/shared/breakout-ui");

const state = {
  status: "running",
  remaining_ms: 42000,
  score: 300,
  paddle: { x: 0.52, width: 0.22 },
  ball: { x: 0.41, y: 0.63, radius: 0.016 },
  blocks: [
    { id: "a", x: 0.1, y: 0.1, width: 0.1, height: 0.05, active: true },
    { id: "b", x: 0.22, y: 0.1, width: 0.1, height: 0.05, active: false }
  ]
};

test("Breakout role detection covers all presentation roles", () => {
  assert.equal(BreakoutUi.roleFromPath("/speaker/a_1"), "presenter");
  assert.equal(BreakoutUi.roleFromPath("/stage/a_1"), "stage");
  assert.equal(BreakoutUi.roleFromPath("/screen/a_1"), "screen");
  assert.equal(BreakoutUi.roleFromPath("/p_abcd"), "audience");
});

test("controller exposes authoritative game actions", () => {
  assert.match(BreakoutUi.controllerMarkup({ ...state, status: "idle" }), /breakout:start/);
  assert.match(BreakoutUi.controllerMarkup(state), /breakout:pause/);
  assert.match(BreakoutUi.controllerMarkup({ ...state, status: "paused" }), /breakout:resume/);
  assert.match(BreakoutUi.controllerMarkup({ ...state, status: "finished" }), /Jugar otra vez/);
});

test("screen board renders blocks, paddle, ball, score, and time", () => {
  const html = BreakoutUi.boardMarkup(state, "screen");
  assert.match(html, /breakout-screen/);
  assert.match(html, /300 pts/);
  assert.match(html, /42 s/);
  assert.match(html, /breakout-paddle/);
  assert.match(html, /breakout-ball/);
  assert.match(html, /is-hit/);
});

test("audience receives exactly two collective controls", () => {
  const html = BreakoutUi.audienceMarkup(state);
  assert.equal((html.match(/data-breakout-direction=/g) || []).length, 2);
  assert.match(html, /direction="left"/);
  assert.match(html, /direction="right"/);
});

test("browser module requests current state and preserves approved shell source", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-ui.js"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "../public/shared/interactions-shell.js"), "utf8");
  assert.match(ui, /breakout:request_state/);
  assert.match(ui, /data-interactions-category="games"/);
  assert.match(shell, /games", label: "Juegos", enabled: false/);
});