const { CAPABILITIES, canUseFeature } = require('./auth/plan-features');

function englishReady(access, manifest) {
  return canUseFeature(access, CAPABILITIES.MULTILANGUAGE_MANAGE)
    && manifest?.locales?.en?.active === true
    && Number(manifest.locales.en.slides) === manifest.slides?.length
    && manifest.slides.length > 0;
}

function resolveOperationalLocale(requested, access, manifest) {
  return requested === 'en' && englishReady(access, manifest) ? 'en' : 'es';
}

function validateOperationalLocale(requested, access, manifest) {
  if (requested !== 'es' && requested !== 'en') return { ok: false, code: 'INVALID_LOCALE' };
  if (requested === 'es') return { ok: true, locale: 'es' };
  if (!canUseFeature(access, CAPABILITIES.MULTILANGUAGE_MANAGE)) return { ok: false, code: 'PLAN_FEATURE_LOCKED' };
  if (!englishReady(access, manifest)) return { ok: false, code: 'LOCALE_NOT_READY' };
  return { ok: true, locale: 'en' };
}

module.exports = { englishReady, resolveOperationalLocale, validateOperationalLocale };
