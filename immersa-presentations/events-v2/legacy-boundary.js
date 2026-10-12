const { EventAccessError } = require('./authorization');

// This boundary remains active when the v2 feature flag is off. Disabling
// the new router must never make v2 rows accessible through old endpoints.
class LegacyEventBoundary {
  constructor(pool) { this.pool = pool; }

  async isV2(kind, id) {
    if (!id) return false;
    const selectors = {
      event: ['SELECT c.event_id FROM event_v2_contexts c WHERE c.event_id = ?', [id]],
      stage: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_stages r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      activity: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_activities r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      live: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_live_sessions r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      qr: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_public_qrs r ON r.event_workspace_id = c.event_id WHERE r.public_id = ?', [id]],
      assignment: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_activities a ON a.event_workspace_id = c.event_id JOIN event_activity_speaker_assignments r ON r.event_activity_id = a.id WHERE r.id = ?', [id]],
      deck: [`SELECT c.event_id FROM event_v2_contexts c WHERE EXISTS
        (SELECT 1 FROM event_activities a WHERE a.event_workspace_id = c.event_id AND (a.deck_id = ? OR a.pending_deck_id = ?))
        OR EXISTS (SELECT 1 FROM event_live_sessions l WHERE l.event_workspace_id = c.event_id AND l.deck_id = ?)`, [id, id, id]]
    };
    const selector = selectors[kind];
    if (!selector) throw new Error('Unknown legacy resource kind');
    return Boolean((await this.pool.execute(selector[0] + ' LIMIT 1', selector[1]))[0].length);
  }

  async assertPresentation(sessionId, deckId) {
    if (await this.isV2('deck', deckId) || await this.isV2('live', sessionId) || await this.isV2('event', sessionId)) {
      throw new EventAccessError('EVENT_V2_ACCESS_REQUIRED', 404);
    }
  }

  async allowPresentationJoin(socket, sessionId, deckId) {
    try {
      await this.assertPresentation(sessionId, deckId);
      return true;
    } catch (_error) {
      socket.emit('presentation:access_denied', { code: 'EVENT_ACCESS_REQUIRED' });
      socket.disconnect(true);
      return false;
    }
  }

  httpMiddleware() {
    return async (req, res, next) => {
      // Fixed path families, no inference from client roles or flags.
      const routes = [
        [/^\/api\/admin\/event-hubs\/([^/]+)/, 'event'],
        [/^\/api\/(?:admin\/event-stages|event\/stages)\/([^/]+)/, 'stage'],
        [/^\/api\/event\/stage-control\/([^/]+)/, 'deck'],
        [/^\/api\/event\/live-sessions\/([^/]+)/, 'live'],
        [/^\/api\/event\/public\/([^/]+)/, 'qr'],
        [/^\/api\/event-hub\/speaker-invitations\/([^/]+)/, 'assignment'],
        [/^\/event-hubs\/([^/]+)\/brand-assets\//, 'event'],
        [/^\/(p_evt_[^/]+)$/, 'qr'],
        [/^\/(?:api\/decks|decks|api\/demo-session\/decks)\/([^/]+)/, 'deck']
      ];
      try {
        for (const [pattern, kind] of routes) {
          const match = req.path.match(pattern);
          if (match && await this.isV2(kind, decodeURIComponent(match[1]))) {
            return res.status(404).json({ code: 'EVENT_V2_ACCESS_REQUIRED' });
          }
        }
        if (req.path === '/api/access-links' && req.body?.session_id) {
          await this.assertPresentation(req.body.session_id, req.body.deck_id || req.body.deckId);
        }
        if (req.path.startsWith('/api/event/') && req.body?.eventActivityId
          && await this.isV2('activity', req.body.eventActivityId)) {
          return res.status(404).json({ code: 'EVENT_V2_ACCESS_REQUIRED' });
        }
        return next();
      } catch (error) {
        if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
        console.error('[events-v2] legacy boundary unavailable', { code: error.code || 'UNKNOWN' });
        return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
      }
    };
  }
}

module.exports = { LegacyEventBoundary };
