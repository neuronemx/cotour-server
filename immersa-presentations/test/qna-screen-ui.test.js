const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const screenDir = path.join(__dirname, "..", "public", "screen");

test("Screen renders the frozen Q&A overlay without leaking name consent decisions", async () => {
  const [html, script, css] = await Promise.all([
    fs.promises.readFile(path.join(screenDir, "index.html"), "utf8"),
    fs.promises.readFile(path.join(screenDir, "screen.js"), "utf8"),
    fs.promises.readFile(path.join(screenDir, "screen.css"), "utf8")
  ]);

  assert.match(html, /id="qnaOverlay"[^>]*hidden/);
  assert.match(html, /qna-question-icon\.svg/);
  assert.match(html, /id="qnaQuestion"/);
  assert.match(html, /id="qnaName" hidden/);
  assert.doesNotMatch(html, /Pregunta del público/i);
  assert.match(script, /socket\.on\("qna:screen", renderQnaScreen\)/);
  assert.match(script, /const question = payload\.visible \? payload\.question : null/);
  assert.match(script, /qnaQuestion\.textContent = text/);
  assert.match(script, /qnaName\.textContent = name/);
  assert.match(script, /qnaName\.hidden = !name/);
  assert.match(script, /qnaOverlay\.hidden = true/);
  assert.match(script, /qnaOverlay\.hidden = false/);
  assert.doesNotMatch(script, /allowNameOnScreen|Pregunta del público/i);
  assert.match(css, /\.qna-screen-overlay/);
  assert.match(css, /z-index: 7/);
});
