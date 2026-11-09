const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Home modals dismiss only when the pointer began on their backdrop", () => {
  const files = [
    "public/home/home.js",
    "public/home/billing.js",
    "public/home/profile-editor.js",
    "public/home/event-invitations.js",
    "public/home/interactions-editor.js",
    "public/home/video-editor.js",
    "public/home/prompter-editor.js",
    "public/home/brand-mentions-editor.js",
    "public/home/locales-editor.js"
  ];

  files.forEach((file) => {
    const source = read(file);
    assert.match(source, /function bindBackdropDismissal/);
    assert.match(source, /addEventListener\(["']pointerdown["']/);
    assert.match(source, /startedOnBackdrop = event\.target === backdrop/);
    assert.match(source, /startedOnBackdrop && endedOnBackdrop && event\.target === backdrop/);
  });
});


test("every Home modal rejects text-selection drags and canceled gestures but accepts real outside clicks", () => {
  for (const name of ["home", "billing", "profile-editor", "event-invitations", "interactions-editor", "video-editor", "prompter-editor", "brand-mentions-editor", "locales-editor"]) {
    const source = read(`public/home/${name}.js`);
    const start = source.indexOf("function bindBackdropDismissal(");
    const end = source.indexOf(name === "home" ? "\n}" : "\n  }", start);
    const documentEvents = {}, backdropEvents = {}, windowEvents = {};
    const backdrop = { addEventListener: (name, handler) => backdropEvents[name] = handler };
    const field = {}, otherField = {};
    let closes = 0;
    const context = { document: { addEventListener(name, handler, capture) { assert.equal(capture, true); documentEvents[name] = handler; } }, window: { addEventListener: (name, handler) => windowEvents[name] = handler } };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\n}", context);
    context.bindBackdropDismissal(backdrop, () => closes++);
    const down = (target) => documentEvents.pointerdown({ target, button: 0, isPrimary: true, pointerId: 1 });
    const up = (target) => documentEvents.pointerup({ target, pointerId: 1 });
    const click = () => backdropEvents.click({ target: backdrop });
    down(field); up(backdrop); click(); assert.equal(closes, 0, name);
    down(backdrop); up(field); click(); assert.equal(closes, 0, name);
    down(backdrop); documentEvents.pointercancel(); click(); assert.equal(closes, 0, name);
    down(backdrop); windowEvents.blur(); click(); assert.equal(closes, 0, name);
    down(backdrop); down(otherField); up(backdrop); click(); assert.equal(closes, 0, name);
    down(backdrop); up(backdrop); click(); assert.equal(closes, 1, name);
    click(); assert.equal(closes, 1, name);
  }
});
