const test = require('node:test');
const assert = require('node:assert/strict');
const { featureAccessForPlan } = require('../auth/plan-features');
const { resolveOperationalLocale, validateOperationalLocale } = require('../deck-locale-runtime');

const manifest = { slides: [{ id: 'one' }, { id: 'two' }], locales: { en: { active: true, slides: 2 } } };

test('one operational locale follows the paid plan and active 1:1 variant', () => {
  const free = featureAccessForPlan('FREE');
  const speaker = featureAccessForPlan('SPEAKER');
  const pro = featureAccessForPlan('SPEAKER_PRO');
  assert.deepEqual(validateOperationalLocale('en', free, manifest), { ok: false, code: 'PLAN_FEATURE_LOCKED' });
  for (const paid of [speaker, pro]) {
    assert.deepEqual(validateOperationalLocale('en', paid, manifest), { ok: true, locale: 'en' });
    assert.equal(resolveOperationalLocale('en', paid, manifest), 'en');
  }
  assert.equal(resolveOperationalLocale('en', free, manifest), 'es');
  assert.equal(resolveOperationalLocale('en', speaker, { ...manifest, locales: { en: { active: false, slides: 2 } } }), 'es');
  assert.deepEqual(validateOperationalLocale('en', speaker, { ...manifest, locales: { en: { active: true, slides: 1 } } }), { ok: false, code: 'LOCALE_NOT_READY' });
  assert.deepEqual(validateOperationalLocale('es', free), { ok: true, locale: 'es' });
});
