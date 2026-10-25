const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const settle = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
const eventId = '00000000-0000-4000-8000-000000000001', grantId = '00000000-0000-4000-8000-000000000002', activityId = '00000000-0000-4000-8000-000000000003';
function page() {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.handlers = {}; this.src = ''; this.children = []; this.checked = false; this.paused = true; this.loads = 0; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    load() { this.loads++; }
    addEventListener(n, f) { this.handlers[n] = f; }
    removeAttribute(name) { delete this[name]; }
    fire(n) { this.handlers[n]?.({ target: this }); }
  }
  const root = path.join(__dirname, '..'), html = fs.readFileSync(path.join(root, 'events-v2/rehearsal.html'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const document = { createElement: () => new Element(), handlers: {}, getElementById: id => elements[id], addEventListener(n, f) { this.handlers[n] = f; } };
  const window = { location: { origin: 'https://events.test', reload() {} }, history: { replaceState() {} }, handlers: {}, addEventListener(n, f) { this.handlers[n] = f; } };
  let state, callback, response = null;
  const client = { getState: () => state, start() { queueMicrotask(() => ready()); }, resume() { ready(); }, close() {} };
  const ready = () => { state = { status: 'ready', context: { purpose: 'rehearsal', activityId }, eventName: 'Own event' }; callback(state); };
  window.ImmersaEventAccess = { consumeLink: () => ({ binding: { view: 'rehearsal', eventId, grantId }, token: null }), createClient(options) { callback = options.onState; return client; } };
  const value = { mode: 'rehearsal', eventId, activityId, revision: 0, title: '<private title>', notes: '<private notes>',
    slideIndex: 0, slideCount: 2, language: 'es', englishEnabled: true, runId: '00000000-0000-4000-8000-000000000004',
    tools: { polls: { available: [], runId: null, active: null, responded: false, resultsVisible: false, results: null }, media: [], playlists: [] },
    image: { url: `/api/events-v2/rehearsal/${eventId}/${grantId}/slides/own-run`, width: 16, height: 9 } };
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return response ? response() : { ok: true, json: async () => structuredClone(value) }; };
  window.fetch = fetch;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/events-v2/rehearsal-tools.js'), 'utf8'), { window, URL, Promise, Set, Number, Error });
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
function media(p, type = 'video', id = 'selected') {
  const r = { id, name: '<Selected only>', type, duration: 10,
    url: `/api/events-v2/rehearsal/${eventId}/${grantId}/media/${p.value.runId}/${'a'.repeat(64)}/${id}` };
  p.value.tools.media.push(r); return r;
}
test('media stays local to the rehearsal browser, coexists with slides and stops immediately on lost access', async () => {
  const p = page(), r = media(p); await settle();
  p.elements['media-catalog'].children[0].fire('click'); await settle();
  assert.equal(p.elements['rehearsal-video'].src, 'https://events.test' + r.url); assert.equal(p.elements['rehearsal-video'].paused, false);
  assert.equal(p.calls.length, 1); p.elements.next.fire('click'); await settle();
  assert.equal(p.elements['rehearsal-video'].paused, false);
  p.state({ status: 'denied' }); assert.equal(p.elements['rehearsal-video'].src, undefined); assert.equal(p.elements['rehearsal-video'].paused, true);
  assert.equal(p.elements['poll-preview'].hidden, true);
});
test('foreign media and playlists outside the selected catalog fail closed', async () => {
  for (const bad of ['foreign', 'playlist']) {
    const p = page(), r = media(p);
    if (bad === 'foreign') r.url = 'https://other.example/asset.webm';
    else p.value.tools.playlists = [{ id: 'own-list', name: 'List', type: 'video', resourceIds: ['unselected'] }];
    await settle(); assert.equal(p.elements.rehearsal.hidden, true); assert.equal(p.elements['rehearsal-video'].src, undefined);
  }
});
test('private playlists advance, repeat and release the video on stop/reset', async () => {
  const p = page(); media(p, 'video', 'first'); media(p, 'video', 'second');
  p.value.tools.playlists = [{ id: 'own', name: 'Two videos', type: 'video', resourceIds: ['first', 'second'] }]; await settle();
  p.elements['media-loop'].checked = true;
  p.elements['media-catalog'].children[2].fire('click');
  p.elements['rehearsal-video'].fire('ended'); assert.ok(p.elements['rehearsal-video'].src.endsWith('/second'));
  p.elements['rehearsal-video'].fire('ended'); assert.ok(p.elements['rehearsal-video'].src.endsWith('/first'));
  p.elements['stop-video'].fire('click'); assert.equal(p.elements['rehearsal-video'].src, undefined);
  p.elements['media-catalog'].children[0].fire('click');
  p.value.runId = '00000000-0000-4000-8000-000000000005'; for (const r of p.value.tools.media) r.url = r.url.replace('00000000-0000-4000-8000-000000000004', p.value.runId);
  p.elements.reset.fire('click'); await settle(); assert.equal(p.elements['rehearsal-video'].src, undefined);
});
test('sample poll launch sends only the rehearsal run and options render as text in the selected language', async () => {
  const p = page(); p.value.tools.polls.available = [{ id: 'own', title: '<Own poll>' }]; await settle();
  assert.equal(p.elements['poll-catalog'].children[0].textContent, '<Own poll>');
  p.elements['poll-catalog'].children[0].fire('click'); await settle();
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), { action: 'poll', expectedRevision: 0, runId: p.value.runId, command: 'launch', interactionId: 'own' });
  const pollRunId = '00000000-0000-4000-8000-000000000006';
  p.value.tools.polls = { available: [{ id: 'own', title: 'Poll' }], runId: pollRunId, active: { id: 'own', title: 'Poll', prompt: '<Pregunta>',
    options: [{ id: 'a', label: 'Una' }, { id: 'b', label: 'Dos' }], en: { prompt: '<Question>', options: { a: '<One>' } } }, responded: false, resultsVisible: false, results: null };
  p.value.language = 'en'; p.ready(); await settle();
  const preview = p.elements['poll-preview']; assert.equal(preview.children[0].textContent, '<Question>');
  assert.equal(preview.children[1].children[0].textContent, '<One>'); assert.equal(preview.children[1].children[1].textContent, 'Dos');
  preview.children[1].children[0].fire('click'); await settle();
  assert.equal(JSON.parse(p.calls.at(-1).options.body).pollRunId, pollRunId);
});
