const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Speaker and Stage share live text behavior", () => {
  const presenterHtml = read("public/presenter/index.html");
  const presenterScript = read("public/presenter/presenter.js");
  const stageHtml = read("public/stage/index.html");
  const stageScript = read("public/stage/stage.js");
  const sharedControl = read("public/shared/live-text-control.js");

  assert.match(presenterHtml, /id="liveTextToggle"/);
  assert.match(presenterHtml, /id="presenterTextModal"/);
  assert.match(stageHtml, /id="liveTextButton"/);
  assert.match(presenterHtml, /shared\/live-text-control\.js\?v=1/);
  assert.match(stageHtml, /shared\/live-text-control\.js\?v=1/);
  assert.match(presenterScript, /ImmersaLiveTextControl\?\.create/);
  assert.match(stageScript, /ImmersaLiveTextControl\?\.create/);
  assert.match(sharedControl, /socket\.emit\("clear_message"\)/);
  assert.match(sharedControl, /socket\.emit\("overlay_update"/);
});

test("server authorizes both controller roles through one capability guard", () => {
  const server = read("server.js");

  assert.match(server, /const controllerRoles = new Set\(\["presenter", "stage"\]\)/);
  assert.match(server, /function canControlPresentation\(role\)/);
  assert.match(server, /socket\.on\("drawing_stroke"[\s\S]*?!canControlPresentation\(currentRole\)/);
  assert.match(server, /socket\.on\("overlay_update"[\s\S]*?!canControlPresentation\(currentRole\)/);
  assert.match(server, /socket\.on\("clear_message"[\s\S]*?!canControlPresentation\(currentRole\)/);
  assert.match(server, /socket\.on\("transmission_pause"[\s\S]*?!canControlPresentation\(currentRole\)/);
});

test("only the controller that paused can navigate while transmission is paused", () => {
  const server = read("server.js");
  const presenterScript = read("public/presenter/presenter.js");
  const stageScript = read("public/stage/stage.js");

  assert.match(server, /transmissionPausedBy: null/);
  assert.match(server, /session\.transmissionPausedBy = currentRole/);
  assert.match(server, /session\.transmissionPausedBy = null/);
  assert.match(server, /function canNavigatePresentation\(role, session\) \{[\s\S]*?!session\?\.transmissionPaused \|\| session\.transmissionPausedBy === role/);
  assert.equal((server.match(/!canNavigatePresentation\(currentRole, session\)/g) || []).length, 1);
  assert.equal((server.match(/!canStepPresentation\(currentRole, session\)/g) || []).length, 2);
  assert.match(server, /function canStepPresentation\(role, session\) \{[\s\S]*?role === "screen"/);
  assert.match(presenterScript, /state\?\.transmissionPaused && state\?\.transmissionPausedBy !== "presenter"/);
  assert.match(stageScript, /state\.presenterSlideIndex \?\? state\.slideIndex/);
  assert.match(stageScript, /currentState\?\.transmissionPaused && currentState\?\.transmissionPausedBy !== "stage"/);
});

test("Stage exposes Speaker transmission pause inside the slide navigation capsule", () => {
  const html = read("public/stage/index.html");
  const script = read("public/stage/stage.js");
  const css = read("public/stage/stage.css");

  assert.doesNotMatch(html, /class="toolbar-button"[^>]+id="stageTransmissionToggle"/);
  assert.match(html, /class="main-controls"[\s\S]*id="prevSlide"[\s\S]*id="stageTransmissionToggle"[\s\S]*id="nextSlide"[\s\S]*class="slide-status"/);
  assert.equal((html.match(/id="stageTransmissionToggle"/g) || []).length, 1);
  assert.match(html, /id="stageDrawToggle"/);
  assert.match(script, /stageTransmissionToggle\?\.addEventListener\("click"/);
  assert.match(script, /currentState\?\.transmissionPaused \? "transmission_play" : "transmission_pause"/);
  assert.match(script, /stageTransmissionToggle\.innerHTML = paused \? playIcon : pauseIcon/);
  assert.match(script, /stageTransmissionToggle\.classList\.toggle\("is-paused", paused\)/);
  assert.match(css, /\.status-pause-button\.is-paused/);
  assert.match(script, /stageDrawToggle\?\.addEventListener\("click"/);
});
