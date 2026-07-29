const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Stage owns a responsive collapsible thumbnail navigator", () => {
  const html = read("public/stage/index.html");
  const script = read("public/stage/stage.js");
  const css = read("public/stage/stage.css");
  assert.match(html, /id="stageThumbsToggle"[^>]*aria-expanded="true"/);
  assert.match(html, /id="stageThumbs"[^>]*aria-label="Miniaturas de slides"/);
  assert.match(html, /stage-v11/);
  assert.match(script, /renderStageThumbs\(\)/);
  assert.match(script, /button\.addEventListener\("click", \(\) => emitStageSlide\(index\)\)/);
  assert.match(script, /stageThumbs\.scrollTo\(\{ left: Math\.max\(0, left\), behavior: "smooth" \}\)/);
  assert.match(script, /max-width: 760px/);
  assert.match(script, /max-height: 700px/);
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
  assert.match(css, /\.stage-shell\.stage-thumbs-collapsed\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(css, /\.stage-toolbar\s*\{\s*grid-row:\s*1;\s*grid-column:\s*1;/);
  assert.match(css, /\.stage-thumbs-panel\s*\{\s*grid-row:\s*2;\s*grid-column:\s*1;/);
  assert.match(css, /\.screen-stage\s*\{\s*grid-row:\s*3;\s*grid-column:\s*1;/);
  assert.match(css, /\.stage-thumbs-toggle\s*\{[\s\S]*?grid-column:\s*2/);
  assert.match(css, /\.stage-thumbs-panel:not\(\.is-open\)\s*\{[\s\S]*?justify-self:\s*end/);
  assert.match(css, /\.stage-shell\.stage-thumbs-collapsed \.stage-thumbs-panel,[\s\S]*?\.stage-shell\.stage-thumbs-collapsed \.screen-stage\s*\{[\s\S]*?grid-row:\s*2/);
  assert.match(script, /stageShell\?\.classList\.toggle\("stage-thumbs-collapsed", !expanded\)/);
  assert.match(css, /\.stage-thumb\.active img/);
});

test("Stage reuses the Immersa video marker without exposing live drawing", () => {
  const html = read("public/stage/index.html");
  const script = read("public/stage/stage.js");
  const css = read("public/stage/stage.css");
  assert.match(script, /data\?\.videos/);
  assert.match(script, /videoSlideIds\.has\(stageSlideIdentity\(item, index\)\)/);
  assert.match(script, /class="stage-thumb-video-mark"/);
  assert.match(script, /#68d8cc/);
  assert.match(script, /#4368f6/);
  assert.match(script, /#9b4cff/);
  assert.match(css, /\.stage-thumb-video-mark\s*\{[\s\S]*?opacity:\s*\.8/);
  assert.match(css, /pointer-events:\s*none/);
  assert.doesNotMatch(html, /id="stageDrawToggle"/);
  assert.match(script, /emitStroke: \(stroke\) => socket\.emit\("drawing_stroke", stroke\)/);
  assert.match(script, /drawingOverlay\.setInteractive\(drawingMode\)/);
});
