const { EventAccessError } = require('./authorization');
const { normalizePolls } = require('./poll-runtime');
const { normalizeKnowledge } = require('./knowledge-runtime');
const { normalizeRaffles } = require('./raffle-runtime');
const { normalizeGames } = require('./game-runtime');
const { digest } = require('./deck-private-store');
const MAX_CONFIGURATION_BYTES = 1024 * 1024;
const invalid = () => { throw new EventAccessError('INVALID_CONFIGURATION', 400); };
const integrity = () => { throw new EventAccessError('CONFIGURATION_INTEGRITY_FAILED', 409); };
function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) invalid();
}
function array(value, max) { if (!Array.isArray(value) || value.length > max) invalid(); }
function string(value, max) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) invalid();
}
function translation(value, options) {
  if (value === undefined) return;
  fields(value, ['prompt', 'options']);
  if (value.prompt !== undefined) string(value.prompt, 2000);
  if (value.options !== undefined) {
    fields(value.options, options.map(o => o.id));
    for (const label of Object.values(value.options)) string(label, 500);
  }
}
function options(list, max, correct = false) {
  array(list, max);
  for (const o of list) {
    fields(o, correct ? ['id', 'label', 'correct'] : ['id', 'label'], ['id', 'label']);
    string(o.id, 120); string(o.label, 500);
    if (o.correct !== undefined && typeof o.correct !== 'boolean') invalid();
  }
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
}

// The established engines normalize the supported text catalogs. Explicit
// input allowlists prevent silently accepting legacy URLs, assets or runtime
// state. Binary media and translated slide images need private upload first.
function normalizeConfiguration(input, slideCount) {
  fields(input, ['slides', 'polls', 'knowledge', 'raffles', 'games'], ['slides', 'polls', 'knowledge', 'raffles', 'games']);
  let raw;
  try { raw = JSON.stringify(input); } catch (_) { invalid(); }
  if (Buffer.byteLength(raw) > MAX_CONFIGURATION_BYTES) throw new EventAccessError('CONFIGURATION_TOO_LARGE', 413);
  array(input.slides, 500);
  if (input.slides.length !== slideCount || slideCount < 1) invalid();
  for (const name of ['polls', 'knowledge', 'raffles']) array(input[name], 500);
  array(input.games, 2);
  for (const p of input.polls) {
    fields(p, ['id', 'type', 'title', 'prompt', 'options', 'en'], ['id', 'type', 'title', 'prompt', 'options']);
    string(p.id, 120); string(p.title, 1000); string(p.prompt, 2000); options(p.options, 20); translation(p.en, p.options);
  }
  for (const k of input.knowledge) {
    fields(k, ['id', 'category', 'title', 'titleEn', 'identificationMode', 'questionDurationSeconds', 'durationSeconds', 'questions'],
      ['id', 'category', 'title', 'identificationMode', 'questions']);
    string(k.id, 96); string(k.title, 240); if (k.titleEn !== undefined) string(k.titleEn, 240);
    if (k.questionDurationSeconds !== undefined) { if (k.category !== 'contest') invalid(); integer(k.questionDurationSeconds, 5, 300); }
    if (k.durationSeconds !== undefined) { if (k.category !== 'assessment') invalid(); integer(k.durationSeconds, 30, 10800); }
    array(k.questions, 100);
    for (const q of k.questions) {
      fields(q, ['id', 'prompt', 'options', 'correctOptionId', 'en'], ['id', 'prompt', 'options']);
      string(q.id, 96); string(q.prompt, 2000); options(q.options, 6, true); translation(q.en, q.options);
      if (q.correctOptionId !== undefined) string(q.correctOptionId, 96);
    }
  }
  for (const r of input.raffles) {
    fields(r, ['id', 'mode', 'title', 'prompt', 'options', 'entryKey'], ['id', 'mode', 'title', 'prompt', 'options']);
    string(r.id, 96); string(r.title, 240); string(r.prompt, 2000); options(r.options, 20);
    if (r.entryKey !== undefined) { string(r.entryKey, 96); if (r.mode !== 'visual_key' && r.entryKey !== '') invalid(); }
  }
  for (const g of input.games) { fields(g, ['id', 'durationMs'], ['id', 'durationMs']); }
  let catalogs;
  try { catalogs = { polls: normalizePolls(input.polls), knowledge: normalizeKnowledge(input.knowledge),
    raffles: normalizeRaffles(input.raffles), games: normalizeGames(input.games) }; }
  catch (_) { invalid(); }
  const seen = new Set();
  for (const rows of Object.values(catalogs)) for (const item of rows) {
    if (seen.has(item.id)) invalid(); seen.add(item.id);
  }
  const slides = input.slides.map((s, index) => {
    fields(s, ['id', 'notes', 'pollIds', 'knowledgeIds', 'raffleIds', 'gameIds'], ['id', 'notes']);
    if (s.id !== 'slide-' + String(index + 1).padStart(3, '0')) invalid();
    fields(s.notes, ['es'], ['es']); string(s.notes.es, 8000);
    const out = { id: s.id, notes: { es: s.notes.es } };
    for (const [field, name] of [['pollIds', 'polls'], ['knowledgeIds', 'knowledge'], ['raffleIds', 'raffles'], ['gameIds', 'games']]) {
      const ids = s[field] ?? []; array(ids, catalogs[name].length);
      if (new Set(ids).size !== ids.length || ids.some(id => !catalogs[name].some(item => item.id === id))) invalid();
      out[field] = [...ids];
    }
    return out;
  });
  return { slides, ...catalogs };
}

