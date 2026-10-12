const crypto = require('node:crypto');
const { EventAccessError, textField } = require('./authorization');

const SESSION_TTL_MS = 15 * 60 * 1000;
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const denied = () => new EventAccessError('GRANT_ACCESS_DENIED', 401);
const missing = () => new EventAccessError('RESOURCE_NOT_FOUND', 404);
const KINDS = Object.freeze(['STAGE', 'SPEAKER', 'PLAYER', 'VENUE', 'MODERATOR']);
const validSecret = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const isId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);

function utcInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new EventAccessError('EXPLICIT_EVENT_END_REQUIRED', 400);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new EventAccessError('INVALID_EVENT_END', 400);
  return date;
}

class EventGrantRepository {
  constructor(domain, { now = () => new Date(), sessionTtlMs = SESSION_TTL_MS } = {}) {
    this.domain = domain;
    this.pool = domain.pool;
    this.now = now;
    this.sessionTtlMs = sessionTtlMs;
  }

  rows(db, sql, params) { return this.domain.rows(db, sql, params); }

  async window(db, eventId) {
    const row = (await this.rows(db, 'SELECT ends_at FROM event_operational_windows WHERE event_id = ?', [eventId]))[0];
    if (!row || row.ends_at <= this.now()) throw new EventAccessError('EVENT_END_REQUIRED_OR_ELAPSED', 409);
    return row.ends_at;
  }

  async setWindow(actor, orgId, eventId, value) {
    const endsAt = utcInstant(value);
    return this.domain.transaction(actor, 'event.window.change', async db => {
      await this.domain.event(db, orgId, eventId, actor, 'event.configure');
      const now = this.now();
      await db.execute(`INSERT INTO event_operational_windows (event_id, ends_at) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at)`, [eventId, endsAt]);
      // An already expired or revoked link is never revived by extending the event.
      await db.execute(`UPDATE event_access_grants SET expires_at = ?, authz_version = authz_version + 1
        WHERE event_id = ? AND revoked_at IS NULL AND expires_at > ?`, [endsAt, eventId, now]);
      await this.domain.audit(db, actor, 'event.window.change', orgId, eventId, eventId);
      return { eventId, endsAt: endsAt.toISOString() };
    });
  }

  async resources(db, grant) {
    const { event_id: eventId, stage_id: stageId, activity_id: activityId, live_session_id: liveId } = grant;
    if (stageId) {
      const stage = (await this.rows(db, 'SELECT id FROM event_stages WHERE id = ? AND event_workspace_id = ? AND active = 1', [stageId, eventId]))[0];
      if (!stage) throw missing();
    }
    if (activityId) {
      const activity = (await this.rows(db, `SELECT id FROM event_activities
        WHERE id = ? AND event_workspace_id = ? AND event_stage_id = ?`, [activityId, eventId, stageId]))[0];
      if (!activity) throw missing();
    }
    if (liveId) {
      const live = (await this.rows(db, `SELECT id FROM event_live_sessions
        WHERE id = ? AND event_workspace_id = ? AND event_activity_id = ? AND event_stage_id = ?`, [liveId, eventId, activityId, stageId]))[0];
      if (!live) throw missing();
    }
    if (grant.kind === 'PARTICIPANT') {
      const participant = (await this.rows(db, `SELECT p.id, p.audience_level FROM event_participants p
        JOIN event_public_qrs q ON q.id = ? AND q.event_workspace_id = p.event_workspace_id
          AND q.audience_level = p.audience_level AND q.active = 1
        WHERE p.id = ? AND p.event_workspace_id = ?`, [grant.public_qr_id, grant.participant_id, eventId]))[0];
      if (!participant) throw denied();
      return participant.audience_level;
    }
    return null;
  }

