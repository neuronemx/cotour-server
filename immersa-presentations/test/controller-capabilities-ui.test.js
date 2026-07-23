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

test("Stage exposes Speaker transmission pause and live drawing controls", () => {
  const html = read("public/stage/index.html");
  const script = read("public/stage/stage.js");

  assert.match(html, /id="stageTransmissionToggle"/);
  assert.match(html, /id="stageDrawToggle"/);
  assert.match(script, /stageTransmissionToggle\?\.addEventListener\("click"/);
  assert.match(script, /currentState\?\.transmissionPaused \? "transmission_play" : "transmission_pause"/);
  assert.match(script, /stageDrawToggle\?\.addEventListener\("click"/);
});
