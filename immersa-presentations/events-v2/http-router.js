const express = require('express');
const { EventAccessError, accountActor, assertFields } = require('./authorization');
const { requireOrigin } = require('./grant-http');
const { attachEventReports } = require('./reports-http');
const { attachDeckPreparationRoutes } = require('./deck-preparation-http');
const { EventActivityDeckRepository } = require('./activity-deck-repository');
const { EventDeckRepository } = require('./deck-repository');
const { attachMediaRoutes } = require('./media-http');
const { EventDeckConfigurationService } = require('./deck-configuration');

function createEventDomainRouter({ repository, requireAccount, requirePlatformAdmin, enabled = false, grants = null, grantSockets = null, reports = null, deckPreparations = null, deckTranslations = null, media = null }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!(typeof enabled === 'function' ? enabled() : enabled)) return res.status(404).json({ code: 'EVENTS_V2_DISABLED' });
    if (!repository) return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const url = new URL(origin);
          if (!['http:', 'https:'].includes(url.protocol) || url.host !== req.get('host')) throw new Error('origin');
        } catch (_) { return res.status(403).json({ code: 'ORIGIN_DENIED' }); }
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ code: 'ORIGIN_DENIED' });
    }
    next();
  });
  router.use(requireAccount);
  const handle = (action, fields = null, status = 200) => async (req, res) => {
    try {
      if (fields) assertFields(req.body, fields);
      return res.status(status).json(await action(req, accountActor(req)));
    } catch (error) {
      if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
      console.error('[events-v2] authorization operation unavailable', { code: error.code || 'UNKNOWN' });
      return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    }
  };
  const revalidate = action => async (req, actor) => {
    const result = await action(req, actor);
    await grantSockets?.reviewAll();
    return result;
  };
  router.post('/platform/organizations', requirePlatformAdmin, handle((req, actor) => repository.createOrganization(actor, req.body), ['name', 'adminUserId', 'createEventsEnabled'], 201));
  router.patch('/platform/organizations/:orgId', requirePlatformAdmin, handle((req, actor) => repository.setCreationEnabled(actor, req.params.orgId, req.body.createEventsEnabled), ['createEventsEnabled']));
  router.get('/organizations', handle((_req, actor) => repository.listOrganizations(actor)));
  router.get('/organizations/:orgId', handle((req, actor) => repository.getOrganization(actor, req.params.orgId)));
  router.put('/organizations/:orgId/members/:userId', handle(revalidate((req, actor) => repository.setOrganizationMember(actor, req.params.orgId, req.params.userId, req.body.role)), ['role']));
  router.delete('/organizations/:orgId/members/:userId', handle(revalidate((req, actor) => repository.setOrganizationMember(actor, req.params.orgId, req.params.userId, null))));
  router.post('/organizations/:orgId/events', handle((req, actor) => repository.createEvent(actor, req.params.orgId, req.body), ['title', 'slug', 'timezone'], 201));
  router.get('/organizations/:orgId/events', handle((req, actor) => repository.listEvents(actor, req.params.orgId)));
  const eventPath = '/organizations/:orgId/events/:eventId';
  const decks = repository && new EventDeckRepository(repository);
  if (decks) {
    const args = req => [req.params.orgId, req.params.eventId];
    router.get(eventPath + '/decks', handle((req, actor) => decks.list(actor, ...args(req))));
    router.post(eventPath + '/decks', requireOrigin, handle((req, actor) => decks.create(actor, ...args(req), req.body.title), ['title'], 201));
    router.get(eventPath + '/decks/:deckId', handle((req, actor) => decks.get(actor, ...args(req), req.params.deckId)));
    router.post(eventPath + '/decks/:deckId/versions', requireOrigin, handle((req, actor) => decks.createVersion(actor, ...args(req), req.params.deckId), [], 201));
  }
  attachDeckPreparationRoutes(router, deckPreparations, eventPath);
  attachDeckPreparationRoutes(router, deckTranslations, eventPath);
  attachMediaRoutes(router, media, eventPath);
  if (deckPreparations) {
    const configurations = new EventDeckConfigurationService({ preparations: deckPreparations, translations: deckTranslations, media });
    const scope = req => ({ organizationId: req.params.orgId, eventId: req.params.eventId,
      deckId: req.params.deckId, versionId: req.params.versionId });
    const configPath = eventPath + '/decks/:deckId/versions/:versionId/configuration';
    const noQuery = req => { if (Object.keys(req.query).length) throw new EventAccessError('INVALID_FIELDS', 400); };
    router.get(configPath, handle((req, actor) => { noQuery(req); return configurations.get(actor, scope(req)); }));
    router.post(configPath, requireOrigin, handle((req, actor) => {
      noQuery(req); return configurations.create(actor, scope(req), req.body);
    }, ['slides', 'polls', 'knowledge', 'raffles', 'games', 'audiovisual', 'language'], 201));
  }
  if (repository) {
    const bindings = new EventActivityDeckRepository({ domain: repository,
      enabled: () => typeof enabled === 'function' ? enabled() : enabled });
    const scope = req => ({ organizationId: req.params.orgId, eventId: req.params.eventId, activityId: req.params.activityId });
    const bindingPath = eventPath + '/activities/:activityId/deck-binding';
    router.get(bindingPath, handle((req, actor) => bindings.get(actor, scope(req))));
    const noQuery = req => { if (Object.keys(req.query).length) throw new EventAccessError('INVALID_FIELDS', 400); };
    router.put(bindingPath, requireOrigin, handle((req, actor) => {
      noQuery(req); return bindings.set(actor, scope(req), req.body);
    }, ['deckId', 'versionId', 'expectedRevision']));
    router.delete(bindingPath, requireOrigin, handle((req, actor) => {
      noQuery(req); return bindings.set(actor, scope(req), req.body, true);
    }, ['expectedRevision']));
  }
  attachEventReports(router, reports, eventPath);
  router.get(eventPath, handle((req, actor) => repository.getEvent(actor, req.params.orgId, req.params.eventId)));
  router.patch(eventPath, handle((req, actor) => repository.updateEvent(actor, req.params.orgId, req.params.eventId, req.body.title), ['title']));
  router.put(eventPath + '/members/:userId', handle(revalidate((req, actor) => repository.setEventMember(actor, req.params.orgId, req.params.eventId, req.params.userId, req.body.roles)), ['roles']));
  router.delete(eventPath + '/members/:userId', handle(revalidate((req, actor) => repository.setEventMember(actor, req.params.orgId, req.params.eventId, req.params.userId, null))));
  router.get(eventPath + '/activities/:activityId', handle((req, actor) => repository.getActivity(actor, req.params.orgId, req.params.eventId, req.params.activityId)));
  if (grants) {
    router.put(eventPath + '/access-state', requireOrigin, handle(async (req, actor) => {
      if (Object.keys(req.query).length) throw new EventAccessError('INVALID_INPUT', 400);
      const result = await grants.setAccessEnabled(actor, req.params.orgId, req.params.eventId, req.body.enabled);
      // No disconnect before commit: a failed suspension leaves valid access
      // intact. Persisted revocation also protects other instances/restarts.
      if (!result.enabled) grantSockets?.disconnectEvent(result.eventId);
      return result;
    }, ['enabled']));
    router.put(eventPath + '/operational-window', requireOrigin, handle(async (req, actor) => {
      const result = await grants.setWindow(actor, req.params.orgId, req.params.eventId, req.body.endsAt);
      await grantSockets?.reviewAll();
      return result;
    }, ['endsAt']));
    router.post(eventPath + '/grants', requireOrigin, handle((req, actor) => grants.issue(actor, req.params.orgId, req.params.eventId, req.body),
      ['kind', 'purpose', 'stageId', 'activityId', 'liveSessionId'], 201));
    router.delete(eventPath + '/grants/:grantId', requireOrigin, handle(async (req, actor) => {
      const result = await grants.revoke(actor, req.params.orgId, req.params.eventId, req.params.grantId);
      grantSockets?.disconnectGrant(result.grantId);
      return result;
    }));
  }
  // No v2 endpoint falls through to legacy routes, even when a live family is
  // not implemented yet. Private preparation endpoints remain separate from live execution.
  router.use((_req, res) => res.status(404).json({ code: 'RESOURCE_NOT_FOUND' }));
  return router;
}

module.exports = { createEventDomainRouter };
