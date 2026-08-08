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

test("Stage live text modal is dedicated to text only", () => {
  const stageHtml = read("public/stage/index.html");
  const stageScript = read("public/stage/stage.js");
  const modal = stageHtml.match(/<div id="textModal"[\s\S]*?<\/section>/)?.[0] || "";

  assert.doesNotMatch(modal, />Stage</i);
  assert.doesNotMatch(modal, /Mensaje en pantalla/i);
  assert.match(modal, /<strong id="textModalTitle">Texto en vivo<\/strong>/);
  assert.match(modal, /<label for="messageInput">Este mensaje aparecerá en vivo para todos\.<\/label>/);
  assert.match(modal, />Mostrar texto<[\s\S]*>Cancelar</);
  assert.doesNotMatch(modal, /Link presentación|displayLinkButton/);
  assert.doesNotMatch(stageScript, /displayLinkButton|getPublicUrl/);
});

test("Audience can open its own local QR from the bottom-right corner", () => {
  const html = read("public/audience/index.html");
  const script = read("public/audience/audience.js");
  const css = read("public/audience/audience.css");

  assert.match(html, /id="audienceQrToggle"[\s\S]*?<svg[\s\S]*?<rect x="3" y="3" width="7" height="7"/);
  assert.match(html, /id="audienceQrPanel"[^>]*hidden/);
  assert.match(html, /<strong>Comparte esta presentación<\/strong>/);
  assert.doesNotMatch(html, /id="audienceQrClose"|class="audience-qr-close"/);
  assert.match(html, /qrcodejs@1\.0\.0/);
  assert.match(script, /publicOpenContext\.public_url \|\| window\.location\.href/);
  assert.match(script, /new window\.QRCode\(audienceQrPattern/);
  assert.match(script, /audienceQrToggle\?\.addEventListener\("click"/);
  assert.doesNotMatch(script, /audienceQrClose/);
  assert.match(css, /\.audience-qr-toggle\s*\{[\s\S]*right:[\s\S]*bottom:/);
  assert.match(css, /\.audience-qr-toggle\s*\{[\s\S]*aspect-ratio:\s*1;[\s\S]*border-radius:\s*50%;[\s\S]*overflow:\s*hidden;/);
  assert.match(html, /audience\.css\?v=8/);
});

test("Audience glass controls keep translucent fills inside their borders", () => {
  const css = read("public/audience/audience.css");

  assert.match(css, /\.brand-lockup,\s*\.icon-action,\s*\.audience-qr-toggle,\s*\.reaction-bar,\s*\.reaction-bar button\s*\{\s*background-clip:\s*padding-box;/);
  assert.doesNotMatch(css, /background-clip:\s*border-box/);
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
  assert.match(html, /class="main-controls"[\s\S]*id="prevSlide"[\s\S]*class="slide-status"[\s\S]*id="stageTransmissionToggle"[\s\S]*id="nextSlide"/);
  assert.equal((html.match(/id="stageTransmissionToggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="stageDrawToggle"/);
  assert.match(script, /stageTransmissionToggle\?\.addEventListener\("click"/);
  assert.match(script, /currentState\?\.transmissionPaused \? "transmission_play" : "transmission_pause"/);
  assert.match(script, /stageTransmissionToggle\.innerHTML = paused \? playIcon : pauseIcon/);
  assert.match(script, /stageTransmissionToggle\.classList\.toggle\("is-paused", paused\)/);
  assert.match(css, /\.status-pause-button\.is-paused/);
  assert.match(script, /stageDrawToggle\?\.addEventListener\("click"/);
});

test("Stage simplifies its toolbar and docks compact tools over the slide", () => {
  const html = read("public/stage/index.html");
  const script = read("public/stage/stage.js");
  const css = read("public/stage/stage.css");
  const breakoutAudio = read("public/shared/breakout-audio.js");
  const pongAudio = read("public/shared/pong-audio.js");
  const stageAudio = read("public/shared/stage-game-audio.js");
  const toolbarActions = html.match(/<div class="toolbar-actions"[\s\S]*?<\/div>/)?.[0] || "";

  assert.doesNotMatch(html, /id="presenterStatus"/);
  assert.doesNotMatch(script, /presenterStatus/);
  assert.doesNotMatch(html, />QR público</);
  assert.match(html, /<em>QR<\/em>/);
  assert.match(toolbarActions, /<em>QR<\/em>/);
  assert.doesNotMatch(toolbarActions, /<button/);
  assert.match(html, /class="stage-slide-tools"[\s\S]*id="stageActionsButton"[\s\S]*id="liveTextButton"/);
  assert.match(css, /\.stage-slide-tools\s*\{[\s\S]*right:\s*16px;[\s\S]*bottom:\s*16px;[\s\S]*flex-direction:\s*column;/);
  assert.match(html, /id="stageAudioControls" class="stage-audio-controls-host"/);
  assert.match(html, /stage-game-audio\.js\?v=1/);
  assert.doesNotMatch(html, /breakout-audio\.js|pong-audio\.js/);
  assert.doesNotMatch(html, /Arcade|Paquete de audio/);
  assert.doesNotMatch(stageAudio, /Arcade|Paquete de audio|<select/);
  assert.match(stageAudio, /breakout:audio:set/);
  assert.match(stageAudio, /pong:audio:set/);
  assert.match(breakoutAudio, /getElementById\('stageAudioControls'\)/);
  assert.match(pongAudio, /getElementById\("stageAudioControls"\)/);
});
