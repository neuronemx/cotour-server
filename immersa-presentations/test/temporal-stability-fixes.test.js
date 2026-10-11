const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Screen live text wraps safely without exposing the Público link action", () => {
  const script = read("public/screen/screen.js");
  const css = read("public/screen/screen.css");
  const html = read("public/screen/index.html");

  assert.match(script, /copy\.textContent = text/);
  assert.doesNotMatch(script, /function liveMessageUrl\(text\)/);
  assert.doesNotMatch(script, /go\.textContent = "Ir"/);
  assert.doesNotMatch(css, /\.message-go/);
  assert.match(css, /\.message \{[\s\S]*?max-height: min\(76vh, 640px\);[\s\S]*?overflow: auto;/);
  assert.match(css, /\.message-copy \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(html, /screen\.css\?v=24/);
  assert.match(html, /screen\.js\?v=22/);
});

test("Público recognizes http, https, and www links without HTML injection", () => {
  const script = read("public/audience/audience.js");
  const css = read("public/audience/audience.css");
  const html = read("public/audience/index.html");

  assert.match(script, /function liveMessageUrl\(text\)/);
  assert.match(script, /\(\?:https\?:\\\/\\\/\|www\\\.\)/);
  assert.match(script, /candidate = "https:\/\/" \+ candidate/);
  assert.match(script, /new URL\(candidate\)/);
  assert.match(script, /copy\.textContent = text/);
  assert.match(script, /go\.textContent = "Ir"/);
  assert.match(script, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.doesNotMatch(script, /liveMessage\.innerHTML/);
  assert.match(css, /\.live-message-copy \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(css, /\.live-message-go \{[\s\S]*?pointer-events: auto;/);
  assert.match(html, /audience\.css\?v=23/);
  assert.match(html, /audience\.js\?v=17/);
});

test("A running Speaker audiovisual video cannot contain or intercept the Tiempo modal", () => {
  const script = read("public/presenter/presenter.js");
  const css = read("public/presenter/presenter.css");
  const html = read("public/presenter/index.html");

  assert.match(script, /document\.body\.appendChild\(immersaTimePanel\)/);
  assert.doesNotMatch(script, /streamArea\.appendChild\(immersaTimePanel\)/);
  assert.match(script, /data-time-close/);
  assert.match(script, /addEventListener\("click", closeImmersaTimePanel\)/);
  assert.match(css, /\.time-panel\.is-open \{[\s\S]*?pointer-events: auto;/);
  assert.match(html, /presenter\.js\?v=85/);
});

test("Audience uses a fixed viewport so Safari keeps the slide centered", () => {
  const css = read("public/audience/audience.css");
  const html = read("public/audience/index.html");

  assert.match(css, /\.audience \{ position: fixed; inset: 0; width: auto; height: auto;/);
  assert.match(css, /#slide \{[\s\S]*?width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain;/);
  assert.match(html, /audience\.css\?v=23/);
});
