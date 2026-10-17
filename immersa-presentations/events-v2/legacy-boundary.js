const path = require('node:path');
const { EventAccessError } = require('./authorization');

// This boundary remains active when the v2 feature flag is off. Disabling
// the new router must never make v2 rows accessible through old endpoints.
class LegacyEventBoundary {
  constructor(pool) { this.pool = pool; }

  async isV2(kind, id) {
    id = String(id || '').trim();
    if (!id) return false;
    const selectors = {
      event: ['SELECT c.event_id FROM event_v2_contexts c WHERE c.event_id = ?', [id]],
      speaker: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_speakers r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      poll: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_hub_polls r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      stage: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_stages r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      activity: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_activities r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      live: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_live_sessions r ON r.event_workspace_id = c.event_id WHERE r.id = ?', [id]],
      knowledgeExecution: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_live_sessions l ON l.event_workspace_id = c.event_id JOIN event_v2_knowledge_executions e ON e.presentation_session_id = l.id WHERE e.id = ?', [id]],
      qr: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_public_qrs r ON r.event_workspace_id = c.event_id WHERE r.public_id = ?', [id]],
      assignment: ['SELECT c.event_id FROM event_v2_contexts c JOIN event_activities a ON a.event_workspace_id = c.event_id JOIN event_activity_speaker_assignments r ON r.event_activity_id = a.id WHERE r.id = ?', [id]],
      deck: [`SELECT c.event_id FROM event_v2_contexts c WHERE EXISTS
        (SELECT 1 FROM event_decks d WHERE d.event_id = c.event_id AND d.id = LOWER(?))
        OR EXISTS (SELECT 1 FROM event_deck_versions v WHERE v.event_id = c.event_id AND v.id = LOWER(?))
        OR EXISTS (SELECT 1 FROM event_activities a WHERE a.event_workspace_id = c.event_id AND (a.deck_id = ? OR a.pending_deck_id = ?))
        OR EXISTS (SELECT 1 FROM event_live_sessions l WHERE l.event_workspace_id = c.event_id AND l.deck_id = ?)`, [id, id, id, id, id]]
    };
    const selector = selectors[kind];
    if (!selector) throw new Error('Unknown legacy resource kind');
    return Boolean((await this.pool.execute(selector[0] + ' LIMIT 1', selector[1]))[0].length);
  }

  async assertPresentation(sessionId, deckId) {
    const deck = String(deckId || '');
    if (/[\\/\0]/.test(deck) || ['.', '..'].includes(deck.trim())) {
      throw new EventAccessError('INVALID_DECK_ID', 400);
    }
    // This execution namespace is reserved for the grant-authorized engines.
    if (/^evt:.*:(?:live|venue):/i.test(String(sessionId || '').trim())) {
      throw new EventAccessError('EVENT_V2_ACCESS_REQUIRED', 404);
    }
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
        [/^\/api\/admin\/event-hubs\/([^/]+)/i, 'event'],
        [/^\/api\/(?:admin\/event-stages|event\/stages)\/([^/]+)/i, 'stage'],
        [/^\/api\/event\/stage-control\/([^/]+)/i, 'deck'],
        [/^\/api\/event\/live-sessions\/([^/]+)/i, 'live'],
        [/^\/api\/knowledge-activities\/([^/]+)\/export\//i, 'knowledgeExecution'],
        [/^\/api\/event\/public\/([^/]+)/i, 'qr'],
        [/^\/api\/event-hub\/speaker-invitations\/([^/]+)/i, 'assignment'],
        [/^\/event-hubs\/([^/]+)\/brand-assets\//i, 'event'],
        [/^\/(p_evt_[^/]+)\/?$/i, 'qr'],
        [/^\/(?:api\/decks|decks|api\/demo-session\/decks)\/([^/]+)/i, 'deck'],
        // A visible v1 parent cannot disguise a v2 child locator.
        [/^\/api\/admin\/event-hubs\/[^/]+\/activities\/([^/]+)/i, 'activity'],
        [/^\/api\/admin\/event-hubs\/[^/]+\/activities\/[^/]+\/speakers\/([^/]+)/i, 'speaker'],
        [/^\/api\/admin\/event-hubs\/[^/]+\/polls\/([^/]+)/i, 'poll'],
        [/^\/api\/event\/stages\/[^/]+\/live-sessions\/([^/]+)/i, 'live']
      ];
      try {
        let decoded;
        try { decoded = decodeURIComponent(req.path); }
        catch (_) { throw new EventAccessError('INVALID_RESOURCE_PATH', 400); }
        if (decoded.includes('\0')) throw new EventAccessError('INVALID_RESOURCE_PATH', 400);
        // Express routes are case-insensitive; serve-static decodes and
        // normalizes dot segments. Inspect that path as well as the original
        // locator, without rewriting req.url or changing legacy routing.
        const candidates = new Map();
        const add = (kind, id) => { id = String(id || '').trim(); if (id) candidates.set(kind + ':' + id, { kind, id }); };
        for (const [value, encoded] of [[path.posix.normalize(decoded), false], [req.path, true]]) {
          for (const [pattern, kind] of routes) {
            const match = value.match(pattern);
            if (match) add(kind, encoded ? decodeURIComponent(match[1]) : match[1]);
          }
        }
        if (/^\/api\/access-links\/?$/i.test(decoded) && req.body?.session_id) {
          await this.assertPresentation(req.body.session_id, req.body.deck_id || req.body.deckId);
        }
        if (/^\/api\/(?:admin\/event-hubs|admin\/event-stages|event|event-hub\/speaker-invitations)(?:\/|$)/i.test(decoded)) {
          for (const [field, kind] of [['eventActivityId', 'activity'], ['eventStageId', 'stage'], ['deckId', 'deck'], ['speakerId', 'speaker']]) {
            if (req.body?.[field]) add(kind, req.body[field]);
          }
        }
        for (const { kind, id } of candidates.values()) {
          if (await this.isV2(kind, id)) return res.status(404).json({ code: 'EVENT_V2_ACCESS_REQUIRED' });
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
