const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Apuntador requires an uploaded English deck and responds to upload/deletion without changing decks', async () => {
  const events = {}, elements = {};
  const element = (id) => elements[id] ||= { value: '', textContent: '', hidden: true, addEventListener() {}, setAttribute() {}, focus() {} };
  const context = { document: { getElementById: element, addEventListener: (name, handler) => { events[name] = handler; } }, fetch: async () => ({ ok: true, json: async () => ({ prompter: {} }) }) };
  vm.runInNewContext(fs.readFileSync('public/home/prompter-editor.js', 'utf8'), context);
  const deck = { deckId: 'es-only', locales: {} };
  events['immersa:deck-detail-open']({ detail: { deck, capabilities: { 'multilanguage.manage': true } } });
  assert.equal(element('prompterModalEnglishField').hidden, true);
  await events['immersa:deck-prompter-slide-request']({ detail: { deck, slideId: 's1', slideIndex: 0 } });
  assert.equal(element('prompterModalEnglishField').hidden, true);
  events['immersa:deck-locale-updated']({ detail: { deckId: 'other', variant: { slides: 10 } } });
  assert.equal(element('prompterModalEnglishField').hidden, true);
  events['immersa:deck-locale-updated']({ detail: { deckId: deck.deckId, variant: { slides: 10, active: false } } });
  assert.equal(element('prompterModalEnglishField').hidden, false);
  events['immersa:deck-locale-updated']({ detail: { deckId: deck.deckId, variant: null } });
  assert.equal(element('prompterModalEnglishField').hidden, true);
  events['immersa:deck-detail-open']({ detail: { deck: { locales: { en: { slides: 10 } } }, capabilities: {} } });
  assert.equal(element('prompterModalEnglishField').hidden, true);
});
