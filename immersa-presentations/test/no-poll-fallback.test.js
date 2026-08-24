const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Speaker and Backstage show only polls configured in the Deck", () => {
  const store = read("interaction-store.js");
  const presenter = read("public/presenter/presenter.js");
  const stage = read("public/stage/stage.js");
  const presenterHtml = read("public/presenter/index.html");
  const stageHtml = read("public/stage/index.html");

  for (const source of [store, presenter, stage]) {
    assert.doesNotMatch(source, /demo-poll-1|fallback-demo|Encuesta demo/);
  }
  assert.match(store, /if \(!interaction\) return \{ ok: false, reason: "interaction_not_found" \}/);
  assert.doesNotMatch(store, /\|\| interactions\[0\]/);
  assert.match(presenter, /catch \(_error\) \{ interactions = \[\]/);
  assert.match(stage, /catch \(_error\) \{[\s\S]*?interactions = \[\]/);
  assert.match(presenterHtml, /presenter\.js\?v=14/);
  assert.match(stageHtml, /stage\.js\?v=stage-v29/);
});
