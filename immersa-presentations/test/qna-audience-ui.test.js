const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const audienceDir = path.join(__dirname, "..", "public", "audience");

test("Público Q&A UI preserves the frozen form and visibility contract", async () => {
  const [html, script, css, icon] = await Promise.all([
    fs.promises.readFile(path.join(audienceDir, "index.html"), "utf8"),
    fs.promises.readFile(path.join(audienceDir, "audience.js"), "utf8"),
    fs.promises.readFile(path.join(audienceDir, "audience.css"), "utf8"),
    fs.promises.readFile(path.join(__dirname, "..", "public", "shared", "qna-question-icon.svg"), "utf8")
  ]);
  assert.match(html, /id="qnaOpen"[^>]*hidden/);
  assert.match(html, /<span>Enviar pregunta<\/span>/);
  assert.match(html, /qna-question-icon\.svg/);
  assert.match(html, /maxlength="1000"/);
  assert.match(html, /Nombre <span>\(opcional\)<\/span>/);
  assert.match(html, /Autorizo que mi nombre aparezca en Screen/);
  assert.match(script, /socket\.on\("qna:state", renderQnaState\)/);
  assert.match(script, /socket\.emit\("qna:submit"/);
  assert.match(script, /questionsOpen: Boolean\(state\.questionsOpen\)/);
  assert.match(script, /qnaState\.questionsOpen && !qnaState\.hasSubmitted/);
  assert.match(script, /scheduleQnaCooldown\(10_000\)/);
  assert.match(script, /cooldownRemainingMs/);
  assert.match(script, /Espera 10 segundos para enviar otra pregunta/);
  assert.match(script, /Tu pregunta ha sido enviada/);
  assert.doesNotMatch(script, /QNA_ALREADY_SUBMITTED/);
  assert.doesNotMatch(script, /qna:select|qna:project|qna:delete|qna:new_round/);
  assert.match(css, /\.qna-composer/);
  assert.match(css, /\.qna-open \{[\s\S]+left: 50%;[\s\S]+translateX\(-50%\)/);
  assert.match(icon, /viewBox="0 0 2048 2048"/);
  assert.match(icon, /mask id="qna-transparent-silhouette"/);
  assert.doesNotMatch(icon, /fill="rgb\(253,253,253\)"/);
});
