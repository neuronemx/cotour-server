const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventAccessError, assertFields } = require('./authorization');
const { isId } = require('./grant-repository');
const { browserToken, requireOrigin } = require('./grant-http');
const { byteRange } = require('./asset-http');

function createEventRehearsalRouter({ rehearsal, enabled = () => false }) {
  const router = express.Router(), root = '/rehearsal/:eventId/:grantId';
  router.use('/rehearsal', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (!enabled()) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    if (!rehearsal) return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    if (Object.keys(req.query).length || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ code: 'REHEARSAL_ACCESS_DENIED' });
    next();
  });
  function credentials(req) {
    if (![req.params.eventId, req.params.grantId].every(isId)) throw new EventAccessError('INVALID_INPUT', 400);
    return { eventId: req.params.eventId, grantId: req.params.grantId, token: browserToken(req.headers, req.params.grantId) };
  }
  function error(res, e, size) {
    if (res.headersSent) return res.destroy();
    for (const name of ['Content-Length', 'Content-Type', 'ETag']) res.removeHeader(name);
    if (e.code === 'AV_INVALID_RANGE') {
      if (Number.isSafeInteger(size)) res.set('Content-Range', `bytes */${size}`);
      return res.status(416).json({ code: 'REHEARSAL_INVALID_RANGE' });
    }
    return res.status(e instanceof EventAccessError ? e.statusCode : 503)
      .json({ code: e instanceof EventAccessError ? e.code : 'AUTHORIZATION_UNAVAILABLE', ...(Number.isSafeInteger(e.currentRevision) ? { currentRevision: e.currentRevision } : {}) });
  }
  router.get(root, async (req, res) => {
    try { res.json(await rehearsal.operate(credentials(req))); } catch (e) { error(res, e); }
  });
  router.post(root, requireOrigin, async (req, res) => {
    try {
      const action = req.body?.action;
      const fields = ['action', 'expectedRevision', ...(action === 'go' ? ['slideIndex'] : action === 'language' ? ['language']
        : action === 'poll' ? ['runId', 'command', ...(req.body.command === 'launch' ? ['interactionId'] : ['pollRunId', ...(req.body.command === 'respond' ? ['optionId'] : [])])]
        : action === 'raffle' ? ['runId', 'command', ...(['open', 'configure_key'].includes(req.body.command) ? ['definitionId'] : ['raffleRunId']),
          ...(req.body.command === 'configure_key' ? ['optionId'] : req.body.command === 'enter' ? ['sampleId', 'name', ...(Object.hasOwn(req.body, 'optionId') ? ['optionId'] : [])] : [])]
        : action === 'knowledge' ? ['runId', 'command', ...(req.body.command === 'open' ? ['definitionId'] : ['executionId']), ...(req.body.command === 'answer' ? ['questionId', 'optionId'] : [])]
        : action === 'qna' ? ['runId', 'command', ...(req.body.command === 'open' ? [] : ['roundId']),
          ...(req.body.command === 'submit' ? ['question', 'name', 'allowNameOnScreen'] : req.body.command === 'set_open' ? ['open']
            : ['select', 'project', 'delete'].includes(req.body.command) ? ['questionId'] : [])] : [])];
      assertFields(req.body, fields);
      if (!['next', 'prev', 'go', 'reset', 'language', 'poll', 'qna', 'knowledge', 'raffle'].includes(action)
        || action === 'poll' && (!isId(req.body.runId) || !['launch', 'respond', 'show', 'hide', 'close'].includes(req.body.command)
          || (req.body.command === 'launch' ? typeof req.body.interactionId !== 'string' : !isId(req.body.pollRunId)))
        || action === 'raffle' && (!isId(req.body.runId) || !['open', 'configure_key', 'enter', 'close_entries', 'draw', 'reveal', 'close', 'reset_winners'].includes(req.body.command)
          || (['open', 'configure_key'].includes(req.body.command) ? typeof req.body.definitionId !== 'string' : !isId(req.body.raffleRunId))
          || req.body.command === 'enter' && req.body.sampleId !== null && !isId(req.body.sampleId))
        || action === 'knowledge' && (!isId(req.body.runId) || !['open', 'start', 'answer', 'submit', 'finalize', 'show_results', 'close', 'cancel', 'retry_processing', 'force_results'].includes(req.body.command)
          || (req.body.command === 'open' ? typeof req.body.definitionId !== 'string' : !isId(req.body.executionId)))
        || action === 'qna' && (!isId(req.body.runId) || !['open', 'set_open', 'submit', 'select', 'project', 'delete', 'new_round', 'panel_close'].includes(req.body.command)
          || req.body.command !== 'open' && !isId(req.body.roundId)
          || ['select', 'project', 'delete'].includes(req.body.command) && !isId(req.body.questionId))) throw new EventAccessError('INVALID_INPUT', 400);
      res.json(await rehearsal.operate(credentials(req), action, req.body));
    } catch (e) { error(res, e); }
  });
  router.get(root + '/media/:runId/:digest/:assetId', async (req, res) => {
    let size;
    try {
      const p = req.params;
      if (!isId(p.runId) || !/^[a-f0-9]{64}$/.test(p.digest) || !/^[a-zA-Z0-9_-]{1,120}$/.test(p.assetId)) throw new EventAccessError('INVALID_INPUT', 400);
      const { descriptor, resource } = await rehearsal.media(credentials(req), p);
      if (!enabled()) throw new EventAccessError('EVENTS_V2_DISABLED', 404);
      size = resource.size;
      const etag = '"' + resource.sha256 + '"';
      res.set({ ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Type': resource.contentType });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      const range = byteRange(req.method === 'HEAD' || (req.headers['if-range'] && req.headers['if-range'] !== etag) ? null : req.headers.range, size);
      res.set('Content-Length', String(range.end - range.start + 1));
      if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200);
      if (req.method === 'HEAD') return res.end();
      const body = await descriptor.open(range.start, range.end);
      if (!enabled()) { body?.destroy?.(); throw new EventAccessError('EVENTS_V2_DISABLED', 404); }
      if (!(body instanceof Readable)) throw new EventAccessError('CONTENT_NOT_PREPARED');
      await pipeline(body, res);
    } catch (e) { error(res, e, size); }
  });
  router.get(root + '/question-images/:runId/:digest/:executionId/:assetId', async (req, res) => {
    try {
      const p = req.params;
      if (![p.runId, p.executionId, p.assetId].every(isId) || !/^[a-f0-9]{64}$/.test(p.digest)) throw new EventAccessError('INVALID_INPUT', 400);
      const { descriptor, resource } = await rehearsal.questionImage(credentials(req), p);
      if (!enabled()) throw new EventAccessError('EVENTS_V2_DISABLED', 404);
      const etag = '"' + resource.sha256 + '"';
      res.set({ ETag: etag, 'Content-Type': resource.contentType, 'Content-Security-Policy': "default-src 'none'; sandbox" });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.set('Content-Length', String(resource.size));
      if (req.method === 'HEAD') return res.end();
      const body = await descriptor.open(0, resource.size - 1);
      if (!enabled()) { body?.destroy?.(); throw new EventAccessError('EVENTS_V2_DISABLED', 404); }
      if (!(body instanceof Readable)) throw new EventAccessError('CONTENT_NOT_PREPARED');
      await pipeline(body, res);
    } catch (e) { error(res, e); }
  });
  router.get(root + '/raffle-images/:runId/:digest/:executionId/:assetId', async (req, res) => {
    try {
      const p = req.params;
      if (![p.runId, p.assetId].every(isId) || p.executionId !== 'catalog' && !isId(p.executionId) || !/^[a-f0-9]{64}$/.test(p.digest)) throw new EventAccessError('INVALID_INPUT', 400);
      const { descriptor, resource } = await rehearsal.raffleImage(credentials(req), p);
      if (!enabled()) throw new EventAccessError('EVENTS_V2_DISABLED', 404);
      const etag = '"' + resource.sha256 + '"';
      res.set({ ETag: etag, 'Content-Type': resource.contentType, 'Content-Security-Policy': "default-src 'none'; sandbox" });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.set('Content-Length', String(resource.size));
      if (req.method === 'HEAD') return res.end();
      const body = await descriptor.open(0, resource.size - 1);
      if (!enabled()) { body?.destroy?.(); throw new EventAccessError('EVENTS_V2_DISABLED', 404); }
      if (!(body instanceof Readable)) throw new EventAccessError('CONTENT_NOT_PREPARED');
      await pipeline(body, res);
    } catch (e) { error(res, e); }
  });
  router.get(root + '/slides/:runId/:digest/:language/:index/:variant', async (req, res) => {
    let size;
    try {
      const p = req.params;
      if (!isId(p.runId) || !/^[a-f0-9]{64}$/.test(p.digest) || !/^(0|[1-9][0-9]{0,5})$/.test(p.index)) throw new EventAccessError('INVALID_INPUT', 400);
      const { descriptor, resource } = await rehearsal.image(credentials(req), { ...p, index: Number(p.index) });
      if (!enabled()) throw new EventAccessError('EVENTS_V2_DISABLED', 404);
      size = resource.size;
      const etag = '"' + resource.sha256 + '"';
      res.set({ ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Type': resource.contentType,
        'Content-Security-Policy': "default-src 'none'; sandbox" });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      const range = byteRange(req.method === 'HEAD' || (req.headers['if-range'] && req.headers['if-range'] !== etag) ? null : req.headers.range, size);
      res.set('Content-Length', String(range.end - range.start + 1));
      if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200);
      if (req.method === 'HEAD') return res.end();
      const body = await descriptor.open(range.start, range.end);
      if (!enabled()) { body?.destroy?.(); throw new EventAccessError('EVENTS_V2_DISABLED', 404); }
      if (!(body instanceof Readable)) throw new EventAccessError('CONTENT_NOT_PREPARED');
      await pipeline(body, res);
    } catch (e) { error(res, e, size); }
  });
  router.use('/rehearsal', (_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}
module.exports = { createEventRehearsalRouter };
