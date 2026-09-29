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
