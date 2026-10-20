const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {normalizeProfileInput, PUBLIC_TITLES} = require('./auth/profile-repository');

const TITLES = Object.freeze([...PUBLIC_TITLES, 'Panelista', 'Moderador', 'Moderadora']);
const profileId = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
class DeckSpeakerError extends Error {
  constructor(code, message, statusCode = 400) { super(message); Object.assign(this, {code, statusCode}); }
}
const fail = (code, text, status) => { throw new DeckSpeakerError(code, text, status); };
function deckKey(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,190}$/i.test(value)) fail('INVALID_DECK_ID', 'Deck inválido.');
  return value;
}
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('INVALID_FIELDS', 'Revisa los campos del perfil.');
}
function normalized(input) {
  const publicTitle = input.publicTitle || 'Speaker';
  if (!TITLES.includes(publicTitle)) fail('INVALID_PUBLIC_TITLE', 'Selecciona una etiqueta válida.');
  if (typeof input.active !== 'boolean') fail('INVALID_ACTIVE', 'Indica si el perfil está visible.');
  return {...normalizeProfileInput({...input, publicTitle:'Speaker'}), publicTitle, active:input.active};
}
function photoKey(value) { return typeof value === 'string' && /^photo-[a-f0-9-]{36}\.(png|jpg|webp)$/.test(value) ? value : ''; }
const empty = deckId => ({schema:1, deckId, revision:0, enabled:false, profiles:[]});

