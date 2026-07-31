const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PongUi = require("../public/shared/pong-ui");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), "utf8");

test("Screen ready state owns the Pong intro video and reveals the lobby at ten seconds", () => {
  const html = PongUi.boardMarkup({ id: "pong-1", status: "ready" }, "screen");
  assert.match(html, /data-pong-intro/);
  assert.match(html, /data-pong-intro-video/);
  assert.match(html, /\/assets\/games\/pong\/intro\.mp4/);
  assert.equal(PongUi.PONG_INTRO_REVEAL_AT_SECONDS, 10);
});

test("Pong intro remains exclusive to Screen and each launch has its own replay key", () => {
  assert.doesNotMatch(PongUi.boardMarkup({ id: "pong-1", status: "ready" }, "viewer"), /data-pong-intro/);
  assert.doesNotMatch(PongUi.boardMarkup({ id: "pong-1", status: "running" }, "screen"), /data-pong-intro/);
  assert.equal(PongUi.introStorageKey("pong-1"), "immersa:pong:intro:pong-1");
  assert.notEqual(PongUi.introStorageKey("pong-1"), PongUi.introStorageKey("pong-2"));
});

test("Pong intro has preload, autoplay recovery, cache busting, and a non-blocking fallback", () => {
  const ui = read("../public/shared/pong-ui.js");
  const css = read("../public/shared/pong-ui.css");
  const runtime = read("../public/shared/presentation-runtime.js");
  const asset = path.join(__dirname, "../public/assets/games/pong/intro.mp4");
  assert.ok(fs.statSync(asset).size > 10_000_000);
  assert.match(ui, /preload="auto"/);
  assert.match(ui, /link\.rel = "preload"/);
  assert.match(ui, /link\.as = "video"/);
  assert.match(ui, /PONG_INTRO_LOAD_TIMEOUT_MS = 6000/);
  assert.match(ui, /video\.readyState < 2\) finishIntro/);
  assert.match(ui, /data-immersa-media-unlock/);
  assert.match(css, /\.pong-screen\.ready\.is-intro-playing\.is-intro-revealed/);
  assert.match(runtime, /pong-ui\.css\?v=\d+/);
  assert.match(runtime, /pong-ui\.js\?v=\d+/);
});
