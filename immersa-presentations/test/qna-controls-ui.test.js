const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Speaker and Stage expose the shared Q&A controller only after Q&A state arrives", async () => {
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
  assert.match(presenterScript, /before: localReactions\?\.closest\("\.reaction-toggle"\)/);
  assert.match(stageScript, /role: "stage"/);
  assert.match(controls, /button\.hidden = true/);
  assert.match(controls, /socket\.on\("qna:state", render\)/);
  assert.match(controls, /button\.hidden = false/);
  assert.match(controls, /Abrir preguntas/);
  assert.match(controls, /Nueva ronda/);
  assert.match(controls, /Descargar CSV/);
  assert.match(controls, /IMMERSA_ROLE_OPEN\?\.access_token/);
  assert.match(controls, /\/api\/qna\/export\//);
  assert.match(controls, /\^a_\[a-z0-9\]\{10\}\$/);
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
});

test("Q&A control UI does not add live drawing to Stage", async () => {
  const stageHtml = await fs.promises.readFile(path.join(root, "public", "stage", "index.html"), "utf8");
  assert.doesNotMatch(stageHtml, /drawToggle|drawing-button|Trazo vivo/);
});
