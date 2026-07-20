const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("deck detail owns a collapsed Q&A history with protected export and deletion", async () => {
  const [html, home, history, styles, liveControls, server] = await Promise.all([
    fs.promises.readFile(path.join(root, "public", "home", "index.html"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "home", "home.js"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "home", "qna-history.js"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "home", "qna-history.css"), "utf8"),
    fs.promises.readFile(path.join(root, "public", "shared", "qna-controls.js"), "utf8"),
    fs.promises.readFile(path.join(root, "server.js"), "utf8")
  ]);

  assert.match(html, /id="qnaHistory"/);
  assert.equal((html.match(/Descargar CSV/g) || []).length, 1);
  assert.equal((html.match(/Borrar historial/g) || []).length, 1);
  assert.match(html, /id="qnaHistoryToggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="qnaHistoryBody"[^>]*hidden/);
  assert.match(html, /home\/qna-history\.css/);
  assert.match(html, /home\/qna-history\.js/);
  assert.match(home, /immersa:deck-detail-open/);
  assert.match(home, /immersa:deck-detail-close/);
  assert.match(history, /\/api\/decks\/\$\{encodeURIComponent\(deck\.deckId\)\}\/qna\/history/);
  assert.match(history, /body: JSON\.stringify\(\{ session_id: sessionId, role: "speaker" \}\)/);
  assert.match(history, /\/api\/qna\/export\/\$\{encodeURIComponent\(accessToken\)\}/);
  assert.match(history, /\/api\/qna\/history\/\$\{encodeURIComponent\(accessToken\)\}/);
  assert.match(history, /deleteButton\.hidden = false/);
  assert.match(history, /Borrar definitivamente/);
  assert.match(server, /app\.delete\("\/api\/qna\/history\/:access_token"/);
  assert.doesNotMatch(liveControls, /Descargar CSV|\/api\/qna\/export\//);
  assert.match(styles, /\.qna-history/);
  assert.match(styles, /\.qna-history-confirm/);
});
