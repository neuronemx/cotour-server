const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8");

function scriptPaths(html) {
  return [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    ([, src]) => src.split("?")[0],
  );
}

test("Breakout audio loads only on Screen regardless of cache busting", () => {
  const screenScripts = scriptPaths(read("../public/screen/index.html"));
  const stageScripts = scriptPaths(read("../public/stage/index.html"));
  const audienceScripts = scriptPaths(read("../public/audience/index.html"));

  assert.ok(
    screenScripts.some((src) => src.endsWith("/breakout-audio.js")),
    "breakout-audio.js not found on Screen",
  );
  assert.ok(
    !stageScripts.some((src) => src.endsWith("/breakout-audio.js")),
    "breakout-audio.js must not load on Stage",
  );
  assert.ok(
    !audienceScripts.some((src) => src.endsWith("/breakout-audio.js")),
    "breakout-audio.js must not load on Público",
  );
});

test("audio settings are synchronized and Stage-only", () => {
  const sockets = read("../breakout-sockets.js");
  const audio = read("../public/shared/breakout-audio.js");
  assert.match(sockets, /breakout:audio:set/);
  assert.match(sockets, /context\.role!==['"]stage['"]/);
  assert.match(sockets, /breakout:audio:state/);
  assert.match(audio, /Activar sonido/);
  assert.doesNotMatch(audio, /Activar sonido del juego/);
  assert.match(audio, /immersaMediaUnlock/);
  assert.match(audio, /data-breakout-audio-volume/);
});

test("controls point toward center and paddle physics is 1.4x", () => {
  const css = read("../public/shared/breakout-controls-art.css");
  const store = read("../breakout-store.js");
  assert.match(css, /direction="left"[^}]+object-position:right center/s);
  assert.match(css, /direction="right"[^}]+object-position:left center/s);
  assert.match(store, /delta\*\.252/);
});
