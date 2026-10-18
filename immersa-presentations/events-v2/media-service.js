const crypto = require('node:crypto');
const { EventAccessError, textField } = require('./authorization');
const { isId } = require('./grant-repository');
const { EventMediaPrivateStore, MAX_MEDIA_BYTES } = require('./media-private-store');
const { digest } = require('./deck-private-store');
const { EventImagePrivateStore, MAX_IMAGE_BYTES } = require('./image-private-store');
const { normalizeAV } = require('./av-runtime');
class EventMediaService {
  constructor({ preparations, root, forbiddenRoots, store, imagePreparation = false, admission = null }) {
    this.preparations = preparations; this.domain = preparations.domain;
    // This policy is selected only by server construction, never request fields.
    this.kind = imagePreparation ? 'image' : 'media'; this.collection = imagePreparation ? 'images' : 'media';
    this.table = imagePreparation ? 'event_deck_images' : 'event_deck_media';
    this.maxBytes = imagePreparation ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
    this.versionBytes = imagePreparation ? 256 * 1024 * 1024 : 1024 * 1024 * 1024;
    this.code = code => imagePreparation ? code.replace('MEDIA', 'IMAGE') : code;
    this.store = store || new (imagePreparation ? EventImagePrivateStore : EventMediaPrivateStore)({ root, forbiddenRoots });
    this.admission = admission; this.uploads = 0;
  }
  async scoped(db, actor, scope, writable = false) {
    await this.preparations.scoped(db, actor, scope);
    if (writable) {
      const [rows] = await db.execute('SELECT version_id FROM event_deck_configurations WHERE version_id=?', [scope.versionId]);
      if (rows.length) throw new EventAccessError('VERSION_CONFIGURATION_EXISTS', 409);
    }
  }
  async authorize(actor, scope) { return this.domain.transaction(actor, 'deck.'+this.kind+'.authorize', db => this.scoped(db, actor, scope, true)); }
  acquireUpload() {
    const budget = this.admission || this;
    if (budget.uploads >= 2) throw new EventAccessError(this.code('MEDIA_UPLOAD_BUSY'), 429);
    budget.uploads++; let released = false; return () => { if (!released) { released = true; budget.uploads--; } };
  }
  async rows(db, scope, id = null) {
    if (id !== null && !isId(id)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT id,event_id AS eventId,deck_id AS deckId,version_id AS versionId,status,
      source_size AS size,source_sha256 AS sha256,metadata_json AS metadataJson,metadata_digest AS metadataDigest,error_code AS errorCode
      FROM ${this.table} WHERE event_id=? AND deck_id=? AND version_id=?${id ? ' AND id=?' : ''} ORDER BY created_at,id`,
    [scope.eventId,scope.deckId,scope.versionId,...(id ? [id] : [])]); return rows;
  }
  metadata(row) {
    if (row.status !== 'READY') return { id: row.id, status: row.status, errorCode: row.errorCode };
    let data; try { data = JSON.parse(row.metadataJson); } catch (_) { throw new EventAccessError(this.code('MEDIA_INTEGRITY_FAILED'), 409); }
    if (!data || digest(row.metadataJson) !== row.metadataDigest || data.schema !== 1
      || ['id','eventId','deckId','versionId','size','sha256'].some(k => data[k] !== row[k])) throw new EventAccessError(this.code('MEDIA_INTEGRITY_FAILED'), 409);
    if (this.kind === 'image' && (data.type !== 'image' || !['image/png','image/jpeg','image/webp'].includes(data.contentType)
      || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1
      || data.width > 4096 || data.height > 4096 || !/^[a-f0-9]{64}$/.test(data.sha256)
      || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > this.maxBytes)) throw new EventAccessError('IMAGE_INTEGRITY_FAILED',409);
    return { status: 'READY_PENDING_DECK_CHECK', ...data };
  }
  async list(actor, scope) {
    return this.domain.transaction(actor, 'deck.'+this.kind+'.list', async db => {
      await this.scoped(db,actor,scope); const media = (await this.rows(db,scope)).map(row => this.metadata(row));
      this.preparations.checkEnabled(); return { [this.collection]: media };
    });
  }
  async upload(actor, scope, name, bytes) {
    await this.authorize(actor,scope); name = textField(name,120);
    if (/[\x00-\x1f\x7f]/.test(name)) throw new EventAccessError('INVALID_INPUT',400);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > this.maxBytes) throw new EventAccessError(this.code('INVALID_MEDIA_SIZE'),413);
    const id = crypto.randomUUID(), sourceSha = digest(bytes);
    await this.domain.transaction(actor,'deck.'+this.kind+'.reserve',async db => {
      await this.scoped(db,actor,scope,true);
      const [counts] = await db.execute(`SELECT COUNT(*) AS n,COALESCE(SUM(source_size),0) AS bytes FROM ${this.table} WHERE version_id=?`,[scope.versionId]);
      if (counts[0].n >= 200 || Number(counts[0].bytes)+bytes.length > this.versionBytes) throw new EventAccessError(this.code('VERSION_MEDIA_LIMIT'),413);
      await db.execute(`INSERT INTO ${this.table} (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id)
        VALUES (?,?,?,?,'PROCESSING',?,?,?)`,[id,scope.eventId,scope.deckId,scope.versionId,bytes.length,sourceSha,actor]);
      await this.domain.audit(db,actor,'deck.'+this.kind+'.reserve',scope.organizationId,scope.eventId,id); this.preparations.checkEnabled();
    });
    try {
      const info = await this.store.prepare({ ...scope,id },bytes);
      return await this.domain.transaction(actor,'deck.'+this.kind+'.complete',async db => {
        await this.scoped(db,actor,scope,true);
        const data = { schema:1,id,eventId:scope.eventId,deckId:scope.deckId,versionId:scope.versionId,name,
          size:bytes.length,sha256:sourceSha,...info },json=JSON.stringify(data);
        const [update] = await db.execute(`UPDATE ${this.table} SET status='READY',metadata_json=?,metadata_digest=?,completed_at=CURRENT_TIMESTAMP(3)
          WHERE id=? AND status='PROCESSING'`,[json,digest(json),id]);
        if (update.affectedRows !== 1) throw new EventAccessError(this.code('MEDIA_CONFLICT'),409);
        await this.domain.audit(db,actor,'deck.'+this.kind+'.complete',scope.organizationId,scope.eventId,id); this.preparations.checkEnabled();
        return this.metadata((await this.rows(db,scope,id))[0]);
      });
    } catch (e) {
      const code = e instanceof EventAccessError ? e.code : this.code('MEDIA_PREPARATION_FAILED');
      await this.domain.pool.execute(`UPDATE ${this.table} SET status='FAILED',error_code=?,completed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND status='PROCESSING'`,[code,id]).catch(()=>{});
      if (e instanceof EventAccessError) throw e; throw new EventAccessError(code,503);
    }
  }
  async catalog(db,scope,input) {
    const all = await this.rows(db,scope), resources = input.assetIds.map(id => {
      const row = all.find(r => r.id === id && r.status === 'READY');
      if (!row) throw new EventAccessError(this.code('MEDIA_NOT_READY'),409);
      const m = this.metadata(row);
      return { id:m.id,assetId:m.id,name:m.name,type:m.type,duration:m.duration,size:m.size,sha256:m.sha256,contentType:m.contentType };
    });
    try { return normalizeAV({ resources,playlists:input.playlists }); }
    catch (_) { throw new EventAccessError('INVALID_CONFIGURATION',400); }
  }
  async open(actor,scope,id) {
    const row = await this.domain.transaction(actor,'deck.'+this.kind+'.read',async db => {
      await this.scoped(db,actor,scope); const row=(await this.rows(db,scope,id))[0];
      if (!row) throw new EventAccessError('RESOURCE_NOT_FOUND',404);
      if (row.status !== 'READY') throw new EventAccessError(this.code('MEDIA_NOT_READY'),409);
      const metadata=this.metadata(row); this.preparations.checkEnabled(); return { ...row,metadata };
    });
    const handle=await this.store.verified(row);
    try { this.preparations.checkEnabled(); return { handle,metadata:row.metadata }; }
    catch(e) { await handle.close(); throw e; }
  }
}
class EventImageService extends EventMediaService {
  constructor(options) { super({ ...options, imagePreparation: true }); }
  async descriptors(db, scope, ids) {
    const rows = await this.rows(db,scope);
    return ids.map(id => {
      const row = rows.find(r => r.id === id && r.status === 'READY');
      if (!row) throw new EventAccessError('IMAGE_NOT_READY',409);
      const m = this.metadata(row);
      return { id:m.id,size:m.size,sha256:m.sha256,contentType:m.contentType,width:m.width,height:m.height };
    });
  }
}
module.exports = { EventMediaService, EventImageService };