  async issuer(db, orgId, eventId, actor, kind) {
    // A bearer grant is an explicit assignment of an operational function,
    // not an implicit consequence of having an account ADMIN role.
    await this.domain.event(db, orgId, eventId, actor,
      kind === 'SPEAKER' ? 'event.configure' : 'event.members.manage');
    await this.domain.user(db, actor);
    const org = (await this.rows(db, `SELECT authz_version FROM event_organization_memberships
      WHERE organization_id = ? AND user_id = ? AND active = 1`, [orgId, actor]))[0];
    const member = (await this.rows(db, `SELECT authz_version FROM event_memberships
      WHERE event_id = ? AND user_id = ? AND active = 1`, [eventId, actor]))[0];
    return { org: org.authz_version, event: member.authz_version };
  }

  async insert(db, grant, token) {
    await db.execute(`INSERT INTO event_access_grants
      (id,event_id,kind,purpose,token_hash,issuer_user_id,issuer_org_version,issuer_event_version,
       stage_id,activity_id,live_session_id,participant_id,public_qr_id,not_before,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [grant.id, grant.event_id, grant.kind, grant.purpose, hash(token),
      grant.issuer_user_id || null, grant.issuer_org_version || null, grant.issuer_event_version || null,
      grant.stage_id || null, grant.activity_id || null, grant.live_session_id || null,
      grant.participant_id || null, grant.public_qr_id || null, grant.not_before, grant.expires_at]);
  }

  async issue(actor, orgId, eventId, input) {
    const { kind, purpose } = input;
    if (!KINDS.includes(kind)) throw new EventAccessError('INVALID_GRANT_KIND', 400);
    const scopeKeys = ['stageId', 'activityId', 'liveSessionId'].filter(key => input[key] !== undefined);
    const required = kind === 'STAGE' ? ['stageId'] : kind === 'SPEAKER' ? ['activityId'] : kind === 'PLAYER' ? ['liveSessionId'] : [];
    if (scopeKeys.length !== required.length || required.some(key => !isId(input[key]))
      || scopeKeys.some(key => !required.includes(key)) || (kind === 'SPEAKER' ? !['live', 'rehearsal'].includes(purpose)
        : purpose !== (kind === 'PLAYER' ? 'player' : 'live'))) {
      throw new EventAccessError('INVALID_GRANT_SCOPE', 400);
    }
    return this.domain.transaction(actor, 'grant.issue', async db => {
      const versions = await this.issuer(db, orgId, eventId, actor, kind);
      const grant = { id: crypto.randomUUID(), event_id: eventId, kind, purpose, issuer_user_id: actor,
        issuer_org_version: versions.org, issuer_event_version: versions.event,
        not_before: this.now(), expires_at: await this.window(db, eventId) };
      if (kind === 'STAGE') grant.stage_id = input.stageId;
      if (kind === 'SPEAKER') {
        const a = (await this.rows(db, 'SELECT event_stage_id FROM event_activities WHERE id = ? AND event_workspace_id = ?', [input.activityId, eventId]))[0];
        if (!a) throw missing();
        grant.activity_id = input.activityId; grant.stage_id = a.event_stage_id;
      }
      if (kind === 'PLAYER') {
        const l = (await this.rows(db, 'SELECT event_stage_id,event_activity_id FROM event_live_sessions WHERE id = ? AND event_workspace_id = ?', [input.liveSessionId, eventId]))[0];
        if (!l) throw missing();
        grant.live_session_id = input.liveSessionId; grant.activity_id = l.event_activity_id; grant.stage_id = l.event_stage_id;
      }
      await this.resources(db, grant);
      const token = secret();
      await this.insert(db, grant, token);
      await this.domain.audit(db, actor, 'grant.issue', orgId, eventId, grant.id);
      return { grantId: grant.id, eventId, kind, purpose, token, notBefore: grant.not_before.toISOString(), expiresAt: grant.expires_at.toISOString() };
    });
  }

  async register(publicId, name) {
    if (name !== undefined && name !== null) name = textField(name, 120);
    const q = (await this.rows(this.pool, 'SELECT * FROM event_public_qrs WHERE public_id = ? AND active = 1', [publicId]))[0];
    if (!q) throw missing();
    const c = await this.locator(q.event_workspace_id);
    return this.domain.transaction('public.registration', 'participant.admit', async db => {
      const org = (await this.rows(db, "SELECT id FROM event_organizations WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [c.organization_id]))[0];
      if (!org) throw missing();
      // Re-read under the same organization lock used by grant and membership changes.
      const current = (await this.rows(db, `SELECT q.id FROM event_public_qrs q JOIN event_v2_contexts c ON c.event_id = q.event_workspace_id
        WHERE q.id = ? AND q.active = 1 AND q.audience_level = ? AND c.organization_id = ? AND c.enabled = 1`, [q.id, q.audience_level, c.organization_id]))[0];
      if (!current || !['FREE', 'PAID'].includes(q.audience_level)) throw missing();
      const token = secret(), id = crypto.randomUUID(), participantId = crypto.randomUUID();
      const grant = { id, event_id: q.event_workspace_id, kind: 'PARTICIPANT', purpose: 'public',
        participant_id: participantId, public_qr_id: q.id, not_before: this.now(), expires_at: await this.window(db, q.event_workspace_id) };
      await db.execute('INSERT INTO event_participants (id,event_workspace_id,registration_key_hash,audience_level) VALUES (?,?,?,?)',
        [participantId, q.event_workspace_id, hash(token), q.audience_level]);
      await db.execute('INSERT INTO event_participant_identities (participant_id,display_name) VALUES (?,?)', [participantId, name || null]);
      await this.insert(db, grant, token);
      await this.domain.audit(db, 'public.registration', 'participant.admit', c.organization_id, q.event_workspace_id, participantId);
      return { grantId: id, eventId: q.event_workspace_id, participantId, audienceLevel: q.audience_level, token,
        session: await this.createSession(db, grant, this.context(grant, c.organization_id, q.audience_level)),
        notBefore: grant.not_before.toISOString(), expiresAt: grant.expires_at.toISOString() };
    });
  }

  async locator(eventId) {
    const initial = (await this.rows(this.pool, 'SELECT organization_id FROM event_v2_contexts WHERE event_id = ?', [eventId]))[0];
    if (!initial) throw missing();
    return initial;
  }

  async validated(db, eventId, grantId, initial) {
    // Locator reads finish before obtaining the transaction connection. The
    // first transactional read locks the organization: no stale snapshot and
    // no nested pool connection starvation under concurrent handshakes.
    const org = (await this.rows(db, "SELECT id FROM event_organizations WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [initial.organization_id]))[0];
    if (!org) throw denied();
    const g = (await this.rows(db, `SELECT g.*, w.ends_at FROM event_access_grants g
      JOIN event_v2_contexts c ON c.event_id = g.event_id AND c.enabled = 1
      JOIN event_operational_windows w ON w.event_id = g.event_id
      WHERE g.id = ? AND g.event_id = ? AND c.organization_id = ? FOR UPDATE`, [grantId, eventId, initial.organization_id]))[0];
    const now = this.now();
    if (!g || g.revoked_at || g.not_before > now || g.expires_at <= now || g.ends_at <= now) throw denied();
    if (g.issuer_user_id) {
      const versions = await this.issuer(db, initial.organization_id, eventId, g.issuer_user_id, g.kind);
      if (versions.org !== g.issuer_org_version || versions.event !== g.issuer_event_version) throw denied();
    }
    const audienceLevel = await this.resources(db, g);
    return { g, context: this.context(g, initial.organization_id, audienceLevel) };
  }

  context(g, organizationId, audienceLevel) {
    return Object.freeze({ eventId: g.event_id, organizationId, grantId: g.id,
      actorId: g.participant_id || g.id, kind: g.kind, purpose: g.purpose,
      stageId: g.stage_id || null, activityId: g.activity_id || null, liveSessionId: g.live_session_id || null,
      participantId: g.participant_id || null, audienceLevel, expiresAt: g.expires_at.toISOString(),
      authorizationVersion: g.authz_version || 1 });
  }

  async createSession(db, g, context) {
    const sessionToken = secret(), expires = new Date(Math.min(this.now().getTime() + this.sessionTtlMs, g.expires_at.getTime()));
    await db.execute('DELETE FROM event_grant_sessions WHERE grant_id = ? AND expires_at <= ?', [g.id, this.now()]);
    await db.execute('INSERT INTO event_grant_sessions (token_hash,grant_id,expires_at) VALUES (?,?,?)', [hash(sessionToken), g.id, expires]);
    return { context, sessionToken, sessionExpiresAt: expires.toISOString() };
  }

  async exchange(eventId, token) {
    if (!isId(eventId) || !validSecret(token)) throw denied();
    const row = (await this.rows(this.pool, 'SELECT id FROM event_access_grants WHERE event_id = ? AND token_hash = ?', [eventId, hash(token)]))[0];
    if (!row) throw denied();
    const initial = await this.locator(eventId);
    return this.domain.transaction('credential.exchange', 'grant.exchange', async db => {
      const { g, context } = await this.validated(db, eventId, row.id, initial);
      return this.createSession(db, g, context);
    });
  }

  async withBrowser({ eventId, grantId, token }, callback = context => context) {
    if (!isId(eventId) || !isId(grantId) || !validSecret(token)) throw denied();
    const initial = await this.locator(eventId);
    return this.domain.transaction('credential.browser', 'grant.browser', async db => {
      const { g, context } = await this.validated(db, eventId, grantId, initial);
      if (!crypto.timingSafeEqual(Buffer.from(hash(token)), Buffer.from(g.token_hash))) throw denied();
      return callback(context, db, g);
    });
  }

  async withSession({ eventId, grantId, sessionToken }, callback = context => context) {
    if (!isId(eventId) || !isId(grantId) || !validSecret(sessionToken)) throw denied();
    const initial = await this.locator(eventId);
    return this.domain.transaction('credential.session', 'grant.session', async db => {
      const { g, context } = await this.validated(db, eventId, grantId, initial);
      const s = (await this.rows(db, 'SELECT expires_at FROM event_grant_sessions WHERE token_hash = ? AND grant_id = ? FOR UPDATE', [hash(sessionToken), grantId]))[0];
      if (!s || s.expires_at <= this.now()) throw denied();
      return callback(Object.freeze({ ...context, sessionExpiresAt: s.expires_at.toISOString() }), db, g);
    });
  }

  async renew(credentials) {
    return this.withSession(credentials, async (context, db, g) => {
      const expires = new Date(Math.min(this.now().getTime() + this.sessionTtlMs, g.expires_at.getTime()));
      await db.execute('UPDATE event_grant_sessions SET expires_at = ? WHERE token_hash = ? AND grant_id = ?', [expires, hash(credentials.sessionToken), g.id]);
      return { ...context, sessionExpiresAt: expires.toISOString() };
    });
  }

  async revoke(actor, orgId, eventId, grantId) {
    return this.domain.transaction(actor, 'grant.revoke', async db => {
      await this.domain.event(db, orgId, eventId, actor, 'event.members.manage');
      const row = (await this.rows(db, 'SELECT id FROM event_access_grants WHERE id = ? AND event_id = ? FOR UPDATE', [grantId, eventId]))[0];
      if (!row) throw missing();
      await db.execute('UPDATE event_access_grants SET revoked_at = ?, authz_version = authz_version + 1 WHERE id = ? AND revoked_at IS NULL', [this.now(), grantId]);
      await this.domain.audit(db, actor, 'grant.revoke', orgId, eventId, grantId);
      return { grantId, revoked: true };
    });
  }
}

module.exports = { EventGrantRepository, SESSION_TTL_MS, hash, validSecret, utcInstant, isId };
