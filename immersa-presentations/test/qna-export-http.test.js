const assert = require("node:assert/strict");
const test = require("node:test");
const { QnaError } = require("../db/qna-repository");
const { createQnaExportHandler, safeFilenamePart } = require("../qna-export");

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    contentType: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("Q&A CSV download uses the authorized access context and safe attachment headers", async () => {
  const calls = [];
  const handler = createQnaExportHandler({
    runtime: {
      enabled: true,
      async exportCsv(payload) {
        calls.push(payload);
        return {
          csv: "\uFEFF\"Respondida\"\r\n\"Sí\"\r\n",
          deckId: "Deck número 1",
          presentationSessionId: "session/one"
        };
      }
    }
  });
  const req = {
    immersaAccess: {
      accessLink: { session_id: "source-session-1", role: "speaker" },
      deck: { deckId: "deck-a" }
    }
  };
  const res = response();
  await handler(req, res);
  assert.deepEqual(calls, [{ deckId: "deck-a", sourceSessionId: "source-session-1" }]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["Content-Disposition"], 'attachment; filename="immersa-qna-Deck-numero-1-session-one.csv"');
  assert.equal(res.contentType, "text/csv; charset=utf-8");
  assert.match(res.body, /^\uFEFF/);
});

test("Q&A CSV endpoint stays unavailable without feature flag or controller access", async () => {
  const disabled = createQnaExportHandler({ runtime: { enabled: false, exportCsv: null } });
  const disabledResponse = response();
  await disabled({}, disabledResponse);
  assert.equal(disabledResponse.statusCode, 404);

  const enabled = createQnaExportHandler({ runtime: { enabled: true, async exportCsv() {} } });
  const forbiddenResponse = response();
  await enabled({}, forbiddenResponse);
  assert.equal(forbiddenResponse.statusCode, 403);
});

test("missing active execution returns 404 without exposing database details", async () => {
  const handler = createQnaExportHandler({
    runtime: {
      enabled: true,
      async exportCsv() {
        throw new QnaError("QNA_SESSION_NOT_FOUND", "internal detail");
      }
    }
  });
  const res = response();
  await handler({
    immersaAccess: {
      accessLink: { session_id: "source-session-1" },
      deck: { deckId: "deck-a" }
    }
  }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Q&A session not found" });
});

test("CSV filenames are restricted to portable characters", () => {
  assert.equal(safeFilenamePart("../../Mi presentación.csv"), "Mi-presentacion-csv");
});
