const crypto = require('node:crypto');
const { EventAccessError, textField } = require('./authorization');
const { isId } = require('./grant-repository');
const { EventMediaPrivateStore, MAX_MEDIA_BYTES } = require('./media-private-store');
const { digest } = require('./deck-private-store');
const { normalizeAV } = require('./av-runtime');
class EventMediaService {
  constructor({ preparations, root, forbiddenRoots, store }) {
    this.preparations = preparations; this.domain = preparations.domain;
    this.store = store || new EventMediaPrivateStore({ root, forbiddenRoots }); this.uploads = 0;
  }
  async scoped(db, actor, scope, writable = false) {
    await this.preparations.scoped(db, actor, scope);
    if (writable) {
      const [rows] = await db.execute('SELECT version_id FROM event_deck_configurations WHERE version_id=?', [scope.versionId]);
      if (rows.length) throw new EventAccessError('VERSION_CONFIGURATION_EXISTS', 409);
    }
  }
  async authorize(actor, scope) { return this.domain.transaction(actor, 'deck.media.authorize', db => this.scoped(db, actor, scope, true)); }
  acquireUpload() {
    if (this.uploads >= 2) throw new EventAccessError('MEDIA_UPLOAD_BUSY', 429);
    this.uploads++; let released = false; return () => { if (!released) { released = true; this.uploads--; } };
  }
  async rows(db, scope, id = null) {
    if (id !== null && !isId(id)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT id,event_id AS eventId,deck_id AS deckId,version_id AS versionId,status,
      source_size AS size,source_sha256 AS sha256,metadata_json AS metadataJson,metadata_digest AS metadataDigest,error_code AS errorCode
      FROM event_deck_media WHERE event_id=? AND deck_id=? AND version_id=?${id ? ' AND id=?' : ''} ORDER BY created_at,id`,
    [scope.eventId,scope.deckId,scope.versionId,...(id ? [id] : [])]); return rows;
  }
  metadata(row) {
    if (row.status !== 'READY') return { id: row.id, status: row.status, errorCode: row.errorCode };
    let data; try { data = JSON.parse(row.metadataJson); } catch (_) { throw new EventAccessError('MEDIA_INTEGRITY_FAILED', 409); }
    if (!data || digest(row.metadataJson) !== row.metadataDigest || data.schema !== 1
      || ['id','eventId','deckId','versionId','size','sha256'].some(k => data[k] !== row[k])) throw new EventAccessError('MEDIA_INTEGRITY_FAILED', 409);
    return { status: 'READY_PENDING_DECK_CHECK', ...data };
  }
  async list(actor, scope) {
    return this.domain.transaction(actor, 'deck.media.list', async db => {
      await this.scoped(db,actor,scope); const media = (await this.rows(db,scope)).map(row => this.metadata(row));
      this.preparations.checkEnabled(); return { media };
    });
  }
  async upload(actor, scope, name, bytes) {
    await this.authorize(actor,scope); name = textField(name,120);
    if (/[\x00-\x1f\x7f]/.test(name)) throw new EventAccessError('INVALID_INPUT',400);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new EventAccessError('INVALID_MEDIA_SIZE',413);
    const id = crypto.randomUUID(), sourceSha = digest(bytes);
    await this.domain.transaction(actor,'deck.media.reserve',async db => {
      await this.scoped(db,actor,scope,true);
      const [counts] = await db.execute('SELECT COUNT(*) AS n,COALESCE(SUM(source_size),0) AS bytes FROM event_deck_media WHERE version_id=?',[scope.versionId]);
      if (counts[0].n >= 200 || Number(counts[0].bytes)+bytes.length > 1024*1024*1024) throw new EventAccessError('VERSION_MEDIA_LIMIT',413);
      await db.execute(`INSERT INTO event_deck_media (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id)
        VALUES (?,?,?,?,'PROCESSING',?,?,?)`,[id,scope.eventId,scope.deckId,scope.versionId,bytes.length,sourceSha,actor]);
      await this.domain.audit(db,actor,'deck.media.reserve',scope.organizationId,scope.eventId,id); this.preparations.checkEnabled();
    });
    try {
      const info = await this.store.prepare({ ...scope,id },bytes);
      return await this.domain.transaction(actor,'deck.media.complete',async db => {
        await this.scoped(db,actor,scope,true);
        const data = { schema:1,id,eventId:scope.eventId,deckId:scope.deckId,versionId:scope.versionId,name,
          size:bytes.length,sha256:sourceSha,...info },json=JSON.stringify(data);
        const [update] = await db.execute(`UPDATE event_deck_media SET status='READY',metadata_json=?,metadata_digest=?,completed_at=CURRENT_TIMESTAMP(3)
          WHERE id=? AND status='PROCESSING'`,[json,digest(json),id]);
        if (update.affectedRows !== 1) throw new EventAccessError('MEDIA_CONFLICT',409);
        await this.domain.audit(db,actor,'deck.media.complete',scope.organizationId,scope.eventId,id); this.preparations.checkEnabled();
        return this.metadata((await this.rows(db,scope,id))[0]);
      });
    } catch (e) {
      const code = e instanceof EventAccessError ? e.code : 'MEDIA_PREPARATION_FAILED';
      await this.domain.pool.execute(`UPDATE event_deck_media SET status='FAILED',error_code=?,completed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND status='PROCESSING'`,[code,id]).catch(()=>{});
      if (e instanceof EventAccessError) throw e; throw new EventAccessError(code,503);
    }
  }
  async catalog(db,scope,input) {
    const all = await this.rows(db,scope), resources = input.assetIds.map(id => {
      const row = all.find(r => r.id === id && r.status === 'READY');
      if (!row) throw new EventAccessError('MEDIA_NOT_READY',409);
      const m = this.metadata(row);
      return { id:m.id,assetId:m.id,name:m.name,type:m.type,duration:m.duration,size:m.size,sha256:m.sha256,contentType:m.contentType };
    });
    try { return normalizeAV({ resources,playlists:input.playlists }); }
    catch (_) { throw new EventAccessError('INVALID_CONFIGURATION',400); }
  }
  async open(actor,scope,id) {
    const row = await this.domain.transaction(actor,'deck.media.read',async db => {
      await this.scoped(db,actor,scope); const row=(await this.rows(db,scope,id))[0];
      if (!row) throw new EventAccessError('RESOURCE_NOT_FOUND',404);
      if (row.status !== 'READY') throw new EventAccessError('MEDIA_NOT_READY',409);
      const metadata=this.metadata(row); this.preparations.checkEnabled(); return { ...row,metadata };
    });
    const handle=await this.store.verified(row);
    try { this.preparations.checkEnabled(); return { handle,metadata:row.metadata }; }
    catch(e) { await handle.close(); throw e; }
  }
}
module.exports = { EventMediaService };
