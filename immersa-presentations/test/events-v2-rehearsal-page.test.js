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
    tools: { qna: { roundId: null, roundNumber: 0, questionsOpen: false, questions: [], selectedQuestionId: null, screen: { visible: false, question: null }, cooldownRemainingMs: 0, maxQuestions: 20 }, polls: { available: [], runId: null, active: null, responded: false, resultsVisible: false, results: null }, media: [], playlists: [] },
    image: { url: `/api/events-v2/rehearsal/${eventId}/${grantId}/slides/own-run`, width: 16, height: 9 } };
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return response ? response() : { ok: true, json: async () => structuredClone(value) }; };
  window.fetch = fetch;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/events-v2/rehearsal-tools.js'), 'utf8'), { window, URL, Promise, Set, Number, Error });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/events-v2/rehearsal-qna.js'), 'utf8'), { window, Date, Set, Number, Error, setTimeout, clearTimeout });
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
function qnaValue() {
  return { roundId: '00000000-0000-4000-8000-000000000007', roundNumber: 1, questionsOpen: true, questions: [],
    selectedQuestionId: null, screen: { visible: false, question: null }, cooldownRemainingMs: 0, maxQuestions: 20 };
}
const sampleQuestion = () => ({ id: '00000000-0000-4000-8000-000000000008', text: '<Private sample>', name: '<Hidden name>',
  allowNameOnScreen: false, status: 'new', answered: false, createdAt: Date.now() });
test('Q&A sends only private commands, clears an accepted draft and projects text without an unapproved name', async () => {
  const p = page(); await settle();
  p.response(async () => { p.value.tools.qna = qnaValue(); p.value.revision = 1; return { ok: true, json: async () => structuredClone(p.value) }; });
  p.elements['qna-open'].fire('click'); await settle();
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), { action: 'qna', expectedRevision: 0, runId: p.value.runId, command: 'open' });
  p.elements['qna-question'].value = ' <Private sample> '; p.elements['qna-name'].value = '<Hidden name>';
  p.response(async () => { p.value.tools.qna.questions = [sampleQuestion()]; p.value.tools.qna.cooldownRemainingMs = 10000; p.value.revision = 2; return { ok: true, json: async () => structuredClone(p.value) }; });
  p.elements['qna-submit'].fire('click'); await settle();
  assert.deepEqual(JSON.parse(p.calls.at(-1).options.body), { action: 'qna', expectedRevision: 1, runId: p.value.runId, roundId: p.value.tools.qna.roundId,
    command: 'submit', question: '<Private sample>', name: '<Hidden name>', allowNameOnScreen: false });
  assert.equal(p.elements['qna-question'].value, ''); assert.equal(p.elements['qna-name'].value, ''); assert.equal(p.elements['qna-submit'].disabled, true);
  const card = p.elements['qna-list'].children[0]; assert.equal(card.children[0].textContent, '<Private sample>');
  p.response(async () => { const q = p.value.tools.qna.questions[0]; q.answered = true; q.status = 'selected'; p.value.tools.qna.selectedQuestionId = q.id;
    p.value.tools.qna.screen = { visible: true, question: { id: q.id, text: q.text, name: '' } }; return { ok: true, json: async () => structuredClone(p.value) }; });
  card.children[3].fire('click'); await settle();
  assert.equal(p.elements['qna-preview'].hidden, false); assert.equal(p.elements['qna-preview'].children[0].textContent, '<Private sample>');
  assert.equal(p.elements['qna-preview'].children[1].textContent, ''); assert.equal(p.elements['qna-list'].children[0].children[4].disabled, true);
});
test('Q&A rejects an invalid local draft without sending it and hides a response that leaks the sample name', async () => {
  const p = page(); p.value.tools.qna = qnaValue(); await settle();
  const count = p.calls.length; p.elements['qna-question'].value = '   '; p.elements['qna-submit'].fire('click'); await settle();
  assert.equal(p.calls.length, count); assert.match(p.elements['qna-status'].textContent, /1000/);
  const q = sampleQuestion(); q.answered = true; p.value.tools.qna.questions = [q];
  p.value.tools.qna.screen = { visible: true, question: { id: q.id, text: q.text, name: q.name } };
  p.ready(); await settle(); assert.equal(p.elements.rehearsal.hidden, true); assert.equal(p.elements['qna-preview'].hidden, true);
});
test('lost access erases Q&A questions and drafts, including a late successful submission', async () => {
  const p = page(); p.value.tools.qna = qnaValue(); await settle(); let finish;
  p.elements['qna-question'].value = 'Late sample'; p.elements['qna-name'].value = 'Private draft';
  p.response(() => new Promise(resolve => { finish = resolve; })); p.elements['qna-submit'].fire('click');
  p.state({ status: 'denied' }); assert.equal(p.elements['qna-question'].value, ''); assert.equal(p.elements['qna-name'].value, '');
  finish({ ok: true, json: async () => p.value }); await settle();
  assert.equal(p.elements['qna-tools'].hidden, true); assert.equal(p.elements['qna-preview'].hidden, true); assert.equal(p.elements['qna-list'].children.length, 0);
});
test('new rounds remove the old projection and reset also clears an unsent Q&A draft', async () => {
  const p = page(); const q = sampleQuestion(); q.answered = true;
  p.value.tools.qna = { ...qnaValue(), questions: [q], screen: { visible: true, question: { id: q.id, text: q.text, name: '' } } }; await settle();
  p.response(async () => { p.value.tools.qna = { ...qnaValue(), roundId: '00000000-0000-4000-8000-000000000009', roundNumber: 2 }; return { ok: true, json: async () => structuredClone(p.value) }; });
  p.elements['qna-round'].fire('click'); await settle(); assert.equal(p.elements['qna-preview'].hidden, true);
  assert.equal(p.elements['qna-list'].children[0].textContent, 'No hay preguntas de prueba en esta ronda.');
  p.elements['qna-question'].value = 'Unsent'; p.elements['qna-name'].value = 'Unsent name';
  p.response(async () => { p.value.runId = '00000000-0000-4000-8000-000000000010'; p.value.tools.qna = { ...qnaValue(), roundId: null, roundNumber: 0, questionsOpen: false }; return { ok: true, json: async () => structuredClone(p.value) }; });
  p.elements.reset.fire('click'); await settle(); assert.equal(p.elements['qna-question'].value, ''); assert.equal(p.elements['qna-name'].value, '');
});
