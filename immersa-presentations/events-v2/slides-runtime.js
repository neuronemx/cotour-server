const crypto = require('node:crypto');
const { executionKey } = require('./live-runtime');
const { EventAccessError } = require('./authorization');
const fail = code => { throw new EventAccessError(code, 403); };
const token = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(v);
const control = c => ['STAGE', 'SPEAKER'].includes(c.kind);
const languages = ['es', 'en'];

// Phase2 supplies immutable event-owned preparations and verified openers.
// This adapter never reads public/personal deck manifests or storage paths.
function normalizeSlides(catalog, slideCount) {
  if (!catalog || typeof catalog.englishEnabled !== 'boolean' || !languages.includes(catalog.presenterLanguage)
    || (!catalog.englishEnabled && catalog.presenterLanguage !== 'es') || !Array.isArray(catalog.slides)
    || catalog.slides.length !== slideCount || slideCount < 1 || slideCount > 100000) fail('SLIDES_CONTENT_NOT_PREPARED');
  const assets = new Map();
  function resource(r) {
    const fields = ['assetId', 'size', 'sha256', 'contentType', 'width', 'height'];
    if (!r || Object.keys(r).length !== fields.length || fields.some(k => !Object.hasOwn(r, k)) || !token(r.assetId)
      || !Number.isSafeInteger(r.size) || r.size < 1 || r.size > 100 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(r.sha256 || '')
      || !['image/jpeg', 'image/png', 'image/webp'].includes(r.contentType)
      || !['width', 'height'].every(k => Number.isSafeInteger(r[k]) && r[k] > 0 && r[k] <= 16384)) fail('SLIDES_CONTENT_NOT_PREPARED');
    const out = Object.fromEntries(fields.map(k => [k, r[k]])), binding = JSON.stringify(out);
    if (assets.has(r.assetId) && assets.get(r.assetId) !== binding) fail('SLIDES_CONTENT_NOT_PREPARED');
    assets.set(r.assetId, binding); return out;
  }
  const slides = catalog.slides.map(s => {
    if (!s || Object.keys(s).some(k => !languages.includes(k)) || !s.es || (!catalog.englishEnabled && s.en)) fail('SLIDES_CONTENT_NOT_PREPARED');
    return Object.fromEntries(languages.filter(k => s[k]).map(k => {
      const variant = s[k];
      if (Object.keys(variant).some(key => !['full', 'thumb'].includes(key)) || !variant.full) fail('SLIDES_CONTENT_NOT_PREPARED');
      const full = resource(variant.full); return [k, { full, thumb: variant.thumb ? resource(variant.thumb) : full }];
    }));
  });
  if (catalog.englishEnabled && !slides.some(s => s.en)) fail('SLIDES_CONTENT_NOT_PREPARED');
  const definitions = { englishEnabled: catalog.englishEnabled, presenterLanguage: catalog.presenterLanguage, slides };
  return { ...definitions, digest: crypto.createHash('sha256').update(JSON.stringify(definitions)).digest('hex') };
}
class EventSlidesRuntime {
  constructor({ liveRuntime, readSlides = async () => null, readImage = async () => null }) {
    this.live = liveRuntime; this.readSlides = readSlides; this.readImage = readImage;
  }
  async prepared(context, db, liveId, preparedLive) {
    if (!this.live.enabled()) fail('LIVE_ACCESS_DENIED');
    const prepared = preparedLive || await this.live.prepared(context, db, liveId);
    if (!prepared.slideDigest) fail('SLIDES_CONTENT_NOT_PREPARED');
    const source = await this.readSlides(prepared, db);
    if (!source || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(k => source[k] !== prepared[k])) fail('SLIDES_CONTENT_NOT_PREPARED');
    const definitions = normalizeSlides(source, prepared.slideCount);
    if (definitions.digest !== prepared.slideDigest) fail('CONTENT_VERSION_CHANGED');
    const state = this.live.states.get(executionKey(context.eventId, liveId));
    if (!state || ['eventId', 'liveSessionId', 'stageId', 'activityId', 'deckId', 'versionId', 'slideCount', 'slideDigest'].some(k => state[k] !== prepared[k])) fail('CONTENT_VERSION_CHANGED');
    return { prepared, definitions, state };
  }
  imageUrl(context, liveId, digest, language, index, variant) {
    return `/api/events-v2/live/${context.eventId}/${liveId}/${context.grantId}/slides/${digest}/${language}/${index}/${variant}`;
  }
  image(context, scoped, index, requested, variant = 'full') {
    const { definitions: d, prepared } = scoped;
    const language = requested === 'en' && d.englishEnabled && d.slides[index].en ? 'en' : 'es';
    return { index, language, url: this.imageUrl(context, prepared.liveSessionId, d.digest, language, index, variant) };
  }
  async projection(context, db, liveId, preparedLive, language = 'es') {
    if (!languages.includes(language)) fail('SLIDES_INVALID_INPUT');
    const scoped = await this.prepared(context, db, liveId, preparedLive), { definitions: d, state } = scoped;
    const selected = context.kind === 'PARTICIPANT' ? language === 'en' && d.englishEnabled ? 'en' : 'es' : d.presenterLanguage;
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, revision: state.revision, contentVersion: d.digest,
      availableLanguages: d.englishEnabled ? ['es', 'en'] : ['es'], language: selected,
      slide: this.image(context, scoped, state.liveSlideIndex, selected) };
    if (control(context)) {
      snapshot.preview = this.image(context, scoped, state.presenterSlideIndex, selected, 'thumb');
      snapshot.next = state.presenterSlideIndex + 1 < scoped.prepared.slideCount
        ? this.image(context, scoped, state.presenterSlideIndex + 1, selected, 'thumb') : null;
    }
    return snapshot;
  }
}
module.exports = { EventSlidesRuntime, normalizeSlides, languages, control };
