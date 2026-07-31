const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BreakoutUi = require("../public/shared/breakout-ui");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8");

test("Screen ready state owns the Breakout intro and reveals its lobby at ten seconds", () => {
  const html = BreakoutUi.boardMarkup(
    { id: "breakout-1", status: "ready" },
    "screen",
  );
  assert.match(html, /data-breakout-intro/);
  assert.match(html, /data-breakout-intro-video/);
  assert.match(html, /\/assets\/games\/breakout\/intro\.mp4/);
  assert.match(html, /¡Ustedes controlan este juego!/);
  assert.equal(BreakoutUi.BREAKOUT_INTRO_REVEAL_AT_SECONDS, 10);
});

test("Breakout intro remains exclusive to Screen and each launch has its own replay key", () => {
  assert.doesNotMatch(
    BreakoutUi.boardMarkup({ id: "breakout-1", status: "ready" }, "audience"),
    /data-breakout-intro/,
  );
  assert.doesNotMatch(
    BreakoutUi.boardMarkup({ id: "breakout-1", status: "running" }, "screen"),
    /data-breakout-intro/,
  );
  assert.equal(
    BreakoutUi.introStorageKey("breakout-1"),
    "immersa:breakout:intro:v2:breakout-1",
  );
});

test("Breakout intro includes preload, autoplay recovery, cache busting, and fallback", () => {
  const ui = read("../public/shared/breakout-ui.js");
  const css = read("../public/shared/breakout-ui.css");
  const runtime = read("../public/shared/presentation-runtime.js");
  const asset = path.join(
    __dirname,
    "../public/assets/games/breakout/intro.mp4",
  );
  assert.ok(fs.statSync(asset).size > 10_000_000);
  assert.match(ui, /preload="auto"/);
  assert.match(ui, /link\.rel\s*=\s*["']preload["']/);
  assert.match(ui, /link\.as\s*=\s*["']video["']/);
  assert.match(ui, /BREAKOUT_INTRO_LOAD_TIMEOUT_MS\s*=\s*(?:30000|3e4)/);
  assert.match(ui, /video\.networkState\s*===\s*3\)finishIntro/);
  assert.match(ui, /data-immersa-media-unlock/);
  assert.doesNotMatch(ui, /playing["']?,?\s*\(\)=>markIntroPlayed/);
  assert.match(ui, /function introWasPlayed\(id\)\{if\(!id\)return false/);
  assert.match(ui, /ended["']?,?\s*\(\)=>\{markIntroPlayed\(id\);finishIntro\(\)\}/);
  assert.match(css, /\.breakout-screen\.ready\.is-intro-playing/);
  assert.match(css, /\.breakout-intro\{z-index:10/);
  assert.match(ui, /\},true\)\}if\(role===\x27presenter\x27/);
  assert.match(runtime, /breakout-ui\.css\?v=105/);
  assert.match(runtime, /breakout-ui\.js\?v=109/);
});
