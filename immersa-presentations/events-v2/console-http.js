const express = require('express');
const path = require('node:path');
const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');

const CONSOLE_KINDS = Object.freeze({ stage: 'STAGE', speaker: 'SPEAKER', screen: 'PLAYER', audience: 'PARTICIPANT' });

async function consoleTargets(grants, db, context) {
  if (context.kind === 'SPEAKER' && context.purpose !== 'live') return [];
  const where = ['a.event_workspace_id=?', "a.access_level IN ('FREE','PAID')", "a.status IN ('SCHEDULED','LIVE')"];
  const params = [context.eventId];
  if (context.stageId) { where.push('a.event_stage_id=?'); params.push(context.stageId); }
  if (context.activityId) { where.push('a.id=?'); params.push(context.activityId); }
  if (context.liveSessionId) { where.push('l.id=?'); params.push(context.liveSessionId); }
  if (context.kind === 'PARTICIPANT') {
    where.push('l.id IS NOT NULL');
    if (context.audienceLevel !== 'PAID') where.push("a.access_level='FREE'");
  }
  const rows = await grants.rows(db, `SELECT a.id AS activityId, a.event_stage_id AS stageId, a.title,
    a.access_level AS accessLevel, a.status AS activityStatus, a.deck_id, a.deck_check_status,
    s.name AS stageTitle, l.id AS liveSessionId,
    EXISTS(SELECT 1 FROM event_activity_deck_bindings b
      WHERE b.event_id=a.event_workspace_id AND b.activity_id=a.id) AS has_version_binding
    FROM event_activities a JOIN event_stages s ON s.id=a.event_stage_id AND s.event_workspace_id=a.event_workspace_id AND s.active=1
    LEFT JOIN event_live_sessions l ON l.event_activity_id=a.id AND l.event_stage_id=a.event_stage_id
      AND l.event_workspace_id=a.event_workspace_id AND l.status='LIVE' AND l.ended_at IS NULL
    WHERE ${where.join(' AND ')} ORDER BY s.sort_order,a.scheduled_starts_at,a.title,l.id LIMIT 501`, params);
  if (rows.length > 500) throw new EventAccessError('CONSOLE_TARGET_LIMIT', 409);
  const occupied = rows.some(row => row.liveSessionId);
  return rows.map(row => ({ eventId: context.eventId, activityId: row.activityId, stageId: row.stageId,
    title: row.title, stageTitle: row.stageTitle, accessLevel: row.accessLevel,
    liveSessionId: row.liveSessionId || null, status: row.liveSessionId ? 'LIVE' : row.activityStatus,
    canStart: context.kind === 'STAGE' && context.purpose === 'live' && !occupied && row.activityStatus === 'SCHEDULED'
      && !row.has_version_binding && Boolean(row.deck_id) && row.deck_check_status === 'DECK_CHECK' }));
}

function createEventConsolePages({ enabled = () => false } = {}) {
  const router = express.Router();
  router.use('/console', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js; style-src 'self'; media-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
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
      return { context, event: { eventId: context.eventId, title: rows[0].title }, view: req.params.view,
        targets: await consoleTargets(grants, db, context) };
    });
  }));
}

module.exports = { createEventConsolePages, attachEventConsoleContext, CONSOLE_KINDS, consoleTargets };
