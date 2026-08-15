const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("role clients consume the unified presentation close event", () => {
  const runtime = read("public/shared/presentation-completion.js");
  assert.match(runtime, /presentation:closed/);
  assert.match(runtime, /presenter: "\/presentacion-completada"/);
  assert.match(runtime, /audience: "\/gracias-por-participar"/);
  assert.match(runtime, /screen: "\/presentacion-finalizada"/);
  for (const file of ["public/presenter/index.html", "public/audience/index.html", "public/screen/index.html"]) {
    assert.match(read(file), /presentation-completion\.js\?v=1/);
  }
});

test("Speaker completion shows the promised basic summary and Metrics CTA", () => {
  const speaker = read("public/completion/speaker.html");
  assert.match(speaker, /Tiempo en vivo/);
  assert.match(speaker, /Asistencia/);
  assert.match(speaker, /Actividad general/);
  assert.match(speaker, /data-metrics-link/);
  assert.match(speaker, /SPEAKER PRO/);
  assert.match(speaker, /Logo-Immersa\.png\?v=2/);
  assert.doesNotMatch(speaker, /brand-mark/);
  assert.match(read("public/home/home.js"), /requestedTab === "metrics"/);
});

test("Público completion invites registration and signup opens create mode", () => {
  assert.match(read("public/completion/audience.html"), /\/auth\?mode=signup/);
  assert.match(read("public/auth/auth.js"), /mode"\) === "signup"\) setCreateMode\(true\)/);
});

test("server exposes distinct completion landings and inactivity uses unified closure", () => {
  const server = read("server.js");
  assert.match(server, /\/presentacion-completada/);
  assert.match(server, /\/gracias-por-participar/);
  assert.match(server, /\/presentacion-finalizada/);
  assert.match(server, /finishInactive\(context\)/);
  assert.match(server, /emitClosed\(context, await presentationCompletionFor/);
});
