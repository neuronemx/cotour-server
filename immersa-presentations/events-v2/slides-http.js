const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { browserToken } = require('./grant-http');
const { byteRange } = require('./asset-http');
const { control, languages } = require('./slides-runtime');
const deny = code => { throw new EventAccessError(code, 403); };

function createEventSlidesRouter({ grants, slides, enabled = () => false }) {
  const router = express.Router();
  router.use('/live/:eventId/:liveId/:grantId/slides', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    if (!enabled()) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    if (!grants || !slides) return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    next();
  });
  router.get('/live/:eventId/:liveId/:grantId/slides/:digest/:language/:index/:variant', async (req, res) => {
    let size;
    try {
      const { eventId, liveId, grantId, digest, language, index, variant } = req.params;
      if (![eventId, liveId, grantId].every(isId) || !/^[a-f0-9]{64}$/.test(digest) || !languages.includes(language)
        || !/^(0|[1-9][0-9]{0,5})$/.test(index) || !['full', 'thumb'].includes(variant) || Object.keys(req.query).length
        || req.headers['sec-fetch-site'] === 'cross-site') deny('SLIDES_IMAGE_ACCESS_DENIED');
      const { descriptor, resource } = await grants.withBrowser({ eventId, grantId, token: browserToken(req.headers, grantId) }, async (context, db) => {
        if (!enabled()) deny('LIVE_ACCESS_DENIED');
        const scoped = await slides.prepared(context, db, liveId), n = Number(index);
        if (digest !== scoped.definitions.digest) deny('CONTENT_VERSION_CHANGED');
        if (n >= scoped.prepared.slideCount || (!control(context) && (variant !== 'full' || n !== scoped.state.liveSlideIndex))
          || (language === 'en' && !scoped.definitions.englishEnabled)) deny('SLIDES_IMAGE_ACCESS_DENIED');
        if (context.kind === 'PLAYER' && language !== slides.image(context, scoped, n, scoped.definitions.presenterLanguage).language) deny('SLIDES_IMAGE_ACCESS_DENIED');
        const resource = scoped.definitions.slides[n][language]?.[variant];
        if (!resource) deny('SLIDES_IMAGE_NOT_PREPARED');
        const descriptor = await slides.readImage(scoped.prepared, resource, db);
        if (!descriptor || descriptor.verified !== true || descriptor.size !== resource.size || descriptor.sha256 !== resource.sha256
          || descriptor.contentType !== resource.contentType || typeof descriptor.open !== 'function') deny('SLIDES_IMAGE_NOT_PREPARED');
        if (!enabled() || !slides.live.enabled()) deny('LIVE_ACCESS_DENIED');
        return { descriptor, resource };
      });
      if (!enabled() || !slides.live.enabled()) deny('LIVE_ACCESS_DENIED');
      size = resource.size;
      const etag = '"' + resource.sha256 + '"'; res.set({ ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Type': resource.contentType });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      const range = byteRange(req.method === 'HEAD' || (req.headers['if-range'] && req.headers['if-range'] !== etag) ? null : req.headers.range, size);
      res.set('Content-Length', String(range.end - range.start + 1));
      if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200); if (req.method === 'HEAD') return res.end();
      // Reuse verified immutable openers, after the authorization transaction.
      const body = await descriptor.open(range.start, range.end);
      if (!enabled() || !slides.live.enabled()) { body?.destroy?.(); deny('LIVE_ACCESS_DENIED'); }
      if (!(body instanceof Readable)) deny('SLIDES_IMAGE_NOT_PREPARED');
      await pipeline(body, res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Length');res.removeHeader('Content-Type');res.removeHeader('ETag');
      if (error.code === 'AV_INVALID_RANGE') { if (Number.isSafeInteger(size)) res.set('Content-Range', `bytes */${size}`); return res.status(416).json({ code: 'SLIDES_INVALID_RANGE' }); }
      if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
      return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    }
  });
  router.use('/live/:eventId/:liveId/:grantId/slides', (_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}
module.exports = { createEventSlidesRouter };
