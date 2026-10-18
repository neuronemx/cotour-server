const express = require('express');
const { EventAccessError, assertFields } = require('./authorization');
const { isId } = require('./grant-repository');
const { attachEventConsoleContext } = require('./console-http');

const cookieName = grantId => '__Host-immersa-events-v2-' + grantId;
function sameOrigin(origin, host) {
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === host; }
  catch (_) { return false; }
}
function requireOrigin(req, res, next) {
  if (!sameOrigin(req.headers.origin, req.get('host')) || req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ code: 'ORIGIN_DENIED' });
  }
  next();
}
function browserToken(headers, grantId) {
  if (!isId(grantId)) return null;
  const name = cookieName(grantId);
  const matches = String(headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0].slice(name.length + 1)); } catch (_) { return null; }
}
function setGrantCookie(res, grantId, token) {
  // Retention is not authorization. Keeping the credential past the old end
  // allows an offline browser to reconnect after an authorized end extension.
  // The DB grant/window still expires access at the actual event end and never
  // revives expired/revoked links. No browser renewal can extend that window.
  res.cookie(cookieName(grantId), token, { secure: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: 400 * 24 * 60 * 60 * 1000 });
}
function createGrantAccessRouter({ grants, lifecycle = null, grantSockets = null, enabled = () => false }) {
  const router = express.Router();
  router.use(['/access', '/public'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!enabled()) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    if (!grants) return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    next();
  });
  const handle = (action, fields = null, status = 200) => async (req, res) => {
    try {
      if (fields) assertFields(req.body, fields);
      const result = await action(req, res);
      return res.status(status).json(result);
    } catch (error) {
      if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
      console.error('[events-v2] grant access unavailable', { code: error.code || 'UNKNOWN' });
      return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    }
  };
  router.post('/access/exchange', requireOrigin, handle(async (req, res) => {
    const session = await grants.exchange(req.body.eventId, req.body.token);
    setGrantCookie(res, session.context.grantId, req.body.token);
    return session;
  }, ['eventId', 'token']));
  router.get('/access/:eventId/:grantId/context', handle(req => grants.withBrowser({ ...req.params, token: browserToken(req.headers, req.params.grantId) })));
  router.post('/access/:eventId/:grantId/renew', requireOrigin, handle(async (req, res) => {
    const token = browserToken(req.headers, req.params.grantId);
    // Validate the cookie's fixed grant as well as the event path before exchange.
    await grants.withBrowser({ ...req.params, token });
    const session = await grants.exchange(req.params.eventId, token);
    setGrantCookie(res, req.params.grantId, token);
    return session;
  }, []));
  attachEventConsoleContext(router, grants, handle, browserToken, lifecycle);
  router.post('/public/:publicId/participants', requireOrigin, handle(async (req, res) => {
    const registration = await grants.register(req.params.publicId, req.body.name);
    setGrantCookie(res, registration.grantId, registration.token);
    // Long registration secret exists only in the HttpOnly cookie, never in JS.
    return registration.session;
  }, ['name'], 201));
  if (lifecycle) {
    const credential = req => {
      if (Object.keys(req.query).length) throw new EventAccessError('INVALID_INPUT', 400);
      return { eventId: req.params.eventId, grantId: req.params.grantId, token: browserToken(req.headers, req.params.grantId) };
    };
    const root = '/access/:eventId/:grantId';
    router.get(root + '/live-session', handle(req => {
      if (Object.keys(req.query).length) throw new EventAccessError('INVALID_INPUT', 400);
      const c = credential(req); return lifecycle.current(c, lifecycle.browser(c));
    }));
    router.post(root + '/activities/:activityId/start', requireOrigin, handle(req => {
      const c = credential(req); return lifecycle.start(c, req.params.activityId, lifecycle.browser(c));
    }, [], 201));
    router.post(root + '/live-sessions/:liveId/finish', requireOrigin, handle(async req => {
      const c = credential(req), result = await lifecycle.finish(c, req.params.liveId, lifecycle.browser(c));
      grantSockets?.finishLive(result.eventId, result.liveSessionId);
      return result;
    }, []));
  }
  router.use(['/access', '/public'], (_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}
module.exports = { createGrantAccessRouter, requireOrigin, sameOrigin, browserToken, cookieName };
