const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Audio React is a separate, CORS-safe Screen overlay", () => {
  const screen = read("public/screen/screen.js");
  const overlay = read("public/screen/audio-react-overlay.js");
  const html = read("public/screen/index.html");
  const css = read("public/screen/screen.css");

  assert.match(html, /\/screen\/audio-react-overlay\.js\?v=2/);
  assert.match(screen, /socket\.on\("audio-react:state"/);
  assert.match(screen, /<audio preload="auto" crossorigin="anonymous"><\/audio>/);
  assert.doesNotMatch(screen, /<audio preload="auto"><\/audio>/);
  assert.doesNotThrow(() => new vm.Script(overlay));
  assert.match(overlay, /audioEl\.crossOrigin !== "anonymous"/);
  assert.match(overlay, /sourceUrl\.startsWith\("blob:"\)/);
  assert.match(css, /\.audio-react-overlay\{[\s\S]*pointer-events:none/);
  assert.doesNotMatch(css, /mix-blend-mode:screen/);
  assert.match(overlay, /function drawLines\(\)/);
  assert.match(overlay, /function drawSand\(\)/);
  assert.match(overlay, /function drawLogoPulse\(\)/);
  assert.match(overlay, /initCloud\(\); initBlobs\(\);/);
  assert.match(css, /\.audio-react-overlay\{[\s\S]*z-index:2/);
});

test("Audio React state is independently synchronized and controlled", () => {
  const server = read("server.js");
  const presenter = read("public/presenter/presenter.js");
  const presenterCss = read("public/presenter/presenter.css");

  assert.match(server, /function createAudioReactState\(\)/);
  assert.match(server, /audioReact: createAudioReactState\(\)/);
  assert.match(server, /socket\.on\("audio-react:control"/);
  assert.match(server, /reaction: nextReaction/);
  assert.match(server, /emit\("audio-react:state", session\.audioReact\)/);
  assert.doesNotMatch(server, /allowed\.has\(String\(resource\.id\)\)/);
  assert.match(presenter, /\["audio", "video", "react"\]/);
  assert.doesNotMatch(presenter, /data-react-next/);
  assert.doesNotMatch(presenter, /data-react-toggle/);
  assert.match(presenter, /Medio corriendo/);
  assert.match(presenter, /Playlists/);
  assert.match(presenter, /Medios Local/);
  assert.match(presenter, /Medios Immersa/);
  assert.match(presenter, /audiovisualResources = Array\.isArray\(catalog\.resources\)/);
  assert.match(presenter, /audiovisualPanel\.scrollTop = 0/);
  assert.match(presenter, /audio-react-tab-status/);
  assert.match(presenter, /is-playing/);
  assert.match(presenter, /audioReactThumbnails/);
  assert.match(presenter, /data-react-choice/);
  assert.match(presenter, /audio-react-grid/);
  assert.match(presenterCss, /\.audio-react-grid\{[\s\S]*grid-template-columns:repeat\(2/);
});
