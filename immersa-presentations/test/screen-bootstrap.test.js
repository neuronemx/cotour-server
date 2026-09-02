const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Screen joins independently of manifest loading and recovers a delayed deck", () => {
  const source = read("public/screen/screen.js");
  const html = read("public/screen/index.html");

  assert.match(source, /socket\.on\("connect", \(\) => \{\s*socket\.emit\("join_presentation"/);
  assert.match(source, /function loadDeckWithRetry\(attempt = 0\)/);
  assert.match(source, /pendingPresentationState = state;/);
  assert.match(source, /if \(pendingPresentationState\) render\(pendingPresentationState\);/);
  assert.match(source, /socket\.on\("presentation_state", render\);/);
  assert.doesNotMatch(source, /socket\.on\("presentation_state", \(state\) => \{ if \(manifest\) render\(state\); \}\);/);
  assert.match(source, /fetch\("\/decks\/" \+ encodeURIComponent\(deckId\)/);
  assert.match(source, /try \{[\s\S]*ImmersaKnowledgeActivities\?\.createScreen/);
  assert.match(source, /Unable to initialize Screen knowledge activities/);
  assert.match(html, /<main id="screen"[\s\S]*id="knowledgeActivityScreen"[\s\S]*<\/main>/);
  assert.match(html, /\/screen\/screen\.js\?v=11/);
  assert.match(html, /\/shared\/knowledge-activities\.js\?v=27/);
  assert.match(source, /width: 376, height: 376/);
  assert.match(source, /function syncScreenFocus\(\)/);
  assert.match(source, /screenRoot\.classList\.toggle\("has-focus-overlay", messageVisible \|\| resultsVisible\)/);
  assert.match(source, /showInteractionResults[\s\S]*syncScreenFocus\(\)/);
  assert.match(source, /applyOverlays[\s\S]*syncScreenFocus\(\)/);
  assert.match(read("public\/screen\/screen.css"), /\.screen\.has-focus-overlay::after \{[\s\S]*?background: rgba\(2, 4, 8, \.22\);[\s\S]*?blur\(4px\)/);
});

test("core presentation state and knowledge activity recovery cannot be blocked by optional snapshots", () => {
  const source = read("server.js");
  const joinStart = source.indexOf('socket.on("join_presentation"');
  const joinEnd = source.indexOf('socket.on("transmission_pause"', joinStart);
  const joinSource = source.slice(joinStart, joinEnd);
  const coreStateIndex = joinSource.indexOf("emitState(currentRoomKey, session)");
  const snapshotIndex = joinSource.indexOf("const snapshotJobs");

  assert.ok(coreStateIndex >= 0);
  assert.ok(snapshotIndex > coreStateIndex);
  assert.match(joinSource, /Promise\.allSettled\(snapshotJobs\.map/);
  assert.match(joinSource, /\["knowledge activity", \(\) => knowledgeActivityRuntime\.sendCurrentState/);
});