// Pilot storage is independent of account profiles and the Event v2 model.
// One writer per attached Railway volume; revisions reject stale editors.
class DeckSpeakersStore {
  constructor({root, assertDeck, onChange = () => {}}) {
    this.root = path.resolve(root); this.assertDeck = assertDeck; this.onChange = onChange; this.locks = new Map();
  }
  directory(id) { return path.join(this.root, deckKey(id)); }
  async lock(id, action) {
    const previous = this.locks.get(id) || Promise.resolve(); let release;
    const current = new Promise(resolve => { release = resolve; }), chain = previous.then(() => current);
    this.locks.set(id, chain); await previous;
    try { return await action(); } finally { release(); if (this.locks.get(id) === chain) this.locks.delete(id); }
  }
  async read(id) {
    id = deckKey(id); await this.assertDeck(id);
    let bytes;
    try { bytes = await fs.readFile(path.join(this.directory(id), 'profiles.json')); }
    catch (error) { if (error.code === 'ENOENT') return empty(id); throw error; }
    if (bytes.length > 4 * 1024 * 1024) fail('INVALID_PROFILE_CONFIG', 'No se pudo leer la configuración.', 503);
    let config;
    try { config = JSON.parse(bytes); } catch (_) { fail('INVALID_PROFILE_CONFIG', 'No se pudo leer la configuración.', 503); }
    if (config.schema !== 1 || config.deckId !== id || !Number.isSafeInteger(config.revision) || config.revision < 0 || typeof config.enabled !== 'boolean' || !Array.isArray(config.profiles)) fail('INVALID_PROFILE_CONFIG', 'No se pudo leer la configuración.', 503);
    const ids = new Set();
    config.profiles = config.profiles.map(p => {
      if (!profileId(p.id) || ids.has(p.id) || (p.photoKey && !photoKey(p.photoKey))) fail('INVALID_PROFILE_CONFIG', 'No se pudo leer la configuración.', 503);
      ids.add(p.id); return {...normalized(p), id:p.id, photoKey:p.photoKey || ''};
    });
    return config;
  }
  async write(config) {
    const bytes = JSON.stringify(config); if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) fail('PROFILE_STORAGE_LIMIT', 'La configuración de perfiles es demasiado grande.', 413);
    const directory = this.directory(config.deckId); await fs.mkdir(directory, {recursive:true, mode:0o700});
    const temporary = path.join(directory, 'pending-' + crypto.randomUUID());
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, path.join(directory, 'profiles.json'));
    } finally { await fs.rm(temporary, {force:true}); }
  }
  async change(id, expectedRevision, action) {
    id = deckKey(id);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_REVISION', 'Actualiza la lista antes de guardar.');
    return this.lock(id, async () => {
      const config = await this.read(id);
      if (config.revision !== expectedRevision) fail('PROFILE_REVISION_CONFLICT', 'Los perfiles cambiaron en otra ventana. Actualiza la lista y vuelve a guardar.', 409);
      if (config.revision >= Number.MAX_SAFE_INTEGER) fail('PROFILE_REVISION_LIMIT', 'No se puede actualizar la configuración.', 409);
      await action(config); config.revision++; await this.write(config);
      // Notification failure cannot turn a committed write into an apparent failure.
      try { this.onChange(id, config.revision); } catch (error) { console.warn('Deck profile notification failed', error.code || 'UNKNOWN'); }
      return this.editor(config);
    });
  }
  editor(config) {
    return {deckId:config.deckId, enabled:config.enabled, revision:config.revision, publicTitles:TITLES,
      profiles:config.profiles.map(({photoKey:key, ...p}) => ({...p, photoUrl:key ? this.photoUrl(config.deckId, p.id, key, true) : ''}))};
  }
  public(config) {
    const profiles = config.enabled ? config.profiles.filter(p => p.active).map(({active,photoKey:key,...p}) => ({...p,photoUrl:key ? this.photoUrl(config.deckId,p.id,key) : ''})) : [];
    return {mode:'multiple', deckId:config.deckId, revision:config.revision, available:profiles.length > 0, profile:profiles[0] || null, profiles};
  }
  photoUrl(id, pid, key, owner = false) { return '/api/decks/' + encodeURIComponent(id) + (owner ? '/speakers/' + pid + '/photo/' : '/speaker-photos/' + pid + '/') + key; }
  setEnabled(id, input) {
    fields(input, ['enabled','expectedRevision']); if (typeof input.enabled !== 'boolean') fail('INVALID_ENABLED', 'Indica si usarás perfiles de este Deck.');
    return this.change(id, input.expectedRevision, config => { config.enabled = input.enabled; });
  }
  save(id, pid, input) {
    fields(input, ['displayName','publicTitle','roleTitle','company','bio','websiteUrl','linkedinUrl','instagramUrl','active','expectedRevision']);
    const profile = normalized(input); if (pid !== null && !profileId(pid)) fail('PROFILE_NOT_FOUND','Perfil no encontrado.',404);
    return this.change(id, input.expectedRevision, config => {
      if (pid === null) config.profiles.push({...profile, id:crypto.randomUUID(), photoKey:''});
      else { const p = config.profiles.find(p => p.id === pid); if (!p) fail('PROFILE_NOT_FOUND','Perfil no encontrado.',404); Object.assign(p, profile); }
    });
  }
  setActive(id, pid, input) {
    fields(input, ['active','expectedRevision']); if (typeof input.active !== 'boolean' || !profileId(pid)) fail('INVALID_ACTIVE','Revisa el perfil.');
    return this.change(id, input.expectedRevision, config => { const p = config.profiles.find(p => p.id === pid); if (!p) fail('PROFILE_NOT_FOUND','Perfil no encontrado.',404); p.active = input.active; });
  }
  reorder(id, input) {
    fields(input, ['profileIds','expectedRevision']);
    if (!Array.isArray(input.profileIds) || input.profileIds.some(id => !profileId(id)) || new Set(input.profileIds).size !== input.profileIds.length) fail('INVALID_ORDER','Revisa el orden de los perfiles.');
    return this.change(id, input.expectedRevision, config => {
      if (input.profileIds.length !== config.profiles.length || input.profileIds.some(id => !config.profiles.some(p => p.id === id))) fail('INVALID_ORDER','Revisa el orden de los perfiles.');
      const byId = new Map(config.profiles.map(p => [p.id,p])); config.profiles = input.profileIds.map(id => byId.get(id));
    });
  }
  async setPhoto(id, pid, expectedRevision, file, extension) {
    if (!profileId(pid)) fail('PROFILE_NOT_FOUND','Perfil no encontrado.',404);
    let written = '';
    try {
      return await this.change(id, expectedRevision, async config => {
        const p = config.profiles.find(p => p.id === pid); if (!p) fail('PROFILE_NOT_FOUND','Perfil no encontrado.',404);
        const key = 'photo-' + crypto.randomUUID() + extension;
        if (!photoKey(key)) fail('INVALID_PHOTO','Foto inválida.');
        await fs.mkdir(this.directory(id), {recursive:true, mode:0o700}); written = path.join(this.directory(id), key);
        await fs.writeFile(written, file, {flag:'wx', mode:0o600}); p.photoKey = key;
      });
    } catch (error) { if (written) await fs.rm(written, {force:true}); throw error; }
  }
  async photo(id, pid, key, owner = false) {
    if (!profileId(pid) || !photoKey(key)) fail('PROFILE_NOT_FOUND','Foto no disponible.',404);
    const config = await this.read(id), p = config.profiles.find(p => p.id === pid && p.photoKey === key);
    if (!p || (!owner && (!config.enabled || !p.active))) fail('PROFILE_NOT_FOUND','Foto no disponible.',404);
    return path.join(this.directory(id), key);
  }
  async removeDeck(id) { return this.lock(deckKey(id), () => fs.rm(this.directory(id), {recursive:true, force:true})); }
}
module.exports = {DeckSpeakersStore, DeckSpeakerError, deckKey, fields, TITLES};
