const assert = require("node:assert/strict");
const test = require("node:test");
const { createQnaHistoryHandlers, safeFilenamePart } = require("../qna-export");

function response() {
  return {
    headers: {}, statusCode: 200, body: null, contentType: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("deck history lists every historical Q&A execution", async () => {
  const calls = [];
  const handlers = createQnaHistoryHandlers({ runtime: {
    enabled: true,
    async listHistory(payload) { calls.push(payload); return [{ presentationSessionId: "session-1" }]; }
  }});
  const res = response();
  await handlers.listHistory({ params: { deckId: "deck-a" } }, res);
  assert.deepEqual(calls, [{ deckId: "deck-a" }]);
  assert.deepEqual(res.body, { deckId: "deck-a", sessions: [{ presentationSessionId: "session-1" }] });
});

test("deck history provides one CSV for every deck execution", async () => {
  const calls = [];
  const handlers = createQnaHistoryHandlers({ runtime: {
    enabled: true,
    async exportDeckCsv(payload) {
      calls.push(payload);
      return { csv: "\uFEFF\"Respondida\"\r\n\"Sí\"\r\n", deckId: "Deck número 1", questionCount: 1 };
    }
  }});
  const res = response();
  await handlers.exportDeck({ immersaAccess: {
    accessLink: { role: "speaker" },
    deck: { deckId: "deck-a" }
  } }, res);
  assert.deepEqual(calls, [{ deckId: "deck-a" }]);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["Content-Disposition"], 'attachment; filename="immersa-qna-Deck-numero-1.csv"');
  assert.equal(res.contentType, "text/csv; charset=utf-8");
  assert.match(res.body, /^\uFEFF/);
});

test("protected history deletion clears the authorized deck", async () => {
  const calls = [];
  const handlers = createQnaHistoryHandlers({ runtime: {
    enabled: true,
    async clearHistory(payload) {
      calls.push(payload);
      return { deckId: payload.deckId, deletedSessionCount: 2, deletedQuestionCount: 7 };
    }
  }});
  const res = response();
  await handlers.clearHistory({ immersaAccess: {
    accessLink: { role: "speaker" },
    deck: { deckId: "deck-a" }
  } }, res);
  assert.deepEqual(calls, [{ deckId: "deck-a" }]);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(res.body, { ok: true, deckId: "deck-a", deletedSessionCount: 2, deletedQuestionCount: 7 });
});

test("Q&A history stays unavailable while the feature flag is disabled", async () => {
  const handlers = createQnaHistoryHandlers({ runtime: { enabled: false, listHistory: null, exportDeckCsv: null, clearHistory: null } });
  const historyResponse = response();
  const exportResponse = response();
  const deleteResponse = response();
  await handlers.listHistory({ params: { deckId: "deck-a" } }, historyResponse);
  await handlers.exportDeck({ params: { deckId: "deck-a" } }, exportResponse);
  await handlers.clearHistory({ params: { deckId: "deck-a" } }, deleteResponse);
  assert.equal(historyResponse.statusCode, 404);
  assert.equal(exportResponse.statusCode, 404);
  assert.equal(deleteResponse.statusCode, 404);
});

test("CSV filenames are restricted to portable characters", () => {
  assert.equal(safeFilenamePart("../../Mi presentación.csv"), "Mi-presentacion-csv");
});
