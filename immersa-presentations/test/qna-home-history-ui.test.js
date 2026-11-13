const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("Data presents registration and the session dashboard with a single session export", () => {
  const html = fs.readFileSync(require("node:path").join(__dirname,"../public/home/index.html"),"utf8");
  assert.match(html, /id="deckSectionData"/);
  assert.match(html, /id="deckPanelRegistration"/);
  assert.equal((html.match(/id="sessionExport"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="qnaHistory"|id="knowledgeActivityHistory"|home\/audience-engagement\.js/);
});
