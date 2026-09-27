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

  assert.match(html, /\/screen\/audio-react-overlay\.js\?v=4/);
  assert.match(screen, /socket\.on\("audio-react:state"/);
  assert.match(screen, /<audio preload="auto" crossorigin="anonymous"><\/audio>/);
  assert.match(screen, /media\.removeAttribute\("crossorigin"\)/);
  assert.doesNotThrow(() => new vm.Script(overlay));
  assert.match(overlay, /context\.createMediaElementSource\(audioEl\)/);
  assert.match(overlay, /audioEl\.readyState < 2/);
  assert.match(overlay, /nextAnalyser\.connect\(context\.destination\)/);
  assert.doesNotMatch(overlay, /analyserEl/);
  assert.match(overlay, /FALLBACK_LOGO/);
  assert.match(css, /\.audio-react-overlay\{[\s\S]*pointer-events:none/);
  assert.doesNotMatch(css, /mix-blend-mode:screen/);
  assert.match(overlay, /function drawLines\(\)/);
  assert.match(overlay, /function drawSand\(\)/);
  assert.match(overlay, /function drawLogoPulse\(\)/);
  assert.match(overlay, /initCloud\(\); initBlobs\(\);/);
  assert.match(css, /\.audio-react-overlay\{[\s\S]*z-index:2/);
  assert.match(css, /\.screen\.has-focus-overlay::after \{ z-index: 1;/);
});

test("Audio React connects the real media to the analyser and speaker", () => {
  const overlay = read("public/screen/audio-react-overlay.js");
  const connections = [];
  const elements = [];
  const media = { src: "https://media.immersalive.com/audio/Champions.mp3", crossOrigin: "anonymous", readyState: 4, addEventListener() {} };
  const classList = { add() {}, remove() {}, toggle() {} };
  const context2d = { setTransform() {}, clearRect() {} };
  const document = {
    createElement(tag) {
      elements.push(tag);
      if (tag === "canvas") return { style: {}, classList, getContext: () => context2d, setAttribute() {} };
      return { style: {}, classList, setAttribute() {} };
    },
    addEventListener() {}
  };
  class FakeAudioContext {
    constructor() { this.state = "running"; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createMediaElementSource(element) {
      assert.equal(element, media);
      connections.push("source");
      return { connect: () => connections.push("analyser") };
    }
    createAnalyser() {
      return { frequencyBinCount: 256, connect: (destination) => {
        assert.equal(destination, this.destination);
        connections.push("speaker");
      } };
    }
  }
  const window = { AudioContext: FakeAudioContext, addEventListener() {} };
  vm.runInNewContext(overlay, {
    window, document, innerWidth: 100, innerHeight: 100, devicePixelRatio: 1,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 }, console
  });
  window.ImmersaAudioReact.init({ root: { clientWidth: 100, clientHeight: 100, appendChild() {} } });
  window.ImmersaAudioReact.setAudioElement(media);
  assert.deepEqual(connections, []);
  window.ImmersaAudioReact.setState({ enabled: true });
  assert.deepEqual(connections, ["source", "analyser", "speaker"]);
  assert.equal(elements.includes("audio"), false);
  window.ImmersaAudioReact.setState({ enabled: false });
  assert.deepEqual(connections, ["source", "analyser", "speaker"]);
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
  assert.match(presenter, /nextEnabled/);
  assert.match(presenter, /const selected = audiovisualTab === tab && \(!isReact \|\| audioReactState\.enabled\)/);
  assert.match(presenter, /audioReactThumbnails/);
  assert.match(presenter, /data-react-choice/);
  assert.match(presenter, /audio-react-grid/);
  assert.match(presenterCss, /\.audio-react-grid\{[\s\S]*grid-template-columns:repeat\(2/);
});
