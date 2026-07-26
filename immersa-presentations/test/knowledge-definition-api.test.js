const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createDeckInteractionHandlers } = require("../deck-interactions-api");

function definition(category) {
  return {
    id: `${category}-1`,
    title: category === "contest" ? "Concurso" : "Evaluación",
    identificationMode: "anonymous",
    questionDurationSeconds: 20,
    durationSeconds: 300,
    questions: [{
      id: "q1",
      prompt: "Pregunta",
      image: {
        url: "/decks/deck-a/knowledge-assets/question-aaaaaaaaaaaaaaaaaaaaaaaa.jpg",
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        sizeBytes: 120000
      },
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      correctOptionId: "a"
    }]
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test("deck configuration persists independent contest and assessment definitions", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-knowledge-definitions-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataDecksDir = path.join(root, "data");
  const staticDecksDir = path.join(root, "static");
  const deckDir = path.join(dataDecksDir, "deck-a");
  await fs.promises.mkdir(deckDir, { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({
    slides: [{ id: "slide-001", src: "slide-001.jpg" }]
  }));
  const handlers = createDeckInteractionHandlers({ dataDecksDir, staticDecksDir });
  const saved = response();
  await handlers.putInteractions({
    params: { deckId: "deck-a" },
    body: {
      interactions: [],
      contests: [definition("contest")],
      assessments: [definition("assessment")]
    }
  }, saved);
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.contests[0].category, "contest");
  assert.equal(saved.body.assessments[0].category, "assessment");
  assert.equal(saved.body.contests[0].questions[0].image.url, "/decks/deck-a/knowledge-assets/question-aaaaaaaaaaaaaaaaaaaaaaaa.jpg");
  assert.ok(saved.body.contests[0].createdAt);
  assert.ok(saved.body.contests[0].updatedAt);

  const originalCreatedAt = saved.body.contests[0].createdAt;
  const pollOnlySave = response();
  await handlers.putInteractions({
    params: { deckId: "deck-a" },
    body: { interactions: [] }
  }, pollOnlySave);
  assert.equal(pollOnlySave.body.contests.length, 1);
  assert.equal(pollOnlySave.body.assessments.length, 1);
  assert.equal(pollOnlySave.body.contests[0].createdAt, originalCreatedAt);
});

test("question image endpoints are mounted and constrained to deck assets", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "..", "deck-interactions-api.js"), "utf8");
  assert.match(server, /knowledge-questions\/:questionId\/image/);
  assert.match(api, /MAX_QUESTION_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(api, /knowledge-assets/);
  assert.match(api, /detectLogo\(req\.file\.buffer\)/);
  assert.match(api, /cleanupQuestionAssets/);
});

test("question image upload stores a validated deck asset and delete removes it", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-question-image-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataDecksDir = path.join(root, "data");
  const deckDir = path.join(dataDecksDir, "deck-a");
  await fs.promises.mkdir(deckDir, { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({ slides: [] }));

  const handlers = createDeckInteractionHandlers({
    dataDecksDir,
    staticDecksDir: path.join(root, "static")
  });
  const app = express();
  app.post("/api/decks/:deckId/knowledge-questions/:questionId/image", handlers.uploadQuestionImage);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = "http://127.0.0.1:" + server.address().port;

  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  const body = new FormData();
  body.append("image", new Blob([png], { type: "image/png" }), "question.png");
  const uploaded = await fetch(baseUrl + "/api/decks/deck-a/knowledge-questions/q1/image", {
    method: "POST",
    body
  });
  assert.equal(uploaded.status, 201);
  const payload = await uploaded.json();
  assert.match(payload.image.url, /^\/decks\/deck-a\/knowledge-assets\/question-[a-f0-9]{24}\.png$/);
  const storedPath = path.join(deckDir, payload.image.url.split("/").at(-2), payload.image.url.split("/").at(-1));
  assert.equal((await fs.promises.readFile(storedPath)).length, png.length);

  const saveWithImage = response();
  await handlers.putInteractions({
    params: { deckId: "deck-a" },
    body: {
      interactions: [],
      contests: [{
        ...definition("contest"),
        questions: [{ ...definition("contest").questions[0], image: payload.image }]
      }],
      assessments: []
    }
  }, saveWithImage);
  assert.equal(saveWithImage.statusCode, 200);
  await fs.promises.access(storedPath);

  const saveWithoutImage = response();
  const definitionWithoutImage = definition("contest");
  definitionWithoutImage.questions[0].image = null;
  await handlers.putInteractions({
    params: { deckId: "deck-a" },
    body: { interactions: [], contests: [definitionWithoutImage], assessments: [] }
  }, saveWithoutImage);
  assert.equal(saveWithoutImage.statusCode, 200);
  await assert.rejects(fs.promises.access(storedPath), { code: "ENOENT" });
});

test("invalid knowledge definitions return a stable client error", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-knowledge-invalid-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataDecksDir = path.join(root, "data");
  const deckDir = path.join(dataDecksDir, "deck-a");
  await fs.promises.mkdir(deckDir, { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({ slides: [] }));
  const handlers = createDeckInteractionHandlers({ dataDecksDir, staticDecksDir: path.join(root, "static") });
  const res = response();
  await handlers.putInteractions({
    params: { deckId: "deck-a" },
    body: {
      interactions: [],
      contests: [{
        id: "bad",
        title: "Bad",
        questions: [{ prompt: "Missing correct", options: [{ label: "A" }, { label: "B" }] }]
      }]
    }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /correct option/i);
});
