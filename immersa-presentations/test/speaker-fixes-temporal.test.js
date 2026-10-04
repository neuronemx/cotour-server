const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Speaker timer is private and never resumes the server speaker channel", () => {
  const script = read("public/presenter/presenter.js");

  assert.match(script, /const speakerTimerState = \{ running: false, elapsedMs: 0, startedAt: 0 \}/);
  assert.match(script, /function speakerElapsedMs\(\)[\s\S]*?Date\.now\(\) - speakerTimerState\.startedAt/);
  assert.match(script, /function resetSpeakerTimer\(\)[\s\S]*?speakerTimerState\.elapsedMs = 0;[\s\S]*?speakerTimerState\.startedAt = 0;/);
  assert.doesNotMatch(script, /time:control", \{ target: "speaker"/);
});

test("Tiempo is centered in the Speaker canvas and offers immediate 5 10 30 minute shortcuts", () => {
  const script = read("public/presenter/presenter.js");
  const css = read("public/presenter/presenter.css");

  assert.match(script, /streamArea\.appendChild\(immersaTimePanel\)/);
  for (const minutes of [5, 10, 30]) assert.match(script, new RegExp(`data-time-shortcut="${minutes}"`));
  assert.match(script, /socket\.emit\("time:control", \{ target: "screen", action: "start", mode: "countdown", hours: 0, minutes, seconds: 0 \}\)/);
  assert.match(css, /\.time-panel \{[\s\S]*?position: absolute;[\s\S]*?max-height: calc\(100% - 32px\);/);
  assert.match(css, /\.time-shortcuts \{[\s\S]*?display: flex;/);
});

test("Closed Audiovisual controls cannot intercept Interacciones", () => {
  const script = read("public/presenter/presenter.js");
  const css = read("public/presenter/presenter.css");

  assert.match(css, /\.audiovisual-panel:not\(\.is-open\),\s*\.audiovisual-panel:not\(\.is-open\) \* \{\s*pointer-events: none !important;/);
  assert.match(script, /if \(interactionPanelOpen\) \{\s*audiovisualPanel\?\.classList\.remove\("is-open"\);\s*closeImmersaTimePanel\(\);\s*syncAudiovisualToggle\(\);/);
});

test("Speaker connected badge uses the supplied people icon without the word conectados", () => {
  const html = read("public/presenter/index.html");
  const icon = read("public/presenter/people.svg");

  assert.match(html, /<span id="audience">0<\/span><img class="audience-people-icon" src="\/presenter\/people\.svg" alt="">/);
  assert.doesNotMatch(html, /data-i18n="live\.connected">conectados/);
  assert.match(icon, /viewBox="0 0 256 256"/);
});

test("Speaker navigation targets are substantially larger in portrait and landscape", () => {
  const css = read("public/presenter/presenter.css");

  assert.match(css, /\.nav-button \{\s*width: 78px !important;[\s\S]*?height: 58px !important;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.nav-button \{\s*width: 70px !important;[\s\S]*?height: 56px !important;/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)[\s\S]*?\.nav-button \{\s*width: 82px !important;[\s\S]*?height: 58px !important;/);
});

test("Interaction groups retain a visible divider", () => {
  const css = read("public/shared/interactions.css");
  assert.match(css, /\.interactions-shell-group-divider \{[\s\S]*?height: 1px;[\s\S]*?background: rgba\(255, 255, 255, \.24\);/);
});
