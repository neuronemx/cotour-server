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
