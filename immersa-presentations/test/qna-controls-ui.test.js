const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Speaker and Stage expose Q&A through Interacciones only after Q&A state arrives", async () => {
  const [presenterHtml, presenterScript, stageHtml, stageScript, controls, css] = await Promise.all([
    fs.promises.readFile(path.join(root, "public", "presenter", "index.html"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "presenter", "presenter.js"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "stage", "index.html"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "stage", "stage.js"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "shared", "qna-controls.js"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "shared", "qna-controls.css"), "utf8")
  ]);

  assert.match(presenterHtml, /shared\/qna-controls\.css/);
  assert.match(presenterHtml, /shared\/qna-controls\.js/);
  assert.match(stageHtml, /shared\/qna-controls\.css/);
  assert.match(stageHtml, /shared\/qna-controls\.js/);
  assert.match(presenterScript, /role: "presenter"/);
  assert.match(presenterScript, /launcher: false/);
  assert.match(presenterScript, /view === "qna"/);
  assert.match(presenterScript, /qnaControls\?\.open\(\)/);
  assert.match(stageScript, /role: "stage"/);
  assert.match(stageScript, /launcher: false/);
  assert.match(stageScript, /view === "qna"/);
  assert.match(controls, /button\.hidden = true/);
  assert.match(controls, /socket\.on\("qna:state", render\)/);
  assert.match(controls, /button\.hidden = !launcher/);
  assert.match(controls, /onAvailabilityChange/);
  assert.match(controls, /Abrir preguntas/);
  assert.match(controls, /state\.questionsOpen \? "Cerrar preguntas" : "Abrir preguntas"/);
  assert.match(controls, /Nueva ronda/);
  assert.doesNotMatch(controls, /Descargar CSV/);
  assert.doesNotMatch(controls, /IMMERSA_ROLE_OPEN\?\.access_token/);
  assert.doesNotMatch(controls, /\/api\/qna\/export\//);
  assert.match(controls, /"qna:set_open"/);
  assert.match(controls, /"qna:select"/);
  assert.match(controls, /"qna:project"/);
  assert.match(controls, /"qna:delete"/);
  assert.match(controls, /"qna:new_round"/);
  assert.match(controls, /"qna:panel_open"/);
  assert.match(controls, /"qna:panel_close"/);
  assert.match(controls, /if \(!question\.answered\).*"delete"/s);
  assert.match(controls, /qna-question-icon\.svg/);
  assert.match(css, /\.qna-control-modal/);
  assert.match(css, /backdrop-filter: blur\(4px\)/);
  assert.match(css, /--immersa-glass/);
  assert.match(presenterScript, /qnaQuestionsOpen = Boolean\(state\?\.questionsOpen\)/);
  assert.match(presenterScript, /setCategoryLive\?\.\("qna", qnaQuestionsOpen\)/);
  assert.match(presenterScript, /interactionPanelOpen \|\| qnaQuestionsOpen/);
  assert.match(stageScript, /qnaQuestionsOpen = Boolean\(state\?\.questionsOpen\)/);
  assert.match(stageScript, /setCategoryCount\?\.\("qna", qnaPendingCount\)/);
  assert.match(stageScript, /stageActionsButton\.classList\.toggle\("is-live", qnaQuestionsOpen\)/);
});

test("Stage omits live drawing independently of the Q&A control UI", async () => {
  const stageHtml = await fs.promises.readFile(path.join(root, "public", "stage", "index.html"), "utf8");
  assert.doesNotMatch(stageHtml, /id="stageDrawToggle"/);
});
