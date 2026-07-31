const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Breakout Screen lobby keeps the practice paddle above the locked cover", () => {
  const ui = source("public/shared/breakout-ui.js");
  const css = source("public/shared/breakout-ui.css");

  assert.match(ui, /breakout-ready-logo" src="\/shared\/magnific-logo\.svg"/);
  assert.match(css, /\.breakout-screen\.ready \.breakout-board\{[^}]*z-index:6/);
  assert.match(
    css,
    /\.breakout-screen\.ready \.breakout-board>:not\(\.breakout-paddle\)\{display:none\}/
  );
});

test("Breakout uses one transparent logo in the lobby and game header", () => {
  const logo = source("public/shared/magnific-logo.svg");
  const logoCss = source("public/shared/breakout-logo.css");
  const screen = source("public/screen/index.html");

  assert.doesNotMatch(logo, /M 0 0 L 2048 0 L 2048 1170 L 0 1170/);
  assert.match(logoCss, /\.breakout-ready-logo/);
  assert.match(logoCss, /\.breakout-screen header span/);
  assert.match(logoCss, /magnific-logo\.svg\?v=104/);
  assert.match(screen, /breakout-logo\.css\?v=104/);
});
