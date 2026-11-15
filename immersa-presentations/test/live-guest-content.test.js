const test = require("node:test");
const assert = require("node:assert/strict");
const { guestPollResults, guestQuestion } = require("../live-guest-content");
const { create } = require("../public/live-guests/content");

test("guest poll snapshots contain aggregates only and follow operational English with Spanish fallback", () => {
  const results = { type: "poll", title: "Encuesta", prompt: "¿Sí?", totalResponses: 2,
    options: [{ id: "yes", label: "Sí", count: 2, percentage: 100 }],
    responses: [{ name: "private", audienceId: "secret" }],
    en: { prompt: "Yes?", options: { yes: "Yes" } } };
  assert.deepEqual(guestPollResults(results), { title: "Encuesta", prompt: "¿Sí?", totalResponses: 2,
    options: [{ label: "Sí", count: 2, percentage: 100 }] });
  assert.equal(guestPollResults(results, "en").options[0].label, "Yes");
  delete results.en.options.yes;
  assert.equal(guestPollResults(results, "en").prompt, "¿Sí?");
  assert.equal(guestPollResults(null), null);
  assert.equal(guestPollResults({ ...results, type: "trivia" }), null);
});

test("poll rendering treats text literally, clamps bars and clears without adding participant controls", () => {
  function node(tag) {
    return { tag, style: { setProperty() {} }, children: [], append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; }, remove() {} };
  }
  const resultsHost = node("section"), reactionsHost = node("div");
  const content = create({ document: { createElement: node }, resultsHost, reactionsHost });
  content.setResults({ title: '<script>alert(1)</script>', prompt: '<img onerror=alert(1)>', totalResponses: 3,
    options: [{ label: '<button>Click</button>', percentage: 300 }] });
  assert.equal(resultsHost.children[0].textContent, '<img onerror=alert(1)>');
  assert.equal(resultsHost.children.some(node => node.tag === "h2"), false);
  assert.equal(resultsHost.children[2].children[0].children[0].textContent, '<button>Click</button>');
  assert.equal(resultsHost.children[2].children[1].children[0].style.width, "100%");
  content.setResults(null);
  assert.equal(resultsHost.hidden, true);
  assert.equal(resultsHost.children.length, 0);
});

test("guest reactions are bounded, accept only supported emojis and clear on disconnect/end", () => {
  const nodes = [];
  const document = { createElement() { const node = { style: { setProperty() {} }, remove() { this.removed = true; } }; nodes.push(node); return node; } };
  const content = create({ document, resultsHost: { replaceChildren() {} }, reactionsHost: { append() {} } });
  content.react({ emoji: "unknown" });
  for (let i = 0; i < 40; i++) content.react({ emoji: "❤️" });
  assert.equal(nodes.length, 12);
  content.clear();
  assert.equal(nodes.every(node => node.removed), true);
  content.react({ emoji: "👏" });
  assert.equal(nodes.length, 13);
  content.clear();
});

test("question snapshots contain only the public text and consent-filtered name", () => {
  assert.equal(guestQuestion({ visible: false, question: { text: "Private" } }), null);
  assert.equal(guestQuestion({ visible: true, question: { text: "  " } }), null);
  assert.deepEqual(guestQuestion({ visible: true, question: {
    id: "internal", text: "¿Cómo?", name: "", email: "private@example.test", audienceId: "private"
  } }), { text: "¿Cómo?", name: "" });
});

test("a selected question replaces the slide and poll, preserves text safely and restores current content", () => {
  const classes = new Set();
  function node(tag) { return { tag, style: { setProperty() {} }, children: [], append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } }; }
  const resultsHost = node("section"), questionHost = node("section");
  const content = create({ document: { createElement: node }, resultsHost, questionHost, reactionsHost: node("div"),
    slideHost: { classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } } } });
  content.setResults({ prompt: "Poll", options: [] });
  assert.equal(resultsHost.hidden, false);
  content.setQuestion({ text: '<img onerror=alert(1)>', name: "Ana" });
  assert.equal(resultsHost.hidden, true);
  assert.equal(questionHost.hidden, false);
  assert.equal(questionHost.children[0].textContent, '<img onerror=alert(1)>');
  assert.equal(questionHost.children[1].textContent, "Ana");
  const original = questionHost.children[0];
  content.setResults({ prompt: "Updated poll", options: [] });
  content.setQuestion({ text: '<img onerror=alert(1)>', name: "Ana" });
  assert.equal(questionHost.children[0], original);
  content.setQuestion({ text: "Otra pregunta", name: "" });
  assert.equal(questionHost.children.length, 1);
  assert.equal(questionHost.children[0].textContent, "Otra pregunta");
  content.setQuestion(null);
  assert.equal(questionHost.hidden, true);
  assert.equal(resultsHost.hidden, false);
  assert.equal(resultsHost.children[0].textContent, "Updated poll");
  content.setResults(null);
  assert.equal(classes.has("has-public-content"), false);
  content.setQuestion({ text: "Final", name: "" });
  content.clear();
  assert.equal(questionHost.hidden, true);
  assert.equal(classes.has("has-public-content"), false);
});
