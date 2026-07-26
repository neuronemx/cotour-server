const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("all live roles load the shared contest and assessment runtime", () => {
  for (const role of ["presenter", "stage", "audience", "screen"]) {
    const html = read(`public/${role}/index.html`);
    assert.match(html, /shared\/knowledge-activities\.css/);
    assert.match(html, /shared\/knowledge-activities\.js/);
  }
});

test("Público preserves one offline answer and uses the active-tab transfer contract", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /immersaKnowledgePendingAnswer/);
  assert.match(source, /Respuesta guardada\. Esperando conexión/);
  assert.match(source, /La actividad está abierta en otra pestaña/);
  assert.match(source, /interaction:participant:claim_tab/);
  assert.match(source, /pending\.executionId !== state\?\.executionId/);
});

test("Screen has keyboard backup navigation without receiving interaction controls", () => {
  const screen = read("public/screen/screen.js");
  assert.match(screen, /event\.key === "ArrowRight"[\s\S]*?\.emit\("slide_next"\)/);
  assert.match(screen, /event\.key === "ArrowLeft"[\s\S]*?\.emit\("slide_prev"\)/);
  assert.match(screen, /socket\.connected !== false/);
  assert.doesNotMatch(screen, /interaction:execution:(?:start|finalize|force_results)/);
});

test("Home editor exposes configurable contests and assessments", () => {
  const editor = read("public/home/interactions-editor.js");
  assert.match(editor, /moduleCardMarkup\("assessments"/);
  assert.match(editor, /moduleCardMarkup\("contests"/);
  assert.match(editor, /identificationMode/);
  assert.match(editor, /questionDurationSeconds/);
  assert.match(editor, /durationSeconds/);
  assert.match(editor, /correctOptionId/);
  assert.match(editor, /uploadKnowledgeQuestionImage/);
  assert.match(editor, /Imagen opcional/);
  assert.match(editor, /Cambiar imagen/);
  assert.match(editor, /La imagen se eliminará al guardar/);
});

test("live countdown repaint does not rebuild selectable activity cards", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /function updateRenderedTimers/);
  assert.match(source, /data-knowledge-deadline/);
  assert.doesNotMatch(source, /const repaintTimer = global\.setInterval\(render/);
  assert.match(source, /const repaintTimer = global\.setInterval\(\(\) => \{[\s\S]*updateRenderedTimers/);
});

test("lobby cancellation is immediate and distinct from irreversible finalization", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /intent === "finalize" \|\| intent === "force_results"/);
  assert.doesNotMatch(source, /intent === "finalize" \|\| intent === "cancel"/);
});

test("Speaker and Stage activity controls inherit the Immersa dark-glass visual language", () => {
  const css = read("public/shared/knowledge-activities.css");
  assert.match(css, /\.interaction-panel \.knowledge-controller/);
  assert.match(css, /\.stage-actions-card \.knowledge-controller/);
  assert.match(css, /\.interaction-panel \.knowledge-actions \.primary/);
  assert.match(css, /background: var\(--immersa-gradient\)/);
  assert.match(css, /color: rgba\(248, 250, 255, \.96\)/);
});

test("question images render for controller, Público, and Screen question views", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /function questionImageMarkup/);
  assert.match(source, /state\.currentQuestion\?\.image/);
  assert.match(source, /questionImageMarkup\(question\.image\)/);
  assert.match(source, /knowledge-screen-question-image/);
  assert.match(css, /\.knowledge-question-image/);
  assert.match(css, /\.knowledge-screen-question-image/);
});

test("Público renders safe contest progress and legible answer options", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /Number\.isFinite\(Number\(state\.questionCount\)\)/);
  assert.match(source, /Number\.isFinite\(Number\(state\.questionIndex\)\)/);
  assert.match(source, /Pregunta ' \+ questionNumber \+ " de " \+ questionCount/);
  assert.match(css, /\.knowledge-options button \{[\s\S]*?color: #182133/);
  assert.match(css, /\.knowledge-options button\.is-selected \{[\s\S]*?var\(--immersa-gradient/);
});

test("lobby entrants are synchronized as people ready without counting as participants", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /state\.state === "LOBBY"[\s\S]*state\.participantCount/);
  assert.match(source, /lobbyCount === 1 \? "persona lista" : "personas listas"/);
  assert.match(source, /count === 1 \? "persona lista" : "personas listas"/);
  assert.match(source, /state\.effectiveParticipantCount \|\| 0/);
});

test("history exposes per-execution CSV without adding operational warnings", () => {
  const history = read("public/home/knowledge-activity-history.js");
  const exporter = read("knowledge-activity-export.js");
  assert.match(history, /knowledge-activities\/" \+ encodeURIComponent\(execution\.executionId\) \+ "\/export/);
  assert.doesNotMatch(exporter, /respuestas excluidas|error de procesamiento/i);
});
