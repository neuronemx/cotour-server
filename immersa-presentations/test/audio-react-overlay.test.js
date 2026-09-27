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
  const presenterHtml = read("public/presenter/index.html");

  assert.match(html, /\/screen\/audio-react-overlay\.js\?v=5/);
  assert.match(html, /\/screen\/audio-react-three\.js\?v=1/);
  assert.match(html, /\/screen\/screen\.css\?v=22/);
  assert.match(screen, /socket\.on\("audio-react:state"/);
  assert.match(screen, /<audio preload="auto" crossorigin="anonymous"><\/audio>/);
  assert.match(screen, /media\.removeAttribute\("crossorigin"\)/);
  assert.match(html, /\/screen\/screen\.js\?v=20/);
  assert.match(screen, /function findLocalReactionLogo\(handle\)/);
  assert.match(screen, /normalizedName === "logo\.svg" \? 0 : normalizedName === "logo\.png" \? 1/);
  assert.match(screen, /setLocalLogo\(localLibrary\.logoUrl \|\| ""\)/);
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
  assert.match(css, /\.audio-react-logo\{[\s\S]*top:50%/);
  assert.match(css, /\.audio-react-logo\{[\s\S]*left:50%/);
  assert.match(presenterHtml, /presenter\.css\?v=75/);
  assert.match(presenterHtml, /presenter\.js\?v=79/);
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
  const screen = read("public/screen/screen.js");

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
  assert.match(presenter, /audiovisual-panel-sticky/);
  assert.match(presenter, /renderAudiovisualPanel\(true\); \}\);/);
  assert.match(presenter, /is-playing/);
  assert.match(presenter, /nextEnabled/);
  assert.match(presenter, /const selected = audiovisualTab === tab && \(!isReact \|\| audioReactState\.enabled\)/);
  assert.match(presenter, /audioReactThumbnails/);
  assert.match(presenter, /data-react-choice/);
  assert.match(presenter, /audio-react-grid/);
  assert.match(presenterCss, /\.audio-react-grid\{[\s\S]*grid-template-columns:repeat\(2/);
  assert.doesNotMatch(presenterCss, /\\n/);
  assert.match(presenterCss, /\.audiovisual-panel-sticky\{/);
  assert.match(presenterCss, /\.audiovisual-tab\.is-reacting img\{/);
  assert.match(screen, /readLocalAudioDuration/);
  assert.match(screen, /duration: mediaDetails\.duration/);
  assert.match(server, /const duration = Math\.max\(0, Math\.min\(86400/);
  assert.match(server, /duration,\n\s+playlist/);
  assert.match(server, /\(Number\(previous\.reaction \|\| 0\) \+ 1\) % 12/);
  assert.match(server, /Math\.min\(11, Number\.isFinite/);
  assert.match(presenter, /"Logo", "Caja 3D", "Esfera 3D"/);
  assert.match(presenter, /index >= 10 \? "\.svg" : "\.jpg"/);
  assert.match(presenter, /Math\.min\(11, Number\(next\.reaction\) \|\| 0\)/);
  assert.match(presenterCss, /\.audio-react-grid\{/);
});

test("Three.js modes retain the supplied shaders and share the audio analyser safely", () => {
  const script = read("public/screen/audio-react-three.js");
  const overlay = read("public/screen/audio-react-overlay.js");
  const css = read("public/screen/screen.css");
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /function drawParticleSystem\(id\)/);
  assert.match(script, /const boxGeo = new THREE\.BoxGeometry/);
  assert.match(script, /const sphGeo = new THREE\.SphereGeometry/);
  assert.match(script, /particleSystems\.sphere\.ampScale = 0\.45/);
  assert.match(script, /function curl\(float x,float y,float z\)/);
  assert.match(script, /particleSystems\.box = makeSystem\(boxGeo/);
  assert.match(script, /particleSystems\.sphere = makeSystem\(sphGeo/);
  assert.match(script, /threeRenderer\.setClearColor\(0x05060a, 0\)/);
  assert.doesNotMatch(script, /createMediaElementSource/);
  assert.match(script, /loadDependency\("THREE", THREE_URL\)/);
  assert.match(script, /loadDependency\("gsap", GSAP_URL\)/);
  assert.match(script, /threeRenderer\.forceContextLoss\(\)/);
  assert.match(overlay, /const REACTION_COUNT = 12/);
  assert.match(overlay, /reaction === 10 \? "box" : "sphere"/);
  assert.match(overlay, /ImmersaAudioReactThree\?\.stop\(\)/);
  assert.match(css, /\.audio-react-three-canvas\{[^}]*pointer-events:none/);
  assert.match(css, /\.audio-react-logo\{max-width:min\(40\.8vw,504px\);max-height:min\(40\.8vh,504px\)\}/);
});

test("Three.js modes render box and sphere, then release GPU resources without touching audio", () => {
  const script = read("public/screen/audio-react-three.js");
  const calls = { render:0, disposed:0, contextLost:0, elements:[] };
  class Geometry { dispose(){ calls.disposed++; } }
  class ShaderMaterial { constructor(options){ this.uniforms=options.uniforms; } dispose(){ calls.disposed++; } }
  class Object3D { constructor(){ this.position={z:0}; this.rotation={x:0,y:0,z:0}; } add(){} }
  class Renderer {
    setClearColor(_color, alpha){ assert.equal(alpha, 0); }
    setSize(){}
    render(){ calls.render++; }
    dispose(){ calls.disposed++; }
    forceContextLoss(){ calls.contextLost++; }
  }
  const THREE = {
    Scene: class { add(){} }, PerspectiveCamera: class { constructor(){ this.position={z:0}; } updateProjectionMatrix(){} },
    WebGLRenderer: Renderer, ShaderMaterial, Object3D, Points: class { constructor(geo,mat){ this.geometry=geo; this.material=mat; } },
    BoxGeometry: Geometry, SphereGeometry: Geometry, Color: class {},
    MathUtils:{ randInt(min,max){ return (min+max)/2; } }
  };
  const gsap = { to(){ return {}; }, fromTo(){}, killTweensOf(){} };
  const root = { clientWidth:640, clientHeight:360, appendChild(){} };
  const window = { THREE, gsap };
  const document = { createElement(tag){ calls.elements.push(tag); return { className:"", setAttribute(){}, remove(){} }; } };
  vm.runInNewContext(script, { window, document, THREE, gsap, innerWidth:640, innerHeight:360, Math, console });
  const bins = new Uint8Array(256).fill(150);
  window.ImmersaAudioReactThree.draw(root, "box", bins);
  window.ImmersaAudioReactThree.draw(root, "sphere", bins);
  assert.equal(calls.render, 2);
  assert.deepEqual(calls.elements, ["canvas"]);
  window.ImmersaAudioReactThree.stop();
  assert.equal(calls.contextLost, 1);
  assert.ok(calls.disposed >= 5);
});
