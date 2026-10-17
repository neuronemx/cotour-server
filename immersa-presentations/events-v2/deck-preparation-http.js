const multer = require('multer');
const { EventAccessError, accountActor } = require('./authorization');
const { requireOrigin } = require('./grant-http');
const { MAX_SOURCE_BYTES } = require('./deck-private-store');

function attachDeckPreparationRoutes(router, service, eventPath) {
  if (!service) return;
  const versionPath = eventPath + '/decks/:deckId/versions/:versionId';
  const scope = req => ({ organizationId: req.params.orgId, eventId: req.params.eventId,
    deckId: req.params.deckId, versionId: req.params.versionId });
  const errorReply = (res, error) => {
    if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
    return res.status(503).json({ code: 'PREPARATION_UNAVAILABLE' });
  };
  const multipart = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: MAX_SOURCE_BYTES, files: 1, fields: 0, parts: 2, fieldNameSize: 32, headerPairs: 32
  } }).single('pdf');
  router.post(versionPath + '/source', requireOrigin, async (req, res) => {
    let release;
    try {
      const actor = accountActor(req);
      if (Object.keys(req.query).length) throw new EventAccessError('INVALID_FIELDS', 400);
      await service.authorize(actor, scope(req)); // Before multipart allocates memory.
      release = service.acquireUpload();
      await new Promise((resolve, reject) => multipart(req, res, e => e ? reject(e) : resolve()));
      if (!req.file || Object.keys(req.body || {}).length) throw new EventAccessError('INVALID_PDF', 400);
      return res.status(201).json(await service.upload(actor, scope(req), req.file.buffer));
    } catch (error) {
      if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: 'INVALID_PDF_UPLOAD' });
      return errorReply(res, error);
    } finally { release?.(); }
  });
  router.get(versionPath + '/preparation', async (req, res) => {
    try { return res.json(await service.get(accountActor(req), scope(req))); }
    catch (error) { return errorReply(res, error); }
  });
  router.get(versionPath + '/slides/:slideId/:variant', async (req, res) => {
    try {
      const bytes = await service.image(accountActor(req), scope(req), req.params.slideId, req.params.variant);
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
      return res.type('image/jpeg').send(bytes);
    } catch (error) { return errorReply(res, error); }
  });
}
module.exports = { attachDeckPreparationRoutes };
