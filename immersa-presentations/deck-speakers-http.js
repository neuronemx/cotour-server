const express = require('express');
const multer = require('multer');
const {DeckSpeakerError, fields} = require('./deck-speakers');
const {normalizeProfilePhoto} = require('./profile-api');

function createDeckSpeakersHttp({store, enabled, owner, account, legacyProfile}) {
  const router = express.Router(), base = '/api/decks/:deckId/speakers';
  const gate = (_req,res,next) => enabled() ? next() : res.sendStatus(404);
  const noStore = (_req,res,next) => { res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}); next(); };
  const origin = (req,res,next) => {
    try { const url = new URL(req.headers.origin); if (!['http:','https:'].includes(url.protocol) || url.host !== req.get('host') || req.headers['sec-fetch-site'] === 'cross-site') throw Error(); next(); }
    catch (_) { res.status(403).json({code:'ORIGIN_DENIED',error:'Origen no autorizado.'}); }
  };
  const handle = action => async (req,res) => {
    try { await action(req,res); }
    catch (error) {
      const expected = error instanceof DeckSpeakerError || error.name === 'ProfileValidationError' || error.name === 'ProfilePhotoError';
      if (!expected) console.error('Deck speaker operation failed', error.code || 'UNKNOWN');
      res.status(expected ? error.statusCode || 400 : 503).json({code:expected ? error.code : 'PROFILE_UNAVAILABLE',error:expected ? error.message : 'No se pudieron actualizar los perfiles.'});
    }
  };
  router.get('/api/deck-speaker-profiles/capability', noStore, account, (_req,res) => res.json({enabled:enabled()}));
  router.use(base, noStore, gate);
  router.get(base, ...owner, handle(async(req,res) => res.json(store.editor(await store.read(req.params.deckId)))));
  router.put(base + '/settings', ...owner, origin, handle(async(req,res) => res.json(await store.setEnabled(req.params.deckId, req.body))));
  router.put(base + '/order', ...owner, origin, handle(async(req,res) => res.json(await store.reorder(req.params.deckId, req.body))));
  router.post(base, ...owner, origin, handle(async(req,res) => res.status(201).json(await store.save(req.params.deckId, null, req.body))));
  router.put(base + '/:profileId', ...owner, origin, handle(async(req,res) => res.json(await store.save(req.params.deckId, req.params.profileId, req.body))));
  router.put(base + '/:profileId/active', ...owner, origin, handle(async(req,res) => res.json(await store.setActive(req.params.deckId, req.params.profileId, req.body))));
  const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:5*1024*1024, files:1, fields:1}}).single('photo');
  router.post(base + '/:profileId/photo', ...owner, origin, (req,res) => upload(req,res,error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({code:'INVALID_PHOTO',error:'Selecciona una foto PNG, JPG o WebP de hasta 5 MB.'});
    return handle(async(req,res) => {
      fields(req.body, ['expectedRevision']); const detected = normalizeProfilePhoto(req.file);
      if (!/^\d+$/.test(req.body.expectedRevision || '')) throw new DeckSpeakerError('INVALID_REVISION','Actualiza la lista antes de guardar.');
      res.json(await store.setPhoto(req.params.deckId, req.params.profileId, Number(req.body.expectedRevision), req.file.buffer, detected.extension));
    })(req,res);
  }));
  const sendPhoto = own => handle(async(req,res) => {
    const file = await store.photo(req.params.deckId, req.params.profileId, req.params.key, own);
    res.sendFile(file, {cacheControl:false}, error => { if (error && !res.headersSent) res.status(404).end(); });
  });
  router.get(base + '/:profileId/photo/:key', ...owner, sendPhoto(true));
  router.get('/api/decks/:deckId/speaker-photos/:profileId/:key', noStore, gate, sendPhoto(false));
  router.get('/api/decks/:deckId/speaker-profile', noStore, handle(async(req,res) => {
    if (!enabled()) return legacyProfile(req,res);
    const config = await store.read(req.params.deckId);
    if (!config.enabled) return legacyProfile(req,res);
    res.json(store.public(config));
  }));
  return router;
}
module.exports = {createDeckSpeakersHttp};
