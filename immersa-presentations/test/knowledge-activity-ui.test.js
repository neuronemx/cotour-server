const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  assert.match(source, /questionImageMarkup\(question\.image, "knowledge-question-image", true\)/);
  assert.match(source, /knowledge-screen-question-image/);
  assert.match(css, /\.knowledge-question-image/);
  assert.match(css, /\.knowledge-screen-question-image/);
  assert.match(css, /\.knowledge-screen-question-image \{[\s\S]*?width: min\(92vw, 1200px\);[\s\S]*?max-height: 58vh;[\s\S]*?background: transparent;/);
  assert.match(source, /knowledge-question-image-link/);
  assert.match(source, /data-knowledge-image-open/);
  assert.match(source, /data-knowledge-image-close/);
  assert.match(css, /\.knowledge-image-viewer-close \{/);
  assert.match(source, /function attachImageViewerGestures/);
  assert.match(source, /canvas\.addEventListener\("pointerdown"/);
  assert.match(source, /canvas\.addEventListener\("pointermove"/);
  assert.match(source, /Math\.min\(6, Math\.max\(1/);
  assert.match(css, /\.knowledge-image-viewer-canvas \{[\s\S]*?touch-action: none;/);
  assert.match(css, /\.knowledge-image-viewer-canvas img \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;[\s\S]*?will-change: transform;/);
  assert.match(source, /Abrir imagen de la pregunta en tamaño real/);
  assert.match(source, /questionImageMarkup\(question\.image, "knowledge-question-image", true\)/);
  assert.match(css, /\.knowledge-question-image-link \{[\s\S]*?cursor: zoom-in;/);
});

test("Público resets repeated assessments to question one and keeps scroll position after answering", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /next\?\.category === "assessment"[\s\S]*previous\?\.executionId === next\?\.executionId/);
  assert.match(source, /if \(next\?\.category === "assessment" && !sameAssessmentExecution\) \{[\s\S]*selectedAssessmentIndex = 0;/);
  assert.match(source, /root\.querySelector\("\.knowledge-audience-card"\)\?\.scrollTop/);
  assert.match(source, /render\(retainedScrollTop\)/);
  assert.match(source, /if \(card\) card\.scrollTop = scrollTop/);
  assert.match(source, /knowledge-assessment-card/);
  assert.match(css, /\.knowledge-assessment-card h2 \{[\s\S]*?font: 400 clamp\(18px, 4\.4vw, 24px\)\/1\.42 Inter/);
  assert.match(source, /readyToSubmit = questions\.length > 0 && answerMap\(\)\.size === questions\.length/);
  assert.match(source, /knowledge-assessment-submit' \+ \(readyToSubmit \? " is-ready" : ""\)/);
  assert.doesNotMatch(source, /data-knowledge-submit ' \+ \(readyToSubmit \? "" : "disabled"\)/);
  assert.match(css, /\.knowledge-assessment-nav button \{[\s\S]*?flex: 1 1 calc\(50% - 6px\);/);
  assert.match(css, /\.knowledge-audience-card \.knowledge-assessment-submit \{[\s\S]*?margin: 22px auto 0;/);
  assert.match(css, /\.knowledge-audience-card \.knowledge-assessment-submit\.is-ready \{[\s\S]*?var\(--immersa-gradient/);
  assert.match(css, /\.knowledge-assessment-card > header \{[\s\S]*?position: sticky;[\s\S]*?top: 0;/);
  assert.match(source, /knowledge-submission-receipt/);
  assert.match(source, /<dt>Nombre<\/dt>/);
  assert.match(source, /<dt>Respuestas<\/dt>/);
  assert.match(source, /<dt>Fecha y hora<\/dt>/);
  assert.doesNotMatch(source, /Espera a que Speaker muestre los resultados/);
});

test("Público can submit an incomplete assessment while only complete assessments light the button", () => {
  const listeners = new Map();
  const emissions = [];
  const handlers = new Map();
  const storage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  };
  const card = { scrollTop: 0 };
  const rootElement = {
    hidden: true,
    innerHTML: "",
    classList: { add() {}, remove() {} },
    querySelector(selector) {
      if (selector === ".knowledge-audience-card") return card;
      if (selector === "[data-knowledge-submit]" && this.innerHTML.includes("data-knowledge-submit")) {
        return {
          addEventListener(_eventName, handler) { handlers.set(selector, handler); }
        };
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const socket = {
    connected: true,
    on(eventName, handler) { listeners.set(eventName, handler); },
    emit(eventName, payload) { emissions.push({ eventName, payload }); }
  };
  const window = {
    confirm() { return true; },
    sessionStorage: storage,
    localStorage: storage,
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  vm.runInNewContext(read("public/shared/knowledge-activities.js"), { window });
  window.ImmersaKnowledgeActivities.createAudience({ socket, root: rootElement });

  const questions = [
    { id: "q-1", prompt: "Uno", options: [{ id: "a-1", label: "A" }] },
    { id: "q-2", prompt: "Dos", options: [{ id: "a-2", label: "A" }] }
  ];
  const onState = listeners.get("interaction:execution:state");
  const partialState = {
    available: true,
    executionId: "assessment-partial",
    category: "assessment",
    state: "ACTIVE",
    participant: { id: "participant-1" },
    questions,
    answers: [{ questionId: "q-1", optionId: "a-1" }]
  };

  onState(partialState);
  assert.match(rootElement.innerHTML, /data-knowledge-submit/);
  assert.doesNotMatch(rootElement.innerHTML, /knowledge-assessment-submit is-ready/);
  assert.doesNotMatch(rootElement.innerHTML, /data-knowledge-submit[^>]*disabled/);
  handlers.get("[data-knowledge-submit]")();
  assert.equal(emissions.at(-1).eventName, "interaction:participant:submit_evaluation");

  onState({
    ...partialState,
    answers: [
      { questionId: "q-1", optionId: "a-1" },
      { questionId: "q-2", optionId: "a-2" }
    ]
  });
  assert.match(rootElement.innerHTML, /knowledge-assessment-submit is-ready/);
});

test("Público executes assessment reset and scroll restoration across authoritative updates", () => {
  const listeners = new Map();
  const socket = {
    connected: true,
    on(eventName, handler) { listeners.set(eventName, handler); },
    emit() {}
  };
  const storageValues = new Map();
  const storage = {
    getItem(key) { return storageValues.get(key) || null; },
    setItem(key, value) { storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  };
  const clickHandlers = new Map();
  const card = { scrollTop: 0 };
  const rootElement = {
    hidden: true,
    _innerHTML: "",
    classList: { add() {}, remove() {} },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = value;
      card.scrollTop = 0;
      clickHandlers.clear();
    },
    querySelector(selector) {
      if (selector === ".knowledge-audience-card") {
        return this._innerHTML.includes("knowledge-audience-card") ? card : null;
      }
      if (selector === "[data-knowledge-next]" && this._innerHTML.includes("data-knowledge-next")) {
        return {
          addEventListener(_eventName, handler) { clickHandlers.set(selector, handler); }
        };
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const window = {
    sessionStorage: storage,
    localStorage: storage,
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  vm.runInNewContext(read("public/shared/knowledge-activities.js"), { window });
  window.ImmersaKnowledgeActivities.createAudience({ socket, root: rootElement });

  const questions = [1, 2, 3].map((index) => ({
    id: "question-" + index,
    prompt: "Pregunta " + index,
    options: [
      { id: "a-" + index, label: "Opción A" },
      { id: "b-" + index, label: "Opción B" }
    ]
  }));
  const state = {
    available: true,
    executionId: "assessment-run-1",
    category: "assessment",
    state: "ACTIVE",
    participant: { id: "participant-1" },
    questions,
    answers: []
  };
  const onState = listeners.get("interaction:execution:state");
  onState(state);
  clickHandlers.get("[data-knowledge-next]")();
  clickHandlers.get("[data-knowledge-next]")();
  assert.match(rootElement.innerHTML, /Pregunta 3 de 3/);

  card.scrollTop = 143;
  onState({
    ...state,
    answers: [{ questionId: "question-3", optionId: "a-3" }]
  });
  assert.match(rootElement.innerHTML, /Pregunta 3 de 3/);
  assert.equal(card.scrollTop, 143);

  onState({
    ...state,
    executionId: "assessment-run-2",
    answers: []
  });
  assert.match(rootElement.innerHTML, /Pregunta 1 de 3/);
  assert.equal(card.scrollTop, 0);
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

test("Público announces every real contest question with flash and supplied audio while Screen keeps a silent flash", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /function isNewContestQuestion/);
  assert.match(source, /\/assets\/audio\/contests\/NextQuestion\.mp3/);
  assert.match(source, /audienceAudio\.play\("nextQuestion"\)/);
  const screenAudio = source.slice(source.indexOf("function createScreenContestAudio"), source.indexOf("function createScreen"));
  assert.doesNotMatch(screenAudio, /nextQuestion/);
  assert.match(source, /root\.classList\.add\("is-question-flash"\)/);
  assert.match(css, /\.knowledge-audience-overlay\.is-question-flash::after/);
  assert.match(css, /\.knowledge-screen-overlay\.is-question-flash::after/);
  assert.match(css, /\.knowledge-screen-card \.knowledge-timer \{[\s\S]*?font: 900 clamp\(42px, 5\.5vw, 78px\)/);
  assert.equal(fs.statSync(path.join(root, "public/assets/audio/contests/NextQuestion.mp3")).size > 0, true);
});

test("Screen contest runtime initializes when NextQuestion audio belongs only to Público", () => {
  class FakeAudio {
    play() { return Promise.resolve(); }
    pause() {}
  }
  const listeners = new Map();
  const socket = {
    on(eventName, handler) { listeners.set(eventName, handler); }
  };
  const classList = { add() {}, remove() {} };
  let unlockButton = null;
  const document = {
    querySelector(selector) {
      return selector === "[data-knowledge-audio-unlock]" ? unlockButton : null;
    },
    createElement() {
      unlockButton = {
        dataset: {},
        addEventListener() {},
        remove() { unlockButton = null; }
      };
      return unlockButton;
    },
    body: {
      appendChild(node) { unlockButton = node; }
    }
  };
  const screenRoot = {
    hidden: true,
    innerHTML: "",
    classList,
    querySelectorAll() { return []; }
  };
  const window = {
    Audio: FakeAudio,
    document,
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  vm.runInNewContext(read("public/shared/knowledge-activities.js"), { window });

  assert.doesNotThrow(() => window.ImmersaKnowledgeActivities.createScreen({ socket, root: screenRoot }));
  assert.equal(listeners.has("interaction:execution:state"), true);

  const onState = listeners.get("interaction:execution:state");
  onState({
    available: true,
    executionId: "execution-screen-render",
    category: "contest",
    title: "Trivia 1",
    state: "LOBBY",
    participantCount: 1,
    effectiveParticipantCount: 0
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-presence/);
  assert.match(screenRoot.innerHTML, />1<\/strong><span>persona lista/);
  assert.match(screenRoot.innerHTML, /knowledge-screen-activity-icon/);
  assert.match(screenRoot.innerHTML, />Trivia 1<\/h1>/);
  assert.doesNotMatch(screenRoot.innerHTML, />Concurso</);

  onState({
    available: true,
    executionId: "execution-screen-render",
    category: "contest",
    title: "Trivia 1",
    state: "COUNTDOWN",
    participantCount: 1,
    effectiveParticipantCount: 0,
    countdownDurationMs: 4700,
    countdownDeadlineAt: new Date(Date.now() + 4700).toISOString(),
    serverNow: new Date().toISOString()
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-countdown/);
  assert.match(screenRoot.innerHTML, />1<\/strong><span>persona lista/);
  assert.doesNotMatch(screenRoot.innerHTML, /0 participantes/);

  onState({
    available: true,
    executionId: "execution-screen-render",
    category: "contest",
    state: "ACTIVE",
    substate: "QUESTION_ACTIVE",
    questionIndex: 0,
    questionCount: 1,
    currentQuestion: {
      id: "question-1",
      prompt: "¿Cuál es la correcta?",
      image: { url: "/question.jpg", alt: "Referencia" }
    },
    reveal: null
  });
  assert.match(screenRoot.innerHTML, /¿Cuál es la correcta\?/);
  assert.match(screenRoot.innerHTML, /\/question\.jpg/);
  assert.doesNotMatch(screenRoot.innerHTML, /knowledge-screen-options|Opción secreta/);

  onState({
    available: true,
    executionId: "execution-screen-render",
    category: "contest",
    state: "ACTIVE",
    substate: "REVEAL",
    questionIndex: 0,
    questionCount: 1,
    currentQuestion: {
      id: "question-1",
      prompt: "¿Cuál es la correcta?",
      image: { url: "/question.jpg", alt: "Referencia" }
    },
    reveal: { correctLabel: "Opción secreta A" }
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-correct-answer/);
  assert.match(screenRoot.innerHTML, />Opción secreta A</);
  assert.doesNotMatch(screenRoot.innerHTML, /¿Cuál es la correcta\?|\/question\.jpg|knowledge-screen-options/);

  onState({
    available: true,
    executionId: "execution-assessment-render",
    category: "assessment",
    title: "Evaluación final",
    state: "LOBBY",
    participantCount: 2,
    effectiveParticipantCount: 0,
    submittedCount: 0
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-intro-state/);
  assert.match(screenRoot.innerHTML, />2<\/strong><span>personas listas/);
  assert.match(screenRoot.innerHTML, />Evaluación final<\/h1>/);
  assert.doesNotMatch(screenRoot.innerHTML, />Evaluación<\/span>/);

  onState({
    available: true,
    executionId: "execution-assessment-render",
    category: "assessment",
    title: "Evaluación final",
    state: "COUNTDOWN",
    participantCount: 2,
    effectiveParticipantCount: 0,
    submittedCount: 0,
    countdownDurationMs: 4700,
    countdownDeadlineAt: new Date(Date.now() + 4700).toISOString(),
    serverNow: new Date().toISOString()
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-countdown/);
  assert.match(screenRoot.innerHTML, />2<\/strong><span>personas listas/);

  onState({
    available: true,
    executionId: "execution-assessment-render",
    category: "assessment",
    title: "Evaluación final",
    state: "ACTIVE",
    participantCount: 2,
    effectiveParticipantCount: 2,
    submittedCount: 1,
    deadlineAt: new Date(Date.now() + 300_000).toISOString(),
    serverNow: new Date().toISOString()
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-assessment-state/);
  assert.match(screenRoot.innerHTML, /knowledge-screen-assessment-timer/);
  assert.match(screenRoot.innerHTML, />2<\/strong><span>participantes/);
  assert.match(screenRoot.innerHTML, /<strong>1<\/strong> de 2 entregaron/);
  assert.doesNotMatch(screenRoot.innerHTML, /knowledge-screen-question|knowledge-options/);

  onState({
    available: true,
    executionId: "execution-assessment-render",
    category: "assessment",
    title: "Evaluación final",
    state: "RESULTS_VISIBLE",
    participantCount: 2,
    effectiveParticipantCount: 2,
    submittedCount: 2
  });
  assert.match(screenRoot.innerHTML, /knowledge-screen-assessment-finished/);
  assert.match(screenRoot.innerHTML, /Evaluación finalizada/);
  assert.match(screenRoot.innerHTML, /<strong>2<\/strong> entregas/);
});

test("Screen shows only the question and optional image, then centers only the correct answer", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /has-question-image/);
  assert.match(source, /state\.substate === "REVEAL"/);
  assert.match(source, /state\.reveal\.correctLabel/);
  assert.match(source, /knowledge-screen-correct-answer/);
  assert.doesNotMatch(source, /knowledge-screen-options/);
  assert.match(css, /\.knowledge-screen-question-image \{[\s\S]*?max-height: 58vh;/);
  assert.match(css, /\.knowledge-screen-reveal \{[\s\S]*?place-items: center;/);
  assert.match(css, /\.knowledge-screen-correct-answer strong \{[\s\S]*?font: 900 clamp\(48px, 8vw, 126px\)/);
});

test("lobby entrants are synchronized as people ready without counting as participants", () => {
  const source = read("public/shared/knowledge-activities.js");
  assert.match(source, /\["LOBBY", "COUNTDOWN"\]\.includes\(state\.state\)[\s\S]*state\.participantCount/);
  assert.match(source, /lobbyCount === 1 \? "persona lista" : "personas listas"/);
  assert.match(source, /count === 1 \? "persona lista" : "personas listas"/);
  assert.match(source, /state\.effectiveParticipantCount \|\| 0/);
});

test("Screen lobby uses activity identity, centered presence, and a balanced countdown", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /knowledge-screen-intro-state/);
  assert.match(source, /categoryIconMarkup\(state\.category, "knowledge-screen-activity-icon"\)/);
  assert.match(source, /knowledge-screen-presence/);
  assert.match(source, /knowledge-screen-countdown/);
  assert.match(css, /\.knowledge-screen-presence \{[\s\S]*?left: 50%;[\s\S]*?border-radius: 999px;/);
  assert.match(css, /\.knowledge-screen-countdown \{[\s\S]*?min-height: clamp\(190px, 19vw, 290px\);[\s\S]*?padding-block: clamp\(18px, 2\.4vw, 36px\);[\s\S]*?overflow: visible;/);
  assert.match(css, /\.knowledge-screen-intro-state \.knowledge-screen-countdown \.knowledge-countdown-value \{[\s\S]*?padding: \.12em \.08em \.18em;[\s\S]*?clamp\(88px, 12vw, 190px\)\/1\.15/);
  assert.match(css, /\.knowledge-screen-intro-state \.knowledge-screen-countdown \.knowledge-countdown-value\.is-starting \{[\s\S]*?clamp\(60px, 8vw, 128px\);[\s\S]*?line-height: 1\.15;/);
  assert.match(source, /node\.classList\?\.toggle\("is-starting", label === "¡Inicia!"\)/);
  assert.match(css, /\.interaction-panel \.knowledge-definition,[\s\S]*?min-height: 84px;[\s\S]*?padding: 20px;/);
});

test("Evaluations reuse the approved Immersa lobby and gain a dedicated Screen progress state", () => {
  const source = read("public/shared/knowledge-activities.js");
  const css = read("public/shared/knowledge-activities.css");
  assert.match(source, /\["contest", "assessment"\]\.includes\(state\.category\) && \["LOBBY", "COUNTDOWN"\]\.includes\(state\.state\)/);
  assert.match(source, /categoryIconMarkup\("assessment", "knowledge-screen-activity-icon"\)/);
  assert.match(source, /knowledge-screen-assessment-state/);
  assert.match(source, /knowledge-screen-assessment-progress/);
  assert.match(source, /knowledge-screen-assessment-timer/);
  assert.match(source, /Evaluación en curso/);
  assert.match(source, /Calculando resultados…/);
  assert.match(source, /Evaluación finalizada/);
  assert.match(css, /\.knowledge-screen-assessment-state \{[\s\S]*?min-height: 72vh;/);
  assert.match(css, /\.knowledge-screen-assessment-progress \{[\s\S]*?var\(--immersa-gradient/);
  assert.match(css, /\.knowledge-screen-assessment-timer \{[\s\S]*?clamp\(72px, 10vw, 150px\)/);
});

test("history exposes per-execution CSV without adding operational warnings", () => {
  const history = read("public/home/knowledge-activity-history.js");
  const exporter = read("knowledge-activity-export.js");
  assert.match(history, /knowledge-activities\/" \+ encodeURIComponent\(execution\.executionId\) \+ "\/export/);
  assert.doesNotMatch(exporter, /respuestas excluidas|error de procesamiento/i);
});
