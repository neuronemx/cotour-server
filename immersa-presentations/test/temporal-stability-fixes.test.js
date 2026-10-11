const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Screen live text wraps safely and exposes a link action without HTML injection", () => {
  const script = read("public/screen/screen.js");
  const css = read("public/screen/screen.css");
  const html = read("public/screen/index.html");

  assert.match(script, /function liveMessageUrl\(text\)/);
  assert.match(script, /new URL\(candidate\)/);
  assert.match(script, /copy\.textContent = text/);
  assert.match(script, /go\.textContent = "Ir"/);
  assert.match(script, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.match(css, /\.message \{[\s\S]*?max-height: min\(76vh, 640px\);[\s\S]*?overflow: auto;/);
  assert.match(css, /\.message-copy \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(html, /screen\.css\?v=23/);
  assert.match(html, /screen\.js\?v=21/);
});

test("A running Speaker audiovisual video cannot intercept the Tiempo modal", () => {
  const css = read("public/presenter/presenter.css");
  const html = read("public/presenter/index.html");

  assert.match(css, /\.audiovisual-layer \{[\s\S]*?pointer-events:none;/);
  assert.match(css, /\.audiovisual-layer video \{[\s\S]*?pointer-events:none;/);
  assert.match(css, /\.time-panel\.is-open \{[\s\S]*?pointer-events: auto;/);
  assert.match(html, /presenter\.css\?v=81/);
});

test("Audience uses a fixed viewport so Safari keeps the slide centered", () => {
  const css = read("public/audience/audience.css");
  const html = read("public/audience/index.html");

  assert.match(css, /\.audience \{ position: fixed; inset: 0; width: auto; height: auto;/);
  assert.match(css, /#slide \{[\s\S]*?width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain;/);
  assert.match(html, /audience\.css\?v=22/);
});
