const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Screen keeps the slide visible until the selected video paints its first frame", async () => {
  const [source, css, html] = await Promise.all([
    fs.readFile(path.join(root, "public/screen/screen.js"), "utf8"),
    fs.readFile(path.join(root, "public/screen/screen.css"), "utf8"),
    fs.readFile(path.join(root, "public/screen/index.html"), "utf8")
  ]);

  assert.match(source, /requestVideoFrameCallback/);
  assert.match(source, /addEventListener\("playing", \(\) => requestAnimationFrame\(reveal\)/);
  assert.match(source, /incoming\.classList\.add\("is-hiding"\)[\s\S]*revealVideoOnFirstFrame[\s\S]*incoming\.play\(\)/);
  assert.match(css, /\.audiovisual-screen-layer \{[^}]*background:transparent/);
  assert.match(css, /\.audiovisual-video-slot \{[\s\S]*background:#000;[\s\S]*transition:opacity \.18s ease/);
  assert.match(css, /\.audiovisual-video-slot\.is-webm \{ background:transparent; \}/);
  assert.match(html, /\/screen\/screen\.js\?v=\d+/);
});

test("Screen removes video synchronously on stop or natural end", async () => {
  const [source, css] = await Promise.all([
    fs.readFile(path.join(root, "public/screen/screen.js"), "utf8"),
    fs.readFile(path.join(root, "public/screen/screen.css"), "utf8")
  ]);

  assert.match(source, /media\.addEventListener\("ended",[\s\S]*hideVideoLayerImmediately\(\)[\s\S]*socket\.emit\("audiovisual:ended"/);
  assert.match(source, /function stopVideoSlots\(\) \{\s*hideVideoLayerImmediately\(\)/);
  assert.match(source, /audiovisualLayer\?\.classList\.remove\("is-video"\)/);
  assert.match(css, /\.audiovisual-video-slot\.is-hiding \{ opacity:0; transition:none; \}/);
});

test("Plans modal uses the viewport below the measured fixed header", async () => {
  const [source, css, html] = await Promise.all([
    fs.readFile(path.join(root, "public/home/billing.js"), "utf8"),
    fs.readFile(path.join(root, "public/home/billing.css"), "utf8"),
    fs.readFile(path.join(root, "public/home/index.html"), "utf8")
  ]);

  assert.match(source, /\.stage-header"\)\?\.getBoundingClientRect\(\)\.bottom/);
  assert.match(source, /--billing-header-offset/);
  assert.match(css, /\.billing-backdrop\{inset:var\(--billing-header-offset,64px\) 0 0/);
  assert.match(css, /max-height:calc\(100dvh - var\(--billing-header-offset,64px\) - 40px\)/);
  assert.match(html, /\/home\/billing\.css\?v=10/);
  assert.match(html, /\/home\/billing\.js\?v=16/);
});

const vm = require("node:vm");
test("Video lifecycle waits for a frame, cancels stale loads, and can replay after stop", async () => {
  const source = await fs.readFile(path.join(root, "public/screen/screen.js"), "utf8");
  const makeMedia = () => {
    const classes = new Set();
    return { dataset: {}, style: {}, currentTime: 0, paused: true, frames: [],
      classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v),
        toggle: (v, enabled) => enabled ? classes.add(v) : classes.delete(v) },
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {},
      requestVideoFrameCallback(cb) { this.frames.push(cb); }
    };
  };
  const slots = [makeMedia(), makeMedia()];
  const layerClasses = new Set(["is-video"]);
  const context = vm.createContext({
    audiovisualMedia: { video: slots }, activeVideoSlot: 0, videoTransitionToken: 0,
    audiovisualState: { video: {} },
    audiovisualLayer: { classList: { remove: (v) => layerClasses.delete(v) } },
    screenRoot: { classList: { add() {}, remove() {} } },
    clearVideoPlaylistAdvance() {}, scheduleVideoPlaylistAdvance() {},
    resolveAudiovisualMediaUrl: (r) => r.id + ".mp4", console,
    localLibrary: { files: new Map() },
    window: { setTimeout() {} }
  });
  vm.runInContext(source.slice(source.indexOf("function isWebMAudiovisualResource("), source.indexOf("async function scanAndPublishLocalLibrary(")), context);
  vm.runInContext(source.slice(source.indexOf("function hideVideoLayerImmediately()"), source.indexOf("function applyAudioState(state)")), context);
  const apply = (status, id = "a", resource = {}) => {
    context.audiovisualState.video = { resource: { id, ...resource }, status, lastAction: "play", position: 0 };
    context.applyVideoState(context.audiovisualState.video);
  };
  apply("playing");
  assert.equal(slots[1].classList.contains("is-visible"), false);
  slots[1].frames.shift()();
  assert.equal(slots[1].classList.contains("is-visible"), true);
  apply("stopped");
  assert.equal(slots[1].classList.contains("is-visible"), false);
  assert.equal(slots[1].paused, true);
  apply("playing");
  assert.equal(slots[1].classList.contains("is-visible"), false);
  slots[1].frames.shift()();
  assert.equal(slots[1].classList.contains("is-visible"), true);
  apply("playing", "b");
  const staleFrame = slots[0].frames.shift();
  apply("paused", "b");
  staleFrame();
  assert.equal(slots[0].classList.contains("is-visible"), false);
  assert.ok(slots.every((media) => media.paused));
  apply("playing", "b");
  slots[0].frames.shift()();
  assert.equal(slots[0].classList.contains("is-visible"), true);
  assert.equal(slots[0].classList.contains("is-webm"), false);
  apply("playing", "alpha", { media_url: "https://media.example/overlay.webm?v=1" });
  assert.equal(slots[1].classList.contains("is-webm"), true);
  assert.equal(slots[1].classList.contains("is-visible"), false);
  slots[1].frames.shift()();
  assert.equal(slots[1].classList.contains("is-visible"), true);
  apply("paused", "alpha");
  assert.equal(slots[1].paused, true);
  assert.equal(slots[1].classList.contains("is-webm"), true);
  apply("stopped", "alpha");
  assert.ok(slots.every((media) => !media.classList.contains("is-visible")));
  apply("playing", "c");
  slots[0].frames.shift()();
  apply("playing", "d");
  assert.equal(slots[1].classList.contains("is-webm"), false, "reused WebM slot restores the MP4 background");
  slots[1].frames.shift()();
  assert.equal(slots[1].classList.contains("is-visible"), true);
});

test("Audiovisual recognizes WebM from the original local file even with an extensionless blob URL", async () => {
  const source = await fs.readFile(path.join(root, "public/screen/screen.js"), "utf8");
  const context = vm.createContext({ localLibrary: { files: new Map([
    ["alpha", { name: "Transición.WEBM", type: "" }],
    ["mime", { name: "video", type: 'video/webm; codecs="vp9"' }],
    ["mp4", { name: "video.mp4", type: "video/mp4" }]
  ]) } });
  vm.runInContext(source.slice(source.indexOf("function isWebMAudiovisualResource("), source.indexOf("async function scanAndPublishLocalLibrary(")), context);
  for (const id of ["alpha", "mime"]) assert.equal(context.isWebMAudiovisualResource({ id, source: "local" }), true);
  for (const id of ["mp4", "missing"]) assert.equal(context.isWebMAudiovisualResource({ id, source: "local" }), false);
  assert.equal(context.isWebMAudiovisualResource({ media_url: "https://media.example/overlay.WEBM?v=2#frame" }), true);
  assert.equal(context.isWebMAudiovisualResource({ media_url: "https://media.example/clip.mp4?v=overlay.webm" }), false);
  assert.equal(context.isWebMAudiovisualResource(null), false);
});

test("Local Audiovisual scanning publishes WebM as video alongside MP4 and audio", async () => {
  const source = await fs.readFile(path.join(root, "public/screen/screen.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("const localVideoExtensions"), source.indexOf("function localResourceId"))
    + source.slice(source.indexOf("async function collectLocalFiles("), source.indexOf("function clearLocalObjectUrls(")), context);
  const file = (name) => [name, { kind: "file", async getFile() { return { name, type: "" }; } }];
  const directory = { async *entries() {
    yield file("clip.mp4"); yield file("music.mp3"); yield file("ignore.txt");
    yield ["Transiciones", { kind: "directory", async *entries() { yield file("Overlay.WEBM"); } }];
  } };
  const result = await context.collectLocalFiles(directory);
  assert.deepEqual(Array.from(result, ({ type, relativePath, folder }) => ({ type, relativePath, folder })), [
    { type: "video", relativePath: "clip.mp4", folder: "" },
    { type: "audio", relativePath: "music.mp3", folder: "" },
    { type: "video", relativePath: "Transiciones/Overlay.WEBM", folder: "Transiciones" }
  ]);
});
