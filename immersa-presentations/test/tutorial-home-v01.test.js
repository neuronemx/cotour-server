const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Tutorial HOME is an opt-in floating layer on the real Home and Speaker surfaces", () => {
  const engine = read("public/shared/tutorials/tutorial-engine.js");
  const definitions = read("public/shared/tutorials/tutorial-definitions.js");
  const css = read("public/shared/tutorials/tutorial-engine.css");
  const home = read("public/home/index.html");
  const speaker = read("public/presenter/index.html");

  assert.match(engine, /get\("tutorial"\) === "1"/);
  assert.match(engine, /localStorage/);
  assert.match(engine, /immersa-tutorial-spotlight/);
  assert.match(engine, /pointer-events:none/);
  assert.match(engine, /this\.persist\(step\.nextContext\)[\s\S]*?this\.exit\(\)/);
  assert.doesNotMatch(engine, /socket\.emit|fetch\(/);
  assert.match(definitions, /context: "home"/);
  assert.match(definitions, /context: "speaker"/);
  assert.match(definitions, /#fileDrop/);
  assert.match(definitions, /#deckTransitionSettings/);
  assert.match(definitions, /\.role-speaker/);
  assert.match(definitions, /#next/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /pointer-events:auto/);
  assert.match(home, /data-tutorial-context="home"/);
  assert.match(home, /\/shared\/tutorials\/tutorial-engine\.js/);
  assert.match(speaker, /data-tutorial-context="speaker"/);
  assert.match(speaker, /\/shared\/tutorials\/tutorial-definitions\.js/);
});