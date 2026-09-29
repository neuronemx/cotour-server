const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Spanish and English interface dictionaries have identical semantic keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/shared/i18n.js'), 'utf8');
  const window = { document: { querySelectorAll: () => [], documentElement: { setAttribute() {} } } };
  vm.runInNewContext(source, { window });
  const { messages, setLocale, t } = window.ImmersaI18n;
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.es).sort());
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('audience.qna.open'), 'Ask a question');
  assert.equal(setLocale('fr'), 'es');
  assert.equal(t('audience.qna.open'), 'Enviar pregunta');
});

test('operational roles load translations and apply locale changes to live labels', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  for (const role of ['presenter', 'screen', 'stage']) {
    const html = read(`${role}/index.html`);
    const runtime = read(`${role}/${role}.js`);
    assert.match(html, /shared\/i18n\.js\?v=2/);
    assert.match(runtime, /ImmersaI18n\?\.setLocale\(operationalLocale\)/);
  }
  const label = { dataset: { i18n: 'live.actions' }, textContent: '' };
  const title = { dataset: { i18nTitle: 'live.locale' }, title: '' };
  const window = { document: {
    querySelectorAll(selector) { return selector === '[data-i18n]' ? [label] : selector === '[data-i18n-title]' ? [title] : []; },
    documentElement: { setAttribute() {} }
  } };
  vm.runInNewContext(read('shared/i18n.js'), { window });
  window.ImmersaI18n.setLocale('en');
  assert.equal(label.textContent, 'Actions');
  assert.equal(title.title, 'Speaker and Screen language');
});

test('raffle generated views follow the audience and Screen locale', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  const window = {};
  vm.runInNewContext(read('shared/i18n.js'), { window });
  vm.runInNewContext(read('shared/raffle-public-ui.js'), { window });
  const active = { mode: 'free', state: 'collecting' };
  assert.match(window.ImmersaRafflePublicUI.renderAudienceRaffle({ active }), /Ingresa tu nombre y participa/);
  window.ImmersaI18n.setLocale('en');
  assert.match(window.ImmersaRafflePublicUI.renderAudienceRaffle({ active }), /Enter your name to participate/);
  assert.match(window.ImmersaRafflePublicUI.renderScreenRaffle({ active }), /Tap Join on your phone/);
});

test('Speaker activity controls render one English live session', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  const listeners = new Map();
  const window = { setInterval() {}, clearInterval() {} };
  const context = { window, fetch: async () => ({ ok: true, json: async () => ({ contests: [], assessments: [] }) }) };
  vm.runInNewContext(read('shared/i18n.js'), context);
  vm.runInNewContext(read('shared/knowledge-activities.js'), context);
  const root = { innerHTML: '', querySelectorAll() { return []; } };
  const controller = window.ImmersaKnowledgeActivities.createController({
    socket: { connected: true, on(event, handler) { listeners.set(event, handler); }, emit() {} },
    deckId: 'deck-1', role: 'presenter'
  });
  controller.mountHost({ root, category: 'contest' });
  window.ImmersaI18n.setLocale('en');
  listeners.get('interaction:execution:state')({
    available: true, executionId: 'run-1', category: 'contest', state: 'LOBBY',
    title: 'Título español', titleEn: 'English title', participantCount: 1
  });
  assert.match(root.innerHTML, /English title/);
  assert.match(root.innerHTML, /person ready/);
  assert.match(root.innerHTML, /data-knowledge-command="start"[^>]*>Start<\/button>/);
  assert.doesNotMatch(root.innerHTML, /Título español/);
  controller.destroy();
});
