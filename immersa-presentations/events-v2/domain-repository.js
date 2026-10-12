const crypto = require('node:crypto');
const { EventAccessError, requireCapability, textField } = require('./authorization');

const missing = () => new EventAccessError('RESOURCE_NOT_FOUND', 404);

class EventDomainRepository {
  constructor(pool) { this.pool = pool; }

  async rows(db, sql, params = []) { return (await db.execute(sql, params))[0]; }

  async audit(db, actor, action, organizationId = null, eventId = null, resourceId = null, outcome = 'ALLOWED') {
    await db.execute(`INSERT INTO event_security_audit
      (id, organization_id, event_id, actor_user_id, action, outcome, resource_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), organizationId, eventId, actor, action, outcome, resourceId]);
  }

  async transaction(actor, action, operation) {
    const db = await this.pool.getConnection();
    try {
      await db.beginTransaction();
      const result = await operation(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      if (error instanceof EventAccessError) {
        await this.audit(db, actor, action, null, null, null, 'DENIED');
      }
      if (error.code === 'ER_DUP_ENTRY') throw new EventAccessError('RESOURCE_CONFLICT', 409);
      throw error;
    } finally { db.release(); }
  }

  async user(db, userId) {
    const rows = await this.rows(db, 'SELECT id FROM `user` WHERE id = ? AND emailVerified = 1 LIMIT 1', [userId]);
    if (!rows.length) throw missing();
  }

  async organization(db, organizationId, actor, admin = false) {
    // All v2 access locks the organization first. Membership changes use the
    // same lock order, so revocation cannot race a write after authorization.
    const org = (await this.rows(db, 'SELECT * FROM event_organizations WHERE id = ? FOR UPDATE', [organizationId]))[0];
    if (!org || org.status !== 'ACTIVE') throw missing();
    const member = (await this.rows(db, `SELECT role FROM event_organization_memberships
      WHERE organization_id = ? AND user_id = ? AND active = 1`, [organizationId, actor]))[0];
    if (!member) throw missing();
    if (admin && member.role !== 'ADMIN') throw new EventAccessError('ORGANIZATION_PERMISSION_DENIED');
    return org;
  }

  async event(db, organizationId, eventId, actor, capability = 'event.read') {
    await this.organization(db, organizationId, actor);
    const event = (await this.rows(db, `SELECT c.event_id, c.organization_id, c.authz_version,
      h.slug, h.title, h.timezone, h.status FROM event_v2_contexts c
      JOIN event_hubs h ON h.workspace_id = c.event_id
      JOIN event_memberships m ON m.event_id = c.event_id AND m.organization_id = c.organization_id
      WHERE c.event_id = ? AND c.organization_id = ? AND c.enabled = 1
        AND m.user_id = ? AND m.active = 1 FOR UPDATE`, [eventId, organizationId, actor]))[0];
    if (!event) throw missing();
    const roles = (await this.rows(db, 'SELECT role FROM event_member_roles WHERE event_id = ? AND user_id = ?', [eventId, actor])).map(row => row.role);
    requireCapability({ roles }, capability);
    return { ...event, roles };
  }

  async createOrganization(actor, { name, adminUserId, createEventsEnabled = false }) {
    if (typeof createEventsEnabled !== 'boolean') throw new EventAccessError('INVALID_INPUT', 400);
    return this.transaction(actor, 'organization.create', async db => {
      await this.user(db, textField(adminUserId));
      const id = crypto.randomUUID();
      await db.execute(`INSERT INTO event_organizations (id, name, created_by_user_id, create_events_enabled)
        VALUES (?, ?, ?, ?)`, [id, textField(name), actor, createEventsEnabled]);
      await db.execute(`INSERT INTO event_organization_memberships (organization_id, user_id, role)
        VALUES (?, ?, 'ADMIN')`, [id, adminUserId]);
      await this.audit(db, actor, 'organization.create', id, null, id);
      return { id, name: name.trim(), createEventsEnabled };
    });
  }

  async setCreationEnabled(actor, organizationId, enabled) {
    if (typeof enabled !== 'boolean') throw new EventAccessError('INVALID_INPUT', 400);
    return this.transaction(actor, 'organization.creation.enable', async db => {
      const org = (await this.rows(db, 'SELECT id FROM event_organizations WHERE id = ? FOR UPDATE', [organizationId]))[0];
      if (!org) throw missing();
      await db.execute('UPDATE event_organizations SET create_events_enabled = ?, authz_version = authz_version + 1 WHERE id = ?', [enabled, organizationId]);
      await this.audit(db, actor, 'organization.creation.enable', organizationId, null, organizationId);
      return { id: organizationId, createEventsEnabled: enabled };
    });
  }

  async listOrganizations(actor) {
    return this.rows(this.pool, `SELECT o.id, o.name, o.create_events_enabled AS createEventsEnabled, m.role
      FROM event_organizations o JOIN event_organization_memberships m ON m.organization_id = o.id
      WHERE m.user_id = ? AND m.active = 1 AND o.status = 'ACTIVE' ORDER BY o.name`, [actor]);
  }

  async getOrganization(actor, organizationId) {
    return this.transaction(actor, 'organization.read', async db => {
      const org = await this.organization(db, organizationId, actor);
      return { id: org.id, name: org.name, createEventsEnabled: Boolean(org.create_events_enabled) };
    });
  }

  async setOrganizationMember(actor, organizationId, userId, role) {
    if (role !== null && !['ADMIN', 'MEMBER'].includes(role)) throw new EventAccessError('INVALID_ROLE', 400);
    return this.transaction(actor, 'organization.member.change', async db => {
      await this.organization(db, organizationId, actor, true);
      await this.user(db, userId);
      const current = (await this.rows(db, `SELECT role, active FROM event_organization_memberships
        WHERE organization_id = ? AND user_id = ?`, [organizationId, userId]))[0];
      if (current?.active && current.role === 'ADMIN' && role !== 'ADMIN') {
        const admins = await this.rows(db, `SELECT user_id FROM event_organization_memberships
          WHERE organization_id = ? AND active = 1 AND role = 'ADMIN'`, [organizationId]);
        if (admins.length < 2) throw new EventAccessError('LAST_ORGANIZATION_ADMIN', 409);
      }
      // Losing organization membership must not silently remove the last
      // active event administrator. Transfer responsibility first.
      if (role === null && current?.active) {
        const stranded = await this.rows(db, `SELECT r.event_id FROM event_member_roles r
          JOIN event_memberships m ON m.event_id = r.event_id AND m.user_id = r.user_id
          WHERE r.user_id = ? AND m.organization_id = ? AND r.role = 'ADMIN' AND m.active = 1
          AND NOT EXISTS (SELECT 1 FROM event_member_roles other
            JOIN event_memberships om ON om.event_id = other.event_id AND om.user_id = other.user_id
            JOIN event_organization_memberships oo ON oo.organization_id = om.organization_id AND oo.user_id = om.user_id
            WHERE other.event_id = r.event_id AND other.role = 'ADMIN' AND other.user_id <> ?
              AND om.active = 1 AND oo.active = 1)`, [userId, organizationId, userId]);
        if (stranded.length) throw new EventAccessError('LAST_EVENT_ADMIN', 409);
      }
      if (role === null) {
        await db.execute(`UPDATE event_organization_memberships SET active = 0, authz_version = authz_version + 1
          WHERE organization_id = ? AND user_id = ?`, [organizationId, userId]);
        await db.execute(`UPDATE event_memberships SET active = 0, authz_version = authz_version + 1
          WHERE organization_id = ? AND user_id = ?`, [organizationId, userId]);
      } else {
        await db.execute(`INSERT INTO event_organization_memberships (organization_id, user_id, role)
          VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role), active = 1, authz_version = authz_version + 1`, [organizationId, userId, role]);
      }
      await this.audit(db, actor, 'organization.member.change', organizationId, null, userId);
      return { userId, role, active: role !== null };
    });
  }

  async createEvent(actor, organizationId, { title, slug, timezone = 'America/Mexico_City' }) {
    title = textField(title); slug = textField(slug, 96); timezone = textField(timezone, 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new EventAccessError('INVALID_SLUG', 400);
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch (_) { throw new EventAccessError('INVALID_TIMEZONE', 400); }
    return this.transaction(actor, 'event.create', async db => {
      const org = await this.organization(db, organizationId, actor, true);
      if (!org.create_events_enabled) throw new EventAccessError('EVENT_CREATION_NOT_ENABLED');
      const id = crypto.randomUUID();
      await db.execute("INSERT INTO workspaces (id, kind, personal_owner_user_id, plan) VALUES (?, 'event', NULL, 'FREE')", [id]);
      await db.execute(`INSERT INTO event_hubs (workspace_id, slug, title, timezone, created_by_user_id)
        VALUES (?, ?, ?, ?, ?)`, [id, slug, title, timezone, actor]);
      await db.execute('INSERT INTO event_v2_contexts (event_id, organization_id) VALUES (?, ?)', [id, organizationId]);
      await db.execute('INSERT INTO event_memberships (event_id, organization_id, user_id) VALUES (?, ?, ?)', [id, organizationId, actor]);
      await db.execute("INSERT INTO event_member_roles (event_id, user_id, role) VALUES (?, ?, 'ADMIN')", [id, actor]);
      await this.audit(db, actor, 'event.create', organizationId, id, id);
      return { eventId: id, organizationId, title, slug, timezone, status: 'DRAFT' };
    });
  }

  async listEvents(actor, organizationId) {
    return this.transaction(actor, 'event.list', async db => {
      await this.organization(db, organizationId, actor);
      return this.rows(db, `SELECT c.event_id AS eventId, h.title, h.slug, h.timezone, h.status
        FROM event_v2_contexts c JOIN event_hubs h ON h.workspace_id = c.event_id
        JOIN event_memberships m ON m.event_id = c.event_id
        WHERE c.organization_id = ? AND c.enabled = 1 AND m.user_id = ? AND m.active = 1
        AND EXISTS (SELECT 1 FROM event_member_roles r WHERE r.event_id = m.event_id AND r.user_id = m.user_id)
        ORDER BY h.created_at DESC`, [organizationId, actor]);
    });
  }

  async getEvent(actor, organizationId, eventId) {
    return this.transaction(actor, 'event.read', db => this.event(db, organizationId, eventId, actor));
  }

  async updateEvent(actor, organizationId, eventId, title) {
    title = textField(title);
    return this.transaction(actor, 'event.configure', async db => {
      await this.event(db, organizationId, eventId, actor, 'event.configure');
      await db.execute('UPDATE event_hubs SET title = ? WHERE workspace_id = ?', [title, eventId]);
      await this.audit(db, actor, 'event.configure', organizationId, eventId, eventId);
      return { eventId, title };
    });
  }

  async setEventMember(actor, organizationId, eventId, userId, roles) {
    if (roles !== null && (!Array.isArray(roles) || !roles.length
      || new Set(roles).size !== roles.length || roles.some(role => !['ADMIN', 'PRODUCER'].includes(role)))) {
      throw new EventAccessError('INVALID_ROLES', 400);
    }
    return this.transaction(actor, 'event.member.change', async db => {
      await this.event(db, organizationId, eventId, actor, 'event.members.manage');
      const target = (await this.rows(db, `SELECT user_id FROM event_organization_memberships
        WHERE organization_id = ? AND user_id = ? AND active = 1`, [organizationId, userId]))[0];
      if (!target) throw missing();
      const existingAdmin = (await this.rows(db, `SELECT r.user_id FROM event_member_roles r
        JOIN event_memberships m ON m.event_id = r.event_id AND m.user_id = r.user_id
        WHERE r.event_id = ? AND r.user_id = ? AND r.role = 'ADMIN' AND m.active = 1`, [eventId, userId])).length;
      if (existingAdmin && !roles?.includes('ADMIN')) {
        const admins = await this.rows(db, `SELECT r.user_id FROM event_member_roles r
          JOIN event_memberships m ON m.event_id = r.event_id AND m.user_id = r.user_id
          JOIN event_organization_memberships om ON om.organization_id = m.organization_id AND om.user_id = m.user_id
          WHERE r.event_id = ? AND r.role = 'ADMIN' AND m.active = 1 AND om.active = 1`, [eventId]);
        if (admins.length < 2) throw new EventAccessError('LAST_EVENT_ADMIN', 409);
      }
      await db.execute(`INSERT INTO event_memberships (event_id, organization_id, user_id, active)
        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE active = VALUES(active), authz_version = authz_version + 1`, [eventId, organizationId, userId, roles !== null]);
      await db.execute('DELETE FROM event_member_roles WHERE event_id = ? AND user_id = ?', [eventId, userId]);
      for (const role of roles || []) await db.execute('INSERT INTO event_member_roles (event_id, user_id, role) VALUES (?, ?, ?)', [eventId, userId, role]);
      await this.audit(db, actor, 'event.member.change', organizationId, eventId, userId);
      return { userId, roles: roles || [], active: roles !== null };
    });
  }

  async getActivity(actor, organizationId, eventId, activityId) {
    return this.transaction(actor, 'activity.read', async db => {
      await this.event(db, organizationId, eventId, actor);
      const row = (await this.rows(db, `SELECT a.id, a.title, a.status, a.event_workspace_id AS eventId
        FROM event_activities a JOIN event_stages s ON s.id = a.event_stage_id AND s.event_workspace_id = a.event_workspace_id
        WHERE a.id = ? AND a.event_workspace_id = ?`, [activityId, eventId]))[0];
      if (!row) throw missing();
      return row;
    });
  }
}

module.exports = { EventDomainRepository };
