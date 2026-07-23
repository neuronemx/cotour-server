const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Speaker tools render in the requested visual order", () => {
  const html = read("public/presenter/index.html");
  const css = read("public/presenter/presenter.css");
  const tools = html.match(/<div class="fx-module"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";
  const domOrder = ["audienceQr", "localReactions", "drawToggle", "liveTextToggle", "interactionToggle"]
    .map((id) => [id, tools.indexOf(`id="${id}"`)])
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  assert.deepEqual(domOrder, ["audienceQr", "localReactions", "drawToggle", "liveTextToggle", "interactionToggle"]);
  assert.match(css, /\.fx-module[\s\S]*?flex-direction:\s*column-reverse/);
});

test("Speaker marks only video slides with the 80 percent Immersa gradient icon", () => {
  const script = read("public/presenter/presenter.js");
  const css = read("public/presenter/presenter.css");
  assert.match(script, /data\?\.videos/);
  assert.match(script, /video\?\.slide_id/);
  assert.match(script, /videoSlideIds\.has\(slideIdentity\(item, index\)\)/);
  assert.match(script, /class="thumb-video-mark"/);
  assert.match(script, /#68d8cc/);
  assert.match(script, /#4368f6/);
  assert.match(script, /#9b4cff/);
  assert.match(css, /\.thumb-video-mark\s*\{[\s\S]*?left:\s*50%[\s\S]*?top:\s*50%[\s\S]*?opacity:\s*\.8/);
  assert.match(css, /pointer-events:\s*none/);
});
