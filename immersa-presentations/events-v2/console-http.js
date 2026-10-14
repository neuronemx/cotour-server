const express = require('express');
const path = require('node:path');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');

const CONSOLE_KINDS = Object.freeze({ stage: 'STAGE', speaker: 'SPEAKER', screen: 'PLAYER', audience: 'PARTICIPANT' });

function createEventConsolePages({ enabled = () => false } = {}) {
  const router = express.Router();
  router.use('/console', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    if (!enabled()) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    next();
  });
  router.get('/console/:view/:eventId/:grantId', (req, res) => {
    if (!Object.hasOwn(CONSOLE_KINDS, req.params.view) || !isId(req.params.eventId) || !isId(req.params.grantId)
      || Object.keys(req.query).length) return res.status(404).json({ code: 'RESOURCE_NOT_FOUND' });
    // Generic access shell only. It is outside public/ so static serving cannot
    // bypass the flag. Names, identities and operational state require a grant.
    res.sendFile(path.join(__dirname, 'console.html'));
  });
  router.use('/console', (_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}

function attachEventConsoleContext(router, grants, handle, browserToken) {
  router.get('/access/:eventId/:grantId/console/:view', handle(async req => {
    if (Object.keys(req.query).length) throw new EventAccessError('INVALID_INPUT', 400);
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new EventAccessError('ORIGIN_DENIED');
    if (!Object.hasOwn(CONSOLE_KINDS, req.params.view)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    return grants.withBrowser({ eventId: req.params.eventId, grantId: req.params.grantId,
      token: browserToken(req.headers, req.params.grantId) }, async (context, db) => {
      if (context.kind !== CONSOLE_KINDS[req.params.view]) throw new EventAccessError('CONSOLE_ACCESS_DENIED');
      const rows = await grants.rows(db, 'SELECT title FROM event_hubs WHERE workspace_id = ?', [context.eventId]);
      if (!rows[0]) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
      return { context, event: { eventId: context.eventId, title: rows[0].title }, view: req.params.view };
    });
  }));
}

module.exports = { createEventConsolePages, attachEventConsoleContext, CONSOLE_KINDS };
