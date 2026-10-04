const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    assert.match(source, /startedOnBackdrop && event\.target === backdrop/);
  });
});
