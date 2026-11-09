const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Apuntador requires an uploaded English deck and responds to upload/deletion without changing decks', async () => {
  const events = {}, elements = {};
  const element = (id) => elements[id] ||= { value: '', textContent: '', hidden: true, addEventListener() {}, setAttribute() {}, focus() {} };
  const context = { window: { addEventListener() {}, removeEventListener() {} }, document: { getElementById: element, addEventListener: (name, handler) => { events[name] = handler; } }, fetch: async () => ({ ok: true, json: async () => ({ prompter: {} }) }) };
  vm.runInNewContext(fs.readFileSync('public/home/prompter-editor.js', 'utf8'), context);
  const deck = { deckId: 'es-only', locales: {} };
  events['immersa:deck-detail-open']({ detail: { deck, capabilities: { 'multilanguage.manage': true } } });
  assert.equal(element('deckPrompterEnglishField').hidden, true);
  await events['immersa:deck-prompter-slide-request']({ detail: { deck, slideId: 's1', slideIndex: 0 } });
  assert.equal(element('deckPrompterEnglishField').hidden, true);
  events['immersa:deck-locale-updated']({ detail: { deckId: 'other', variant: { slides: 10 } } });
  assert.equal(element('deckPrompterEnglishField').hidden, true);
  events['immersa:deck-locale-updated']({ detail: { deckId: deck.deckId, variant: { slides: 10, active: false } } });
  assert.equal(element('deckPrompterEnglishField').hidden, false);
  events['immersa:deck-locale-updated']({ detail: { deckId: deck.deckId, variant: null } });
  assert.equal(element('deckPrompterEnglishField').hidden, true);
  events['immersa:deck-detail-open']({ detail: { deck: { locales: { en: { slides: 10 } } }, capabilities: {} } });
  assert.equal(element('deckPrompterEnglishField').hidden, true);
});

test('Apuntador protects drafts across slide changes and stops prompting after saving', async () => {
  const events = new Map();
  const browserEvents = new Map();
  const elements = new Map();
  let confirmExit = false;
  let notes = { first: 'Guion original', second: 'Otro guion' };
  const element = id => {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, {
        value: '', hidden: true, addEventListener: (name, handler) => handlers.set(name, handler),
        fire: name => handlers.get(name)(), setAttribute() {}, focus() {}
      });
    }
    return elements.get(id);
  };
  vm.runInNewContext(fs.readFileSync('public/home/prompter-editor.js', 'utf8'), {
    window: {
      confirm: () => confirmExit,
      addEventListener: (name, handler) => browserEvents.set(name, handler),
      removeEventListener: name => browserEvents.delete(name)
    },
    document: {
      getElementById: element,
      addEventListener: (name, handler) => events.set(name, handler)
    },
    fetch: async (_url, request) => {
      if (request.method === 'PUT') notes = JSON.parse(request.body).prompter;
      return { ok: true, json: async () => ({ prompter: { ...notes } }) };
    }
  });

  const deck = { deckId: 'deck-a' };
  const dispatch = (name, detail) => events.get(name)({ detail });
  const attemptExit = () => {
    let cancelled = false;
    events.get('immersa:deck-detail-before-close')({ preventDefault: () => { cancelled = true; } });
    return !cancelled;
  };
  dispatch('immersa:deck-detail-open', { deck });
  await dispatch('immersa:deck-prompter-slide-request', { deck, slideId: 'first', slideIndex: 0 });
  const field = element('deckPrompterText');
  field.value = 'Borrador';
  field.fire('input');
  dispatch('immersa:deck-prompter-slide-change', { deck, slideId: 'second', slideIndex: 1 });
  assert.equal(attemptExit(), false);
  assert.ok(browserEvents.has('beforeunload'));
  confirmExit = true;
  assert.equal(attemptExit(), true);

  dispatch('immersa:deck-detail-open', { deck: { ...deck, title: 'Renombrado' } });
  dispatch('immersa:deck-prompter-slide-change', { deck, slideId: 'first', slideIndex: 0 });
  assert.equal(field.value, 'Borrador');
  await element('deckPrompterSave').fire('click');
  assert.equal(notes.first, 'Borrador');
  assert.equal(notes.second, 'Otro guion');
  assert.equal(browserEvents.has('beforeunload'), false);
  confirmExit = false;
  assert.equal(attemptExit(), true);
});
