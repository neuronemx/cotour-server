const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
