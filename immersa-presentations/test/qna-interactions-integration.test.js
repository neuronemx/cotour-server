const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Preguntas is the fourth interaction category with an outline icon", () => {
  const source = fs.readFileSync(path.join(root, "public", "shared", "interactions-shell.js"), "utf8");
  const order = [...source.matchAll(/\{ id: "(polls|raffles|contests|qna|games)", label: "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(order, [
    ["polls", "Encuestas"],
    ["raffles", "Sorteos"],
    ["contests", "Concursos"],
    ["qna", "Preguntas"],
    ["games", "Juegos"]
  ]);
  assert.match(source, /qna: \{ viewBox: "0 0 24 24"/);
  assert.match(source, /stroke", "currentColor"/);
  assert.match(source, /setCategoryVisible/);
});
