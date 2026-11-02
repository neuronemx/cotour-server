const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const express = require('express');
const { CAPABILITIES, featureAccessForPlan, canUseFeature } = require('../auth/plan-features');

async function fixture(t, plan, count = 2, failAccounting = false) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'immersa-en-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const deckDir = path.join(root, 'decks', 'deck-a');
  await fs.promises.mkdir(path.join(deckDir, 'slides'), { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, 'slides', 'one.jpg'), 'es slide');
  const base = { deckId: 'deck-a', slides: [{ id: 'slide-001' }, { id: 'slide-002' }] };
  await fs.promises.writeFile(path.join(deckDir, 'manifest.json'), JSON.stringify(base));
  const previous = process.env.IMMERSA_DATA_DIR;
  process.env.IMMERSA_DATA_DIR = root;
  const modulePath = require.resolve('../pdf-upload-support');
  delete require.cache[modulePath];
  const { createLocaleVariantUploadHandler, createLocaleVariantMutationHandler, directorySizeBytes } = require('../pdf-upload-support');
  if (previous === undefined) delete process.env.IMMERSA_DATA_DIR;
  else process.env.IMMERSA_DATA_DIR = previous;
  const initialBytes = await directorySizeBytes(deckDir);
  const recorded = [];
  const app = express();
  app.post('/decks/:deckId/locales/en', (req, res, next) => {
    if (!canUseFeature(featureAccessForPlan(plan), CAPABILITIES.MULTILANGUAGE_MANAGE)) {
      return res.status(403).json({ code: 'PLAN_FEATURE_LOCKED' });
    }
    next();
  }, createLocaleVariantUploadHandler({
    async convertDeckPdf({ deckDir: stageDir, manifest }) {
      await fs.promises.mkdir(path.join(stageDir, 'slides'), { recursive: true });
      await fs.promises.mkdir(path.join(stageDir, 'thumbs'), { recursive: true });
      const slides = [];
      for (let index = 0; index < count; index++) {
        const filename = `slide-${index + 1}.jpg`;
        await fs.promises.writeFile(path.join(stageDir, 'slides', filename), `en ${index}`);
        slides.push({ id: `en-${index}`, src: `slides/${filename}` });
      }
      return { ...manifest, slides };
    },
    async onDeckChanged({ deck }) {
      if (failAccounting) throw Object.assign(new Error('limit'), { statusCode: 413, code: 'STORAGE_LIMIT_REACHED', publicMessage: 'No hay espacio' });
      recorded.push(deck);
      return { plan };
    }
  }));
  app.use(express.json());
  const requirePaid = (req, res, next) => canUseFeature(featureAccessForPlan(plan), CAPABILITIES.MULTILANGUAGE_MANAGE)
    ? next() : res.status(403).json({ code: 'PLAN_FEATURE_LOCKED' });
  const account = async ({ deck }) => {
    if (failAccounting) throw Object.assign(new Error('limit'), { statusCode: 413, code: 'STORAGE_LIMIT_REACHED', publicMessage: 'No hay espacio' });
    recorded.push(deck);
  };
  app.patch('/decks/:deckId/locales/en', requirePaid, createLocaleVariantMutationHandler('toggle', { onDeckChanged: account }));
  app.delete('/decks/:deckId/locales/en', requirePaid, createLocaleVariantMutationHandler('delete', { onDeckChanged: account }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function upload() {
    const form = new FormData();
    form.append('pptx', new Blob(['%PDF-1.4']), 'english.pdf');
    return fetch(`http://127.0.0.1:${server.address().port}/decks/deck-a/locales/en`, { method: 'POST', body: form });
  }
  async function mutate(method, body) {
    return fetch(`http://127.0.0.1:${server.address().port}/decks/deck-a/locales/en`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
  }
  return { upload, mutate, deckDir, initialBytes, recorded, base };
}

test('FREE cannot upload English from the API and the ES Deck is unchanged', async (t) => {
  const f = await fixture(t, 'FREE');
  const response = await f.upload();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'PLAN_FEATURE_LOCKED');
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(f.deckDir, 'manifest.json'))), f.base);
  assert.deepEqual(await fs.promises.readdir(f.deckDir), ['manifest.json', 'slides']);
});

for (const plan of ['SPEAKER', 'SPEAKER_PRO']) {
  test(`${plan} adds EN inside one Deck and accounts for the additional bytes`, async (t) => {
    const f = await fixture(t, plan);
    const response = await f.upload();
    assert.equal(response.status, 200, await response.text());
    assert.equal(f.recorded.length, 1);
    assert.equal(f.recorded[0].deckId, 'deck-a');
    assert.ok(f.recorded[0].sourceSizeBytes > f.initialBytes);
    const manifest = JSON.parse(await fs.promises.readFile(path.join(f.deckDir, 'manifest.json')));
    assert.equal(manifest.locales.en.active, true);
    const en = JSON.parse(await fs.promises.readFile(path.join(f.deckDir, 'locales', 'en', 'manifest.json')));
    assert.deepEqual(en.slides.map((slide) => slide.id), f.base.slides.map((slide) => slide.id));
  });
}

test('slide mismatch and failed storage check preserve the original Deck', async (t) => {
  const mismatch = await fixture(t, 'SPEAKER', 1);
  assert.equal((await mismatch.upload()).status, 422);
  assert.equal(mismatch.recorded.length, 0);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(mismatch.deckDir, 'manifest.json'))), mismatch.base);
  const failure = await fixture(t, 'SPEAKER', 2, true);
  assert.equal((await failure.upload()).status, 413);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(failure.deckDir, 'manifest.json'))), failure.base);
});

test('English can be deactivated, reactivated and deleted without adding a Deck', async (t) => {
  const f = await fixture(t, 'SPEAKER');
  assert.equal((await f.upload()).status, 200);
  assert.equal((await f.mutate('PATCH', { active: false })).status, 200);
  let manifest = JSON.parse(await fs.promises.readFile(path.join(f.deckDir, 'manifest.json')));
  assert.equal(manifest.locales.en.active, false);
  assert.equal((await f.mutate('PATCH', { active: true })).status, 200);
  assert.equal((await f.mutate('DELETE')).status, 200);
  manifest = JSON.parse(await fs.promises.readFile(path.join(f.deckDir, 'manifest.json')));
  assert.equal(manifest.locales.en, undefined);
  assert.equal(f.recorded.at(-1).deckId, 'deck-a');
  assert.ok(f.recorded.at(-1).sourceSizeBytes < f.recorded[0].sourceSizeBytes);
});
