const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const settle = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
const eventId = '00000000-0000-4000-8000-000000000001', grantId = '00000000-0000-4000-8000-000000000002', activityId = '00000000-0000-4000-8000-000000000003';
function page() {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.handlers = {}; this.src = ''; }
    addEventListener(n, f) { this.handlers[n] = f; }
    removeAttribute(name) { delete this[name]; }
    fire(n) { this.handlers[n]?.({ target: this }); }
  }
  const root = path.join(__dirname, '..'), html = fs.readFileSync(path.join(root, 'events-v2/rehearsal.html'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const document = { handlers: {}, getElementById: id => elements[id], addEventListener(n, f) { this.handlers[n] = f; } };
  const window = { location: { origin: 'https://events.test', reload() {} }, history: { replaceState() {} }, handlers: {}, addEventListener(n, f) { this.handlers[n] = f; } };
  let state, callback, response = null;
  const client = { getState: () => state, start() { queueMicrotask(() => ready()); }, resume() { ready(); }, close() {} };
  const ready = () => { state = { status: 'ready', context: { purpose: 'rehearsal', activityId }, eventName: 'Own event' }; callback(state); };
  window.ImmersaEventAccess = { consumeLink: () => ({ binding: { view: 'rehearsal', eventId, grantId }, token: null }), createClient(options) { callback = options.onState; return client; } };
  const value = { mode: 'rehearsal', eventId, activityId, revision: 0, title: '<private title>', notes: '<private notes>',
    slideIndex: 0, slideCount: 2, language: 'es', englishEnabled: true,
    image: { url: `/api/events-v2/rehearsal/${eventId}/${grantId}/slides/own-run`, width: 16, height: 9 } };
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return response ? response() : { ok: true, json: async () => structuredClone(value) }; };
  window.fetch = fetch;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/events-v2/rehearsal-page.js'), 'utf8'),
    { document, window, fetch, URL, AbortController, setTimeout, clearTimeout, queueMicrotask, Number, Error });
  return { elements, document, window, calls, value, ready,
    state(next) { state = next; callback(state); }, response(next) { response = next; } };
}
test('private rehearsal renders notes as plain text and sends only rehearsal navigation with revision', async () => {
  const p = page(); await settle(); assert.equal(p.elements.rehearsal.hidden, false);
  assert.equal(p.elements.notes.textContent, '<private notes>'); assert.equal(p.elements.title.textContent, '<private title>');
  assert.equal(p.elements.prev.disabled, true); assert.equal(p.elements.next.disabled, false);
  p.elements.next.fire('click'); await settle();
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), { action: 'next', expectedRevision: 0 });
  assert.ok(p.calls.every(x => !x.url.includes('/live/') && x.options.credentials === 'same-origin'));
});
test('lost access immediately removes private slides/notes and fences late HTTP results', async () => {
  const p = page(); await settle(); let finish;
  p.response(() => new Promise(r => { finish = r; })); p.elements.next.fire('click');
  p.state({ status: 'denied' }); assert.equal(p.elements.rehearsal.hidden, true); assert.equal(p.elements.slide.src, undefined); assert.equal(p.elements.notes.textContent, '');
  finish({ ok: true, json: async () => p.value }); await settle(); assert.equal(p.elements.rehearsal.hidden, true); assert.equal(p.elements.reset.hidden, true);
});
test('revision conflict hides stale preview and explicit reset uses the current server revision', async () => {
  const p = page(); await settle();
  p.response(async () => ({ ok: false, status: 409, json: async () => ({ code: 'REHEARSAL_REVISION_CONFLICT', currentRevision: 7 }) }));
  p.elements.next.fire('click'); await settle(); assert.equal(p.elements.rehearsal.hidden, true);
  p.response(null); p.elements.reset.fire('click'); await settle();
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), { action: 'reset', expectedRevision: 7 });
});
test('a foreign image destination cannot render private content', async () => {
  const p = page(); p.value.image.url = 'https://other.example/private.jpg'; await settle(); assert.equal(p.elements.rehearsal.hidden, true); assert.equal(p.elements.notes.textContent, '');
});
