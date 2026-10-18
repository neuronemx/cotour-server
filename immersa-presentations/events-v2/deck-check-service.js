const { EventAccessError } = require('./authorization');
const { digest } = require('./deck-private-store');
const fail = (code,status=409) => { throw new EventAccessError(code,status); };
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
class EventDeckCheckService {
  constructor({configurations}) {
    this.configurations=configurations; this.preparations=configurations.preparations;
    this.domain=configurations.domain; this.running=0;
  }
  acquire() {
    if(this.running>=1) fail('DECK_CHECK_BUSY',429);
    this.running++; let released=false;
    return ()=>{if(!released){released=true;this.running--;}};
  }
  async row(db,scope) {
    const [rows]=await db.execute(`SELECT event_id AS eventId,deck_id AS deckId,version_id AS versionId,
      configuration_digest AS configurationDigest,bundle_digest AS bundleDigest,
      approval_digest AS approvalDigest,approval_json AS approvalJson,approved_at AS approvedAt
      FROM event_deck_checks WHERE event_id=? AND deck_id=? AND version_id=? FOR UPDATE`,
    [scope.eventId,scope.deckId,scope.versionId]); return rows[0];
  }
  async snapshot(db,scope) {
    const c=this.configurations,configured=await c.read(db,scope);
    if(!configured.configuration) fail('CONFIGURATION_NOT_READY');
    const configuration=configured.configuration,spanish=await c.source(db,scope);
    let english=null;
    if(configuration.englishSource) {
      await c.englishSource(db,scope,spanish); english=await c.translations.row(db,scope);
    }
    let media=[];
    if(configuration.av) {
      if(!c.media) fail('MEDIA_NOT_READY');
      const trusted=await c.media.catalog(db,scope,{assetIds:configuration.av.resources.map(r=>r.id),playlists:configuration.av.playlists});
      if(!equal(trusted,configuration.av)) fail('DECK_CHECK_SOURCE_CHANGED');
      const ids=new Set(trusted.resources.map(r=>r.assetId));
      media=(await c.media.rows(db,scope)).filter(r=>ids.has(r.id)).sort((a,b)=>a.id.localeCompare(b.id));
      if(media.length!==ids.size) fail('MEDIA_NOT_READY');
    }
    let images=[];
    const imageIds=c.imageIds(configuration);
    if(imageIds.length) {
      // read() already compares current descriptors against the sealed list.
      images=(await c.images.rows(db,scope)).filter(r=>imageIds.includes(r.id)).sort((a,b)=>a.id.localeCompare(b.id));
      if(images.length!==imageIds.length) fail('IMAGE_NOT_READY');
    }
    const pdf=row=>({attemptId:row.attemptId,manifestDigest:row.manifestDigest,sourceSize:row.sourceSize,
      sourceSha256:row.sourceSha256,slideCount:row.slideCount,...(row.baseManifestDigest?{baseManifestDigest:row.baseManifestDigest}:{})});
    const resources=rows=>rows.map(r=>({id:r.id,size:r.size,sha256:r.sha256,metadataDigest:r.metadataDigest}));
    const bundle={schema:1,eventId:scope.eventId,deckId:scope.deckId,versionId:scope.versionId,
      configurationDigest:configured.configurationDigest,spanish:pdf(spanish),english:english?pdf(english):null,
      media:resources(media),images:resources(images)};
    return {bundle,bundleDigest:digest(JSON.stringify(bundle)),spanish,english,media,images};
  }
  stored(row,snapshot,verified=null) {
    if(!row || !sha(row.approvalDigest) || !sha(row.bundleDigest) || !sha(row.configurationDigest)
      || typeof row.approvalJson!=='string' || Buffer.byteLength(row.approvalJson)>262144
      || digest(row.approvalJson)!==row.approvalDigest) fail('DECK_CHECK_INTEGRITY_FAILED');
    let approval;try{approval=JSON.parse(row.approvalJson);}catch(_){fail('DECK_CHECK_INTEGRITY_FAILED');}
    if(approval?.schema!==1 || !equal(approval.bundle,snapshot.bundle) || row.bundleDigest!==snapshot.bundleDigest
      || row.configurationDigest!==snapshot.bundle.configurationDigest || ['eventId','deckId','versionId'].some(k=>row[k]!==snapshot.bundle[k])
      || digest(JSON.stringify(approval.bundle))!==row.bundleDigest || (verified && !equal(approval.verified,verified))) fail('DECK_CHECK_INTEGRITY_FAILED');
    return {status:'DECK_CHECK',eventId:row.eventId,deckId:row.deckId,versionId:row.versionId,
      configurationDigest:row.configurationDigest,bundleDigest:row.bundleDigest,approvalDigest:row.approvalDigest,
      approvedAt:row.approvedAt.toISOString(),verified:approval.verified};
  }
  async verify(snapshot) {
    const c=this.configurations,verified={pdfs:0,slides:0,files:0,bytes:0,media:snapshot.media.length,images:snapshot.images.length};
    try {
      for(const [row,service] of [[snapshot.spanish,c.preparations],[snapshot.english,c.translations]]) {
        if(!row) continue;
        this.preparations.checkEnabled();const result=await service.store.verify(row);
        verified.pdfs++;verified.slides+=result.slides;verified.files+=result.files;verified.bytes+=result.bytes;
      }
      for(const [rows,service] of [[snapshot.media,c.media],[snapshot.images,c.images]]) for(const row of rows) {
        this.preparations.checkEnabled(); service.metadata(row);
        const handle=await service.store.verified(row);await handle.close();
        verified.files++;verified.bytes+=row.size;
      }
      this.preparations.checkEnabled(); return verified;
    } catch(e) { if(e instanceof EventAccessError) throw e; fail('DECK_CHECK_INTEGRITY_FAILED'); }
  }
  async run(actor,scope,configurationDigest,approve) {
    await this.domain.transaction(actor,'deck.check.authorize',db=>this.preparations.scoped(db,actor,scope));
    if(approve && !sha(configurationDigest)) fail('INVALID_CONFIGURATION_DIGEST',400);
    const release=this.acquire();
    try {
      const initial=await this.domain.transaction(actor,'deck.check.inspect',async db=>{
        await this.preparations.scoped(db,actor,scope);const row=await this.row(db,scope);
        if(!approve && !row) return null;
        const snapshot=await this.snapshot(db,scope);
        if(approve && snapshot.bundle.configurationDigest!==configurationDigest) fail('DECK_CHECK_SOURCE_CHANGED');
        if(row) this.stored(row,snapshot);
        return {row,snapshot};
      });
      if(!initial) return {status:'NOT_CHECKED'};
      // Large file reads happen outside SQL locks. The final transaction
      // reauthorizes and compares the complete snapshot before approval.
      const verified=await this.verify(initial.snapshot);
      return await this.domain.transaction(actor,approve?'deck.check.approve':'deck.check.read',async db=>{
        await this.preparations.scoped(db,actor,scope);const current=await this.snapshot(db,scope);
        if(current.bundleDigest!==initial.snapshot.bundleDigest) fail('DECK_CHECK_SOURCE_CHANGED');
        const existing=await this.row(db,scope);
        if(existing) { const result=this.stored(existing,current,verified);this.preparations.checkEnabled();return result; }
        if(!approve) fail('DECK_CHECK_SOURCE_CHANGED');
        const approvalJson=JSON.stringify({schema:1,bundle:current.bundle,verified}),approvalDigest=digest(approvalJson);
        if(Buffer.byteLength(approvalJson)>262144) fail('DECK_CHECK_TOO_LARGE',413);
        await db.execute(`INSERT INTO event_deck_checks
          (version_id,event_id,deck_id,configuration_digest,bundle_digest,approval_digest,approval_json,approved_by_user_id)
          VALUES (?,?,?,?,?,?,?,?)`,[scope.versionId,scope.eventId,scope.deckId,current.bundle.configurationDigest,current.bundleDigest,approvalDigest,approvalJson,actor]);
        await this.domain.audit(db,actor,'deck.check.approve',scope.organizationId,scope.eventId,scope.versionId);
        this.preparations.checkEnabled();return this.stored(await this.row(db,scope),current,verified);
      });
    } finally {release();}
  }
  get(actor,scope) {return this.run(actor,scope,null,false);}
  approve(actor,scope,configurationDigest) {return this.run(actor,scope,configurationDigest,true);}
}
module.exports={EventDeckCheckService};
