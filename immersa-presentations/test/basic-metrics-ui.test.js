const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Deck metrics renders Speaker session summaries and poll details", () => {
  const html = read("public/home/index.html");
  const source = read("public/home/basic-metrics.js");
  const styles = read("public/home/basic-metrics.css");

  assert.match(html, /id="basicMetrics"/);
  assert.match(html, /id="basicMetricsRefresh"[^>]*>Actualizar/);
  assert.match(html, /basic-metrics\.css\?v=1/);
  assert.match(html, /basic-metrics\.js\?v=1/);
  assert.match(source, /\/api\/decks\/\$\{encodeURIComponent\(activeDeck\.deckId\)\}\/metrics\/basic/);
  assert.match(source, /capabilities\?\.\["metrics\.basic"\] === true/);
  assert.match(source, /Inicia manualmente desde Backstage/);
  assert.match(source, /conecta al menos 5 personas de Público/);
  assert.match(source, /metric\("Tiempo"/);
  assert.match(source, /metric\("Asistencia"/);
  assert.match(source, /metric\("Actividad"/);
  assert.match(source, /percentage/);
  assert.match(styles, /\.basic-metrics-session/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

test("detailed histories remain a Speaker Pro capability", () => {
  const home = read("public/home/home.js");
  const qna = read("public/home/qna-history.js");
  const knowledge = read("public/home/knowledge-activity-history.js");

  assert.match(home, /capabilities: planUsage\?\.capabilities/);
  assert.match(qna, /capabilities\?\.\["metrics\.export"\] === true/);
  assert.match(knowledge, /capabilities\?\.\["metrics\.export"\] === true/);
});
