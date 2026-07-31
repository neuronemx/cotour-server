const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const collapsePathOne = /M8,26a2,2,0,0,0-2,2\.3/;
const collapsePathTwo = /M43\.7,4\.8a2,2,0,0,0-3\.1-\.2/;
const activeGlass = /background:\s*linear-gradient\(180deg,\s*rgba\(35,\s*43,\s*47,\s*\.54\),\s*rgba\(8,\s*10,\s*14,\s*\.50\)\)/;

test("Público and Screen copy Speaker fullscreen expand and collapse icons", () => {
  for (const file of [
    "public/presenter/index.html",
    "public/audience/index.html",
    "public/screen/index.html",
    "public/shared/breakout-ui.js"
  ]) {
    const source = read(file);
    assert.match(source, /class="fullscreen-expand-icon"/, file);
    assert.match(source, /class="fullscreen-collapse-icon"/, file);
    assert.match(source, collapsePathOne, file);
    assert.match(source, collapsePathTwo, file);
  }
});

test("all fullscreen controls retain the dark Speaker glass while active", () => {
  for (const file of [
    "public/presenter/presenter.css",
    "public/audience/audience.css",
    "public/screen/screen.css",
    "public/shared/breakout-controls-art.css"
  ]) {
    assert.match(read(file), activeGlass, file);
  }
  assert.doesNotMatch(read("public/audience/audience.js"), /fullscreen\.textContent\s*=/);
  assert.doesNotMatch(read("public/screen/screen.js"), /fullscreenToggle\.textContent\s*=/);
});

test("Breakout keeps its local fullscreen exit while Pong relies on Público global fullscreen", () => {
  const breakout = read("public/shared/breakout-ui.js");
  assert.match(breakout, /aria-pressed/);
  assert.match(breakout, /exitFullscreen/);
  assert.match(breakout, /webkitExitFullscreen/);
  assert.doesNotMatch(breakout, /button\.hidden\s*=\s*Boolean\(fullscreenElement\(\)\)/);

  const pong = read("public/shared/pong-ui.js");
  assert.doesNotMatch(pong, /data-pong-fullscreen|toggleFullscreen|syncFullscreen|exitFullscreen/);
  assert.match(read("public/audience/index.html"), /id="fullscreen"/);
});