class EventDeckConfigurationService {
  constructor({ preparations }) { this.preparations = preparations; this.domain = preparations.domain; }
  async source(db, scope) {
    const row = await this.preparations.row(db, scope);
    if (!row || row.status !== 'CONVERTED') throw new EventAccessError('PREPARATION_NOT_READY', 409);
    let manifest;
    try { manifest = JSON.parse(row.manifestJson); } catch (_) { integrity(); }
    if (!manifest || digest(row.manifestJson) !== row.manifestDigest || manifest.schema !== 1
      || ['eventId', 'deckId', 'versionId', 'attemptId'].some(k => manifest[k] !== row[k])
      || manifest.source?.size !== row.sourceSize || manifest.source?.sha256 !== row.sourceSha256
      || !Array.isArray(manifest.slides) || manifest.slides.length !== row.slideCount) integrity();
    for (const [i, slide] of manifest.slides.entries()) {
      if (slide?.id !== 'slide-' + String(i + 1).padStart(3, '0')) integrity();
    }
    return row;
  }
  async row(db, scope) {
    const [rows] = await db.execute(`SELECT source_manifest_digest AS sourceDigest,
      configuration_digest AS configurationDigest, configuration_json AS configurationJson
      FROM event_deck_configurations WHERE event_id=? AND deck_id=? AND version_id=? FOR UPDATE`,
    [scope.eventId, scope.deckId, scope.versionId]);
    return rows[0];
  }
  view(row, source, scope) {
    if (!row) return { status: 'NOT_CONFIGURED' };
    let configuration;
    try { configuration = JSON.parse(row.configurationJson); } catch (_) { integrity(); }
    if (Buffer.byteLength(row.configurationJson) > MAX_CONFIGURATION_BYTES || digest(row.configurationJson) !== row.configurationDigest
      || !configuration || row.sourceDigest !== source.manifestDigest || configuration.sourceManifestDigest !== source.manifestDigest
      || !configuration || configuration.slideCount !== source.slideCount || configuration.schema !== 1
      || ['eventId', 'deckId', 'versionId'].some(k => configuration[k] !== scope[k])) integrity();
    return { status: 'CONFIGURED_PENDING_DECK_CHECK', configurationDigest: row.configurationDigest, configuration };
  }
  async get(actor, scope) {
    return this.domain.transaction(actor, 'deck.configuration.read', async db => {
      await this.preparations.scoped(db, actor, scope);
      const row = await this.row(db, scope);
      const result = row ? this.view(row, await this.source(db, scope), scope) : { status: 'NOT_CONFIGURED' };
      this.preparations.checkEnabled(); return result;
    });
  }
  async create(actor, scope, input) {
    return this.domain.transaction(actor, 'deck.configuration.create', async db => {
      // Same organization lock as membership changes and competing writers.
      await this.preparations.scoped(db, actor, scope);
      if (await this.row(db, scope)) throw new EventAccessError('VERSION_CONFIGURATION_EXISTS', 409);
      const source = await this.source(db, scope), normalized = normalizeConfiguration(input, source.slideCount);
      const configuration = { schema: 1, eventId: scope.eventId, deckId: scope.deckId, versionId: scope.versionId,
        sourceManifestDigest: source.manifestDigest, slideCount: source.slideCount, ...normalized };
      const json = JSON.stringify(configuration);
      if (Buffer.byteLength(json) > MAX_CONFIGURATION_BYTES) throw new EventAccessError('CONFIGURATION_TOO_LARGE', 413);
      const configurationDigest = digest(json);
      await db.execute(`INSERT INTO event_deck_configurations
        (version_id,event_id,deck_id,source_manifest_digest,configuration_digest,configuration_json,created_by_user_id)
        VALUES (?,?,?,?,?,?,?)`, [scope.versionId, scope.eventId, scope.deckId, source.manifestDigest, configurationDigest, json, actor]);
      await this.domain.audit(db, actor, 'deck.configuration.create', scope.organizationId, scope.eventId, scope.versionId);
      this.preparations.checkEnabled();
      return this.view({ sourceDigest: source.manifestDigest, configurationDigest, configurationJson: json }, source, scope);
    });
  }
}
module.exports = { EventDeckConfigurationService, normalizeConfiguration, MAX_CONFIGURATION_BYTES };
