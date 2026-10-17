const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const { EventDeckPrivateStore, digest } = require('../events-v2/deck-private-store');
const { attachDeckPreparationRoutes } = require('../events-v2/deck-preparation-http');
const { EventAccessError } = require('../events-v2/authorization');
const { pdfFixture } = require('./helpers/events-v2-pdf-fixture');
const scope = () => Object.fromEntries(['eventId', 'deckId', 'versionId', 'attemptId'].map(k => [k, crypto.randomUUID()]));
async function setup(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'event-deck-private-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const store = new EventDeckPrivateStore({ root: path.join(base, 'private'), ...options });
  return { base, store, s: scope() };
}

test('private real Poppler conversion preserves PDF, seals a two-page manifest and verifies each preview', async t => {
  const { base, store, s } = await setup(t);
  const bytes = pdfFixture();
  const result = await store.prepare(s, bytes);
  const manifest = JSON.parse(result.json);
  const row = { ...s, manifestJson: result.json, manifestDigest: result.digest, slideCount: result.slideCount };
  assert.equal(result.slideCount, 2); assert.equal(result.digest, digest(result.json));
  assert.deepEqual(manifest.source, { size: bytes.length, sha256: digest(bytes) });
  const dir = store.directory(s);
  assert.equal((await fs.stat(store.root)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, 'original.pdf'))).mode & 0o777, 0o400);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['manifest.json', 'original.pdf', 'slides', 'thumbs']);
  for (const slide of manifest.slides) for (const variant of ['full', 'thumb']) {
    const image = await store.image(row, slide.id, variant);
    assert.equal(image.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(digest(image), slide[variant].sha256);
    assert.equal((await fs.stat(path.join(dir, slide[variant].file))).mode & 0o777, 0o400);
  }
  await assert.rejects(store.prepare(s, bytes), { code: 'EEXIST' });
  await assert.rejects(store.image(row, 'slide-001', 'source'), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(store.image(row, '../original', 'full'), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(store.image({ ...row, manifestDigest: '0'.repeat(64) }, 'slide-001', 'full'), { code: 'PREPARATION_INTEGRITY_FAILED' });
  const imagePath = path.join(dir, 'slides/slide-001.jpg');
  await fs.chmod(imagePath, 0o600); await fs.writeFile(imagePath, 'tampered private image');
  await assert.rejects(store.image(row, 'slide-001', 'full'), { code: 'PREPARATION_INTEGRITY_FAILED' });
  await fs.unlink(imagePath); await fs.symlink(path.join(base, 'sentinel'), imagePath);
  await fs.writeFile(path.join(base, 'sentinel'), 'OUTSIDE_PRIVATE_ROOT');
  await assert.rejects(store.image(row, 'slide-001', 'full'), { code: 'PREPARATION_INTEGRITY_FAILED' });
});

test('private converter rejects malformed and oversized-page PDFs before rendering', async t => {
  let renders = 0;
  const { store, s } = await setup(t, { convert: async () => { renders++; } });
  await assert.rejects(store.prepare(s, Buffer.from('%PDF- broken')), { code: 'INVALID_PDF' });
  await assert.rejects(store.prepare(scope(), pdfFixture(501)), { code: 'PDF_PAGE_LIMIT' });
  assert.equal(renders, 0);
});

test('private root and ancestors reject exposed directories, path substitution and symlinks', async t => {
  const { base, store, s } = await setup(t);
  assert.throws(() => new EventDeckPrivateStore({ root: path.join(base, 'public/decks'), forbiddenRoots: [path.join(base, 'public')] }));
  assert.throws(() => store.directory({ ...s, versionId: '../escape' }), { code: 'PREPARATION_INTEGRITY_FAILED' });
  await fs.mkdir(path.join(base, 'outside')); await fs.symlink(path.join(base, 'outside'), store.root);
  await assert.rejects(store.prepare(s, pdfFixture()), { code: 'PREPARATION_INTEGRITY_FAILED' });
  assert.deepEqual(await fs.readdir(path.join(base, 'outside')), []);
});

test('partial conversion errors never create a sealed manifest or touch personal storage', async t => {
  const { store, s } = await setup(t, { convert: async ({ deckDir, workRoot, boundDimensions }) => {
    assert.equal(deckDir, workRoot); assert.equal(boundDimensions, true);
    await fs.mkdir(path.join(deckDir, 'slides')); await fs.writeFile(path.join(deckDir, 'slides', 'partial'), 'partial');
    throw new Error('PRIVATE_CONVERTER_ERROR');
  } });
  await assert.rejects(store.prepare(s, pdfFixture()), /PRIVATE_CONVERTER_ERROR/);
  await assert.rejects(fs.stat(path.join(store.directory(s), 'manifest.json')), { code: 'ENOENT' });
});

test('multipart accepts only a single PDF and authorizes before parsing without leaking errors', async t => {
  let allowed = true, uploads = 0, active = 0;
  const service = { authorize: async () => { if (!allowed) throw new EventAccessError('RESOURCE_NOT_FOUND', 404); },
    acquireUpload: () => { active++; return () => { active--; }; },
    upload: async (_actor, _scope, bytes) => { uploads++; assert.ok(bytes.equals(pdfFixture())); return { status: 'CONVERTED' }; } };
  const app = express(); const router = express.Router();
  router.use((req, _res, next) => { req.accountContext = { user: { id: 'verified-account' } }; next(); });
  attachDeckPreparationRoutes(router, service, '/org/:orgId/events/:eventId'); app.use(router);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + '/org/a/events/b/decks/c/versions/d/source';
  const form = field => { const data = new FormData(); data.append(field, new Blob([pdfFixture()]), 'untrusted-name.pdf'); return data; };
  let response = await fetch(url, { method: 'POST', headers: { origin: base }, body: form('pdf') });
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  response = await fetch(url, { method: 'POST', headers: { origin: base }, body: form('wrong') }); assert.equal(response.status, 400);
  const extra = form('pdf'); extra.append('eventId', 'foreign');
  response = await fetch(url, { method: 'POST', headers: { origin: base }, body: extra }); assert.equal(response.status, 400);
  allowed = false;
  response = await fetch(url, { method: 'POST', headers: { origin: base, 'content-type': 'multipart/form-data; boundary=broken' }, body: 'broken' });
  assert.equal(response.status, 404); assert.equal(uploads, 1); assert.equal(active, 0);
});
