const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const slideVisibility = fs.readFileSync(
  path.join(__dirname, "../public/shared/slide-visibility.js"),
  "utf8"
);

test("Stage navigation follows the controller index while public output is paused", () => {
  assert.match(
    slideVisibility,
    /function currentIndex\(\)\{\s*return Number\(state\?\.presenterSlideIndex\?\?state\?\.slideIndex\?\?0\)\|\|0;\s*\}/
  );
  assert.doesNotMatch(slideVisibility, /state\?\.liveSlideIndex/);
});
