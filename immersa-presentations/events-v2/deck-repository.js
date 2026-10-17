const crypto = require('node:crypto');
const { EventAccessError, textField } = require('./authorization');
const { isId } = require('./grant-repository');

// Deck identity belongs to an event, never to a personal workspace. These
// records reserve draft versions; they are not executable preparations.
class EventDeckRepository {
  constructor(domain) { this.domain = domain; }

  async scopedDeck(db, eventId, deckId) {
    if (!isId(deckId)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT id, event_id AS eventId, title FROM event_decks
      WHERE event_id = ? AND id = ? FOR UPDATE`, [eventId, deckId]);
    if (!rows[0]) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    return rows[0];
  }

  async insertVersion(db, actor, organizationId, eventId, deckId, number) {
    const version = { id: crypto.randomUUID(), eventId, deckId, number, status: 'DRAFT' };
    await db.execute(`INSERT INTO event_deck_versions
      (id, event_id, deck_id, version_number, created_by_user_id) VALUES (?, ?, ?, ?, ?)`,
    [version.id, eventId, deckId, number, actor]);
    await this.domain.audit(db, actor, 'deck.version.create', organizationId, eventId, version.id);
    return version;
  }

  async create(actor, organizationId, eventId, title) {
    title = textField(title);
    return this.domain.transaction(actor, 'deck.create', async db => {
      await this.domain.event(db, organizationId, eventId, actor, 'content.prepare');
      const id = crypto.randomUUID();
      await db.execute(`INSERT INTO event_decks (id, event_id, title, created_by_user_id)
        VALUES (?, ?, ?, ?)`, [id, eventId, title, actor]);
      const version = await this.insertVersion(db, actor, organizationId, eventId, id, 1);
      await this.domain.audit(db, actor, 'deck.create', organizationId, eventId, id);
      return { id, eventId, title, version };
    });
  }

  async list(actor, organizationId, eventId) {
    return this.domain.transaction(actor, 'deck.list', async db => {
      await this.domain.event(db, organizationId, eventId, actor, 'content.prepare');
      const [decks] = await db.execute(`SELECT id, event_id AS eventId, title FROM event_decks
        WHERE event_id = ? ORDER BY created_at, id`, [eventId]);
      return { decks };
    });
  }

  async get(actor, organizationId, eventId, deckId) {
    return this.domain.transaction(actor, 'deck.read', async db => {
      await this.domain.event(db, organizationId, eventId, actor, 'content.prepare');
      const deck = await this.scopedDeck(db, eventId, deckId);
      const [versions] = await db.execute(`SELECT id, event_id AS eventId, deck_id AS deckId,
        version_number AS number, status FROM event_deck_versions
        WHERE event_id = ? AND deck_id = ? ORDER BY version_number`, [eventId, deckId]);
      return { ...deck, versions };
    });
  }

  async createVersion(actor, organizationId, eventId, deckId) {
    return this.domain.transaction(actor, 'deck.version.create', async db => {
      // Membership mutations take this same organization lock. Numbering and
      // authorization remain serialized even across multiple app instances.
      await this.domain.event(db, organizationId, eventId, actor, 'content.prepare');
      await this.scopedDeck(db, eventId, deckId);
      const [rows] = await db.execute(`SELECT MAX(version_number) AS lastNumber FROM event_deck_versions
        WHERE event_id = ? AND deck_id = ?`, [eventId, deckId]);
      const number = Number(rows[0].lastNumber || 0) + 1;
      if (!Number.isSafeInteger(number) || number > 4294967295) throw new EventAccessError('VERSION_LIMIT_REACHED', 409);
      return this.insertVersion(db, actor, organizationId, eventId, deckId, number);
    });
  }
}

module.exports = { EventDeckRepository };
