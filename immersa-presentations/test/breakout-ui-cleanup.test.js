const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Breakout landscape art preserves each supplied image without crop or blend", () => {
  const css = source("public/shared/breakout-controls-art.css");
  assert.match(css, /object-fit:contain/);
  assert.match(css, /\.breakout-control-art\.is-off\{display:block\}/);
  assert.match(css, /\.breakout-control-art\.is-on\{display:none\}/);
  assert.match(css, /button\.is-held \.breakout-control-art\.is-on\{display:block\}/);
  assert.doesNotMatch(css, /object-fit:cover/);
  assert.doesNotMatch(css, /mix-blend-mode/);
  assert.doesNotMatch(css, /data-breakout-direction="left"\]::before/);
});

test("Breakout registers as the Games renderer and does not force the tab repeatedly", () => {
  const ui = source("public/shared/breakout-ui.js");
  assert.match(ui, /renderer\.dataset\.interactionsView='games'/);
  assert.match(ui, /activateGamesOnce/);
  assert.doesNotMatch(ui, /shell\.dataset\.view='games'/);
});

test("interactions shell owns renderer visibility by selected view", () => {
  const shell = source("public/shared/interactions-shell.js");
  assert.match(shell, /data-interactions-view/);
  assert.match(shell, /node\.hidden = node\.dataset\.interactionsView !== view/);
  assert.match(shell, /new Set\(\["home", "polls", "raffles", "games"\]\)/);
});

test("Time Sync UI does not mount controls in Speaker or Stage", () => {
  const ui = source("public/shared/time-sync-ui.js");
  assert.match(ui, /if\(r==='presenter'\|\|r==='stage'\)return true/);
  assert.match(ui, /if\(r==='screen'\|\|r==='audience'\)/);
});
