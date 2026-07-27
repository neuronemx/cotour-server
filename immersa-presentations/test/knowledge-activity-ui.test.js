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
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(css, /\.interaction-panel \.knowledge-controller/);
  assert.match(css, /\.stage-actions-card \.knowledge-controller/);
  assert.match(css, /\.interaction-panel \.knowledge-actions \.primary/);
  assert.match(css, /background: var\(--immersa-gradient\)/);
  assert.match(css, /color: rgba\(248, 250, 255, \.96\)/);
  assert.match(source, /knowledge-definition-icon/);
  assert.match(source, /knowledge-definition-copy/);
  assert.match(source, /knowledge-definition-arrow/);
  assert.match(css, /\.interaction-panel \.knowledge-definition,[\s\S]*?linear-gradient\(135deg, rgba\(127, 119, 221, \.72\)/);
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
  assert.match(css, /\.knowledge-screen-question-image \{[\s\S]*?width: auto;[\s\S]*?max-height: 35vh;[\s\S]*?background: transparent;/);
});

test("Público renders safe contest progress and legible answer options", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /Number\.isFinite\(Number\(state\.questionCount\)\)/);
  assert.match(source, /Number\.isFinite\(Number\(state\.questionIndex\)\)/);
  assert.match(source, /Pregunta ' \+ questionNumber \+ " de " \+ questionCount/);
  assert.match(css, /\.knowledge-options button \{[\s\S]*?color: #182133/);
  assert.match(css, /\.knowledge-options button\.is-selected \{[\s\S]*?var\(--immersa-gradient/);
  assert.match(source, /qualified = state\.personalResult\.correctCount > 0/);
  assert.match(source, /Sin posición/);
  assert.match(css, /\.knowledge-result-detail \{[\s\S]*?color: #182133/);
  assert.match(source, /knowledge-result-mark/);
  assert.match(source, /answer\.selectedLabel \|\| "Omitida"/);
  assert.doesNotMatch(source, /answer\.correctLabel/);
  assert.match(css, /\.knowledge-result-detail\.correct \.knowledge-result-mark/);
  assert.match(css, /\.knowledge-result-detail\.incorrect \.knowledge-result-mark/);
});

test("contest lobby, synchronized countdown, winner view, and Screen audio follow the live contract", () => {
  const source = read("public/shared/knowledge-activities.js");
  const engine = read("knowledge-activity-engine.js");
  const editor = read("public/home/interactions-editor.js");
  assert.match(engine, /const COUNTDOWN_MS = 4700/);
  assert.match(engine, /NO_READY_PARTICIPANTS/);
  assert.match(engine, /Necesitas al menos una persona lista para iniciar/);
  assert.match(source, /data-knowledge-command="start"[\s\S]*disabled/);
  assert.match(source, /data-knowledge-countdown/);
  assert.match(source, /return "¡Inicia!"/);
  assert.match(source, /¡Tenemos ganador!/);
  assert.match(source, /No hubo respuestas correctas/);
  assert.match(source, /\/assets\/audio\/contests\/321\.mp3/);
  assert.match(source, /\/assets\/audio\/contests\/tictac\.mp3/);
  assert.match(source, /\/assets\/audio\/contests\/Resultado_pregunta\.mp3/);
  assert.match(source, /\/assets\/audio\/contests\/Final_concurso\.mp3/);
  assert.match(source, /tracks\.tick\.loop = true/);
  assert.match(source, /global\.AudioContext \|\| global\.webkitAudioContext/);
  assert.match(source, /createBufferSource\(\)/);
  assert.match(source, /source\.loop = true/);
  assert.match(source, /function startTick\(\)/);
  assert.match(source, /function stopTick\(\)/);
  assert.match(source, /next\.substate === "REVEAL"[\s\S]*previous\?\.executionId === next\.executionId[\s\S]*previous\?\.substate !== "REVEAL"/);
  assert.match(source, /if \(enteredReveal\) play\(tracks\.reveal\)/);
  assert.match(source, /\[data-immersa-media-unlock\]:not\(\[data-knowledge-audio-unlock\]\)/);
  assert.match(source, /dataset\.knowledgeAudioBound/);
  assert.match(editor, /questionDurationSeconds: category === "contest" \? 15/);
  for (const name of ["321.mp3", "tictac.mp3", "Resultado_pregunta.mp3", "Final_concurso.mp3"]) {
    assert.equal(fs.statSync(path.join(root, "public/assets/audio/contests", name)).size > 0, true);
  }
});

test("Público uses the supplied entrance and answer-selection sounds", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /\/assets\/audio\/contests\/click1\.mp3/);
  assert.match(source, /\/assets\/audio\/contests\/click2\.mp3/);
  assert.match(source, /audienceAudio\.play\("join"\)/);
  assert.match(source, /audienceAudio\.play\("answer"\)/);
  for (const name of ["click1.mp3", "click2.mp3"]) {
    assert.equal(fs.statSync(path.join(root, "public/assets/audio/contests", name)).size > 0, true);
  }
});

test("Público lobby places a wide Entrar action beside the activity title", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /knowledge-registration-head/);
  assert.match(source, /knowledge-registration-copy/);
  assert.match(source, /data-knowledge-join>Entrar/);
  assert.match(css, /\.knowledge-registration-head \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.knowledge-registration-head \.primary \{[\s\S]*?min-width: clamp\(124px, 34vw, 164px\);/);
});

test("Screen announces every real contest question with flash, larger timer, and supplied audio", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /function isNewContestQuestion/);
  assert.match(source, /\/assets\/audio\/contests\/NextQuestion\.mp3/);
  assert.match(source, /if \(isNewContestQuestion\(previous, next\)\) play\(tracks\.nextQuestion\)/);
  assert.match(source, /root\.classList\.add\("is-question-flash"\)/);
  assert.match(css, /\.knowledge-screen-overlay\.is-question-flash::after/);
  assert.match(css, /\.knowledge-screen-card \.knowledge-timer \{[\s\S]*?font: 900 clamp\(42px, 5\.5vw, 78px\)/);
  assert.equal(fs.statSync(path.join(root, "public/assets/audio/contests/NextQuestion.mp3")).size > 0, true);
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
