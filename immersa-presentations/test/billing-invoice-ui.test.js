const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Home exposes manual CFDI request without requiring a tax certificate upload", () => {
  const html = read("public/home/index.html");
  const script = read("public/home/billing.js");
  const form = html.slice(html.indexOf('id="billingInvoiceForm"'), html.indexOf("</form>", html.indexOf('id="billingInvoiceForm"')));
  assert.match(form, /RFC/);
  assert.match(form, /razón social/);
  assert.match(form, /Código postal fiscal/);
  assert.match(form, /Régimen fiscal/);
  assert.match(form, /Uso de CFDI/);
  assert.doesNotMatch(form, /type="file"|Constancia.*input/i);
  assert.match(form, /día 3 del mes siguiente/);
  assert.match(script, /\/api\/billing\/invoices/);
  assert.match(script, /\/api\/billing\/invoice-requests/);
  assert.match(script, /Solicitud extemporánea/);
  assert.doesNotThrow(() => new Function(script));
});

test("account administration exposes the minimal manual CFDI queue", () => {
  const html = read("public/admin/accounts.html");
  const script = read("public/admin/accounts.js");
  assert.match(html, /Solicitudes de factura/);
  assert.match(html, /Pendiente/);
  assert.match(html, /En proceso/);
  assert.match(html, /Requiere corrección/);
  assert.match(html, /Enviada/);
  assert.match(script, /amount_total/);
  assert.match(script, /cfdiUuid/);
  assert.match(script, /adminNote/);
  assert.doesNotThrow(() => new Function(script));
});


test("paid plan cards open a controlled Stripe change flow instead of a generic portal", () => {
  const script = read("public/home/billing.js");
  assert.match(script, /fetch\("\/api\/billing\/change"/);
  assert.match(script, /changePlan\(plan, button\)/);
  assert.match(script, /timing === "period_end"/);
  assert.match(script, /timing === "scheduled_exists"/);
  assert.match(script, /closePlanChangeConfirmation\(\);\s*await load\(\);/);
  assert.doesNotMatch(script, /await loadStatus\(\)/);
  assert.match(script, /"change-return"/);
});
