const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { normalizeProfilePhoto } = require('./profile-api');
const { requireLocaleWriteOrigin } = require('./deck-locale-http');

const MAX_IMAGES = 20;
const defaults = Array.from({ length: 10 }, (_, i) => ({ url: '/selfie/demo/' + (i + 1) + '.svg' }));
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function createSelfieCollectionStore({ findDeckDir }) {
  const locks = new Map();
  async function location(deckId) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(deckId || ''))) throw fail('Deck no válido.');
    return findDeckDir(deckId);
  }
  async function read(deckId) {
    const dir = await location(deckId);
    let config;
    try { config = JSON.parse(await fs.readFile(path.join(dir, 'selfie.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; config = { revision: 0, images: [] }; }
    return { revision: config.revision, custom: config.images.length > 0, provisional: config.images.length === 0, images: config.images.length ? config.images : defaults };
  }
  async function update(deckId, revision, change) {
    const previous = locks.get(deckId) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const current = await read(deckId);
      if (!Number.isInteger(revision) || revision !== current.revision) throw fail('La colección cambió. Actualiza la lista antes de guardar.', 409);
      const dir = await location(deckId);
      const images = await change(current.custom ? current.images : [], dir);
      const temp = path.join(dir, 'selfie-' + crypto.randomUUID() + '.tmp');
      await fs.writeFile(temp, JSON.stringify({ revision: revision + 1, images }));
      await fs.rename(temp, path.join(dir, 'selfie.json'));
      return read(deckId);
    });
    locks.set(deckId, job);
    try { return await job; } finally { if (locks.get(deckId) === job) locks.delete(deckId); }
  }
  async function upload(deckId, revision, files, replace) {
    if (!files?.length) throw fail('Selecciona al menos una imagen.');
    const detected = files.map(normalizeProfilePhoto);
    return update(deckId, revision, async (previous, dir) => {
      if (!replace && previous.length + files.length > MAX_IMAGES) throw fail('Puedes usar hasta 20 imágenes por colección.');
      await fs.mkdir(path.join(dir, 'selfie-assets'), { recursive: true });
      const images = [];
      for (let i = 0; i < files.length; i++) {
        const key = crypto.randomUUID() + detected[i].extension;
        await fs.writeFile(path.join(dir, 'selfie-assets', key), files[i].buffer);
        images.push({ url: '/decks/' + encodeURIComponent(deckId) + '/selfie-assets/' + key });
      }
      // Immutable assets remain available to any round already using this collection.
      return replace ? images : previous.concat(images);
    });
  }
  return { read, upload, remove: (deckId, revision, url) => update(deckId, revision, images => images.filter(image => image.url !== url)), reset: (deckId, revision) => update(deckId, revision, () => []) };
}

function createSelfieCollectionHttp({ store, owner }) {
  const router = express.Router();
  const base = '/api/decks/:deckId/selfie';
  const handle = action => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await action(req)); }
    catch (error) {
      const status = error.statusCode || (error instanceof multer.MulterError ? 400 : 500);
      if (status >= 500) console.error('Selfie collection failed', error);
      res.status(status).json({ error: status >= 500 ? 'No se pudo guardar la colección.' : error.message });
    }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: MAX_IMAGES, fileSize: 5 * 1024 * 1024, fields: 2 } }).array('images', MAX_IMAGES);
  router.get(base, ...owner, handle(req => store.read(req.params.deckId)));
  router.post(base, ...owner, requireLocaleWriteOrigin, (req, res) => upload(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Selecciona hasta 20 imágenes PNG, JPG o WebP de máximo 5 MB cada una.' });
    return handle(req => store.upload(req.params.deckId, Number(req.body.revision), req.files, req.body.replace === 'true'))(req, res);
  }));
  router.delete(base, ...owner, requireLocaleWriteOrigin, handle(req => store.reset(req.params.deckId, req.body.revision)));
  router.delete(base + '/image', ...owner, requireLocaleWriteOrigin, handle(req => store.remove(req.params.deckId, req.body.revision, req.body.url)));
  return router;
}
module.exports = { createSelfieCollectionStore, createSelfieCollectionHttp };
