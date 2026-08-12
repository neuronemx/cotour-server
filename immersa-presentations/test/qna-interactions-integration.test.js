const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Preguntas remains an independent measurement category with an outline icon", () => {
  const source = fs.readFileSync(path.join(root, "public", "shared", "interactions-shell.js"), "utf8");
  const order = [...source.matchAll(/\{ id: "(polls|raffles|contests|qna|games)", label: "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(order, [
    ["polls", "Encuestas"],
    ["qna", "Preguntas"],
    ["raffles", "Sorteos"],
    ["contests", "Trivias"],
    ["games", "Juegos"]
  ]);
  assert.match(source, /id: "assessments", label: "Evaluaciones"/);
  assert.match(source, /qna: \{\s+viewBox: "0 0 24 24"/);
  assert.match(source, /stroke", "currentColor"/);
  assert.match(source, /setCategoryVisible/);
});
