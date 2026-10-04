const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("interaction translations require an uploaded English deck variant", () => {
  const editor = read("public/home/interactions-editor.js");

  assert.ok(editor.includes('return canConfigure("multilanguage.manage") && Number(currentDeck?.locales?.en?.slides || 0) > 0;'));
  assert.ok(editor.includes("function renderPollForm") && editor.includes("const bilingual = englishVariantAvailable();"));
  assert.ok(editor.includes("function knowledgeQuestionEditor"));
  assert.ok(editor.includes("function renderKnowledgeForm") && editor.includes("englishVariantAvailable() ? englishFieldMarkup"));
});

test("English interaction fields start collapsed and show a check after completion", () => {
  const editor = read("public/home/interactions-editor.js");
  const css = read("public/home/interactions-editor.css");

  assert.match(editor, /<details class="interaction-en-extra interaction-en-disclosure" data-english-field>/);
  assert.match(editor, /Campo en inglés completo/);
  assert.ok(editor.includes("if (field.value.trim()) details.open = false;"));
  assert.ok(css.includes(".interaction-en-disclosure > summary"));
  assert.ok(css.includes(".interaction-en-disclosure.is-complete .interaction-en-check"));
  assert.ok(css.includes("summary > span:first-child { color: #6540aa !important; font-size: 12.5px; font-weight: 900; }"));
});

test("public multilingual copy uses lowercase inglés", () => {
  const publicFiles = [
    "public/audience/audience.js",
    "public/audience/index.html",
    "public/home/home.js",
    "public/home/index.html",
    "public/home/interactions-editor.js",
    "public/home/locales-editor.js"
  ];

  publicFiles.forEach((file) => assert.doesNotMatch(read(file), new RegExp("Ingl\\u00e9s")));
});
