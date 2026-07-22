const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Deck detail exposes the approved management sections", () => {
  const html = read("public/home/index.html");

  assert.match(html, /deck-management-shell\.css\?v=2/);
  assert.match(html, /deck-management-shell\.js\?v=2/);
  assert.match(html, /data-deck-tab="links">Enlaces/);
  assert.match(html, /data-deck-tab="interactions">Interacciones/);
  assert.match(html, /data-deck-tab="brands">Marcas/);
  assert.match(html, /data-deck-tab="video">Video/);
  assert.match(html, /data-deck-tab="history">Historial/);
  assert.match(html, /data-deck-editor-host="interactions"/);
  assert.match(html, /data-deck-editor-host="brands"/);
  assert.match(html, /data-deck-editor-host="video"/);
  assert.match(html, /id="deckEditorLaunchers" hidden/);
  assert.match(html, /id="detailDelete"[\s\S]+<\/header>/);
  assert.match(html, /data-deck-panel="history"[\s\S]+id="qnaHistory"/);
  assert.doesNotMatch(html, />Business</);
});

test("Deck management shell reuses existing actions without parallel state", () => {
  const source = read("public/home/deck-management-shell.js");

  assert.match(source, /const original = window\.renderDetailActions/);
  assert.match(source, /original\(deck\)/);
  assert.match(source, /\.role-interactions/);
  assert.match(source, /\.role-brand-mentions/);
  assert.match(source, /\.role-videos/);
  assert.match(source, /launchers\.appendChild\(button\)/);
  assert.match(source, /launcher\.click\(\)/);
  assert.match(source, /host\.replaceChildren\(editor\)/);
  assert.match(source, /editor\.setAttribute\("role", "region"\)/);
  assert.match(source, /immersa:deck-detail-close/);
  assert.match(source, /immersa:deck-detail-open/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.doesNotMatch(source, /MutationObserver|setInterval|setTimeout/);
});

test("Deck shell uses Immersa tokens, responsive layout, and reduced motion", () => {
  const css = read("public/home/deck-management-shell.css");

  assert.match(css, /background: var\(--grad\)/);
  assert.match(css, /background: var\(--grad-soft\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.deck-detail-header[\s\S]+grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.deck-detail-header \.deck-detail-thumb[\s\S]+width: 100%/);
  assert.match(css, /\.deck-detail-editor-host \.is-deck-inline/);
  assert.match(css, /max-height: none/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /linear-gradient\(/);
});
