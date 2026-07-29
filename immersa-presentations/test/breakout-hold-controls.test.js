const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BreakoutUi = require("../public/shared/breakout-ui");

const state = {
  status: "running",
  remaining_ms: 9000,
  score: 500,
  paddle: { x: 0.5, width: 0.22 },
  ball: { x: 0.4, y: 0.6, radius: 0.016 },
  blocks: [{ id: "a", x: 0.1, y: 0.1, width: 0.1, height: 0.05, active: true }]
};

test("Screen exposes a large urgent countdown under ten seconds", () => {
  const html = BreakoutUi.boardMarkup(state, "screen");
  assert.ok(html.includes("breakout-countdown is-urgent"));
  assert.ok(html.includes(">9</div>"));
});

test("Audience markup keeps exactly two stable directional controls", () => {
  const html = BreakoutUi.audienceMarkup(state);
  assert.equal((html.match(/data-breakout-direction=/g) || []).length, 2);
  assert.ok(html.includes("data-breakout-audience-time"));
  assert.ok(html.includes("data-breakout-audience-score"));
});

test("Breakout browser source supports sustained press without rebuilding controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-ui.js"), "utf8");
  assert.ok(source.includes("HOLD_MS=75"));
  assert.ok(source.includes("audienceMounted"));
  assert.ok(source.includes("controlStatus!==key"));
  assert.ok(source.includes("lostpointercapture"));
  assert.ok(source.includes("classList.toggle('is-held'"));
});

test("Landscape control art uses image layers for all four visual states", () => {
  const html = BreakoutUi.audienceMarkup(state);
  const css = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-controls-art.css"), "utf8");
  assert.ok(css.includes("orientation:landscape"));
  assert.ok(css.includes(".breakout-control-art.is-off"));
  assert.ok(css.includes(".breakout-control-art.is-on"));
  assert.ok(html.includes("left-off.svg"));
  assert.ok(html.includes("left-on.svg"));
  assert.ok(html.includes("right-off.svg"));
  assert.ok(html.includes("right-on.svg"));
  assert.ok(css.includes(".breakout-countdown.is-urgent"));
});
