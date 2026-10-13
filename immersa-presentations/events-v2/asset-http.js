const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { browserToken } = require('./grant-http');
const { controls, error } = require('./time-runtime');
function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  if (typeof header !== 'string' || header.length > 100) throw error('AV_INVALID_RANGE');
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw error('AV_INVALID_RANGE');
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) throw error('AV_INVALID_RANGE'); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw error('AV_INVALID_RANGE'); end = Math.min(end, size - 1); }
  return { start, end, partial: true };
}
function createEventAssetRouter({ grants, av, enabled = () => false }) {
  const router = express.Router();
  router.use('/live', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (!enabled()) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    if (!grants || !av) return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    next();
  });
  router.get('/live/:eventId/:liveId/:grantId/assets/:assetId', async (req, res) => {
    let size;
    try {
      const { eventId, liveId, grantId, assetId } = req.params;
      if (![eventId, liveId, grantId].every(isId) || !/^[a-zA-Z0-9_-]{1,120}$/.test(assetId) || req.headers['sec-fetch-site'] === 'cross-site') throw error('AV_ASSET_ACCESS_DENIED');
      const authorized = await grants.withBrowser({ eventId, grantId, token: browserToken(req.headers, grantId) }, async (context, db) => {
        if (!enabled() || !av.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (!controls(context)) throw error('AV_ASSET_ACCESS_DENIED');
        const scoped = await av.prepared(context, db, liveId), resource = scoped.definitions.resources.find(item => item.assetId === assetId);
        if (!resource) throw error('AV_RESOURCE_NOT_FOUND');
        // Trusted reader returns an immutable verified descriptor, never a
        // client path, redirect or public catalog fallback. No bytes opened yet.
        const descriptor = await av.readAsset(scoped.prepared, resource, db);
        if (!descriptor || descriptor.verified !== true || descriptor.size !== resource.size || descriptor.sha256 !== resource.sha256 || descriptor.contentType !== resource.contentType || typeof descriptor.open !== 'function') throw error('AV_ASSET_NOT_PREPARED');
        if (!enabled()) throw error('LIVE_ACCESS_DENIED');
        return { descriptor, resource };
      });
      if (!enabled()) throw error('LIVE_ACCESS_DENIED');
      const { descriptor, resource } = authorized; size = resource.size;
      const etag = '"' + resource.sha256 + '"';
      res.set({ ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Type': resource.contentType });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      const range = byteRange(req.method === 'HEAD' || (req.headers['if-range'] && req.headers['if-range'] !== etag) ? null : req.headers.range, size);
      res.set('Content-Length', String(range.end - range.start + 1));
      if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200);
      if (req.method === 'HEAD') return res.end();
      // Authorization is per request. The immutable stream is opened only
      // after authorization commits; do not hold SQL locks during playback.
      const body = await descriptor.open(range.start, range.end);
      if (!enabled()) { body?.destroy?.(); throw error('LIVE_ACCESS_DENIED'); }
      if (!(body instanceof Readable)) throw error('AV_ASSET_NOT_PREPARED');
      await pipeline(body, res);
    } catch (failure) {
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Length');
      if (failure.code === 'AV_INVALID_RANGE') { if (Number.isSafeInteger(size)) res.set('Content-Range', `bytes */${size}`); return res.status(416).json({ code: 'AV_INVALID_RANGE' }); }
      if (failure instanceof EventAccessError) return res.status(failure.statusCode).json({ code: failure.code });
      return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    }
  });
  router.use('/live', (_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}
module.exports = { createEventAssetRouter, byteRange };
