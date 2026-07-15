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
  assert.match(html, /breakout-countdown is-urgent/);
  assert.match(html, />9<\/div>/);
});

test("Audience markup keeps exactly two stable directional controls", () => {
  const html = BreakoutUi.audienceMarkup(state);
  assert.equal((html.match(/data-breakout-direction=/g) || []).length, 2);
  assert.match(html, /data-breakout-audience-time/);
  assert.match(html, /data-breakout-audience-score/);
});

test("Breakout browser source supports sustained press without rebuilding controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-ui.js"), "utf8");
  assert.match(source, /HOLD_MS=75/);
  assert.match(source, /audienceMounted/);
  assert.match(source, /controlStatus!==st/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /classList\.toggle\('is-held'/);
});

test("Landscape control art maps all four supplied visual states", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-controls-art.css"), "utf8");
  assert.match(css, /orientation:landscape/);
  assert.match(css, /left-off\.jpg/);
  assert.match(css, /left-on\.jpg/);
  assert.match(css, /right-off\.jpg/);
  assert.match(css, /right-on\.jpg/);
  assert.match(css, /\.breakout-countdown\.is-urgent/);
});
