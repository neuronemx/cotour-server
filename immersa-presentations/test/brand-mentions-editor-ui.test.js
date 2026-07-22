const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Home exposes the deck brand mention editor", () => {
  const html = read("public/home/index.html");
  const editor = read("public/home/brand-mentions-editor.js");
  const css = read("public/home/brand-mentions-editor.css");

  assert.match(html, /brand-mentions-editor\.css\?v=3/);
  assert.match(html, /brand-mentions-editor\.js\?v=3/);
  assert.match(editor, /button\.textContent = "Marcas"/);
  assert.match(editor, /Menciones de marca/);
  assert.match(editor, /Solo Público/);
  assert.doesNotMatch(editor, /Rotación automática|Cada 120 segundos/);
  assert.doesNotMatch(css, /brand-mentions-schedule/);
  assert.match(css, /role-brand-mentions/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("brand editor covers CRUD, activation, ordering, and bounded logo uploads", () => {
  const editor = read("public/home/brand-mentions-editor.js");

  assert.match(editor, /method: existing \? "PUT" : "POST"/);
  assert.match(editor, /method: "PUT"/);
  assert.match(editor, /method: "DELETE"/);
  assert.match(editor, /"\/order"/);
  assert.match(editor, /brand_ids: next\.map/);
  assert.match(editor, /form\.append\("active"/);
  assert.match(editor, /data\.append\("logo", logo\)/);
  assert.match(editor, /5 \* 1024 \* 1024/);
  assert.match(editor, /png\|jpe\?g\|webp/);
  assert.match(editor, /maxlength="80"/);
  assert.match(editor, /maxlength="140"/);
  assert.match(editor, /URL\.createObjectURL/);
  assert.match(editor, /URL\.revokeObjectURL/);
  assert.doesNotMatch(editor, /\bScreen\b|\bQR\b/);
});
