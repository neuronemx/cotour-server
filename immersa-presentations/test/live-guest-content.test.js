const test = require("node:test");
const assert = require("node:assert/strict");
const { guestPollResults } = require("../live-guest-content");
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
  assert.equal(resultsHost.children[0].textContent, '<script>alert(1)</script>');
  assert.equal(resultsHost.children[3].children[0].children[0].textContent, '<button>Click</button>');
  assert.equal(resultsHost.children[3].children[1].children[0].style.width, "100%");
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
