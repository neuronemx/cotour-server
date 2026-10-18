const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { EventAccessError } = require('./authorization');
const { convertDeckPdf } = require('../pdf-upload-support');
const exec = promisify(execFile);
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const MAX_PAGES = 500;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, value) => value === root || value.startsWith(root + path.sep);
const fail = () => { throw new EventAccessError('PREPARATION_INTEGRITY_FAILED', 409); };

class EventDeckPrivateStore {
  constructor({ root, forbiddenRoots = [path.join(__dirname, '..', 'public')], convert = convertDeckPdf }) {
    this.root = path.resolve(root);
    if (forbiddenRoots.some(r => inside(path.resolve(r), this.root) || inside(this.root, path.resolve(r)))) {
      throw new Error('Private Deck root overlaps an exposed storage root');
    }
    this.convert = convert;
  }

  directory(scope) {
    const keys = ['eventId', 'deckId', 'versionId', 'attemptId'];
    if (!keys.every(k => uuid.test(scope[k]))) fail();
    return path.join(this.root, ...keys.map(k => scope[k]));
  }

  // All path components are server UUIDs. Check ancestors as well as leaves;
  // never traverse a symlink or chmod an ancestor outside this private root.
  async directories(target, create = false) {
    if (!inside(this.root, target)) fail();
    let current = path.parse(target).root;
    for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (create) await fs.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
      if (create && inside(this.root, current)) await fs.chmod(current, 0o700);
    }
  }

  async read(dir, relative, max) {
    if (!/^(original\.pdf|manifest\.json|(slides|thumbs)\/slide-\d{3}\.jpg)$/.test(relative)) fail();
    await this.directories(path.dirname(path.join(dir, relative)));
    const handle = await fs.open(path.join(dir, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > max || stat.nlink !== 1) fail();
      const bytes = await handle.readFile();
      if (bytes.length !== stat.size) fail();
      return bytes;
    } finally { await handle.close(); }
  }

  async pageCount(pdfPath) {
    let stdout;
    try {
      ({ stdout } = await exec('pdfinfo', [pdfPath], { timeout: 15000, maxBuffer: 128 * 1024,
        env: { ...process.env, LC_ALL: 'C' }, windowsHide: true }));
    } catch (error) {
      if (error.code === 'ENOENT') throw new EventAccessError('PDF_TOOLS_UNAVAILABLE', 503);
      throw new EventAccessError('INVALID_PDF', 400);
    }
    const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(stdout)?.[1]);
    if (!Number.isInteger(count) || count < 1) throw new EventAccessError('INVALID_PDF', 400);
    if (count > MAX_PAGES) throw new EventAccessError('PDF_PAGE_LIMIT', 413);
    return count;
  }

  async prepare(scope, bytes, { expectedSlideCount = null } = {}) {
    const dir = this.directory(scope);
    await this.directories(path.dirname(dir), true);
    await fs.mkdir(dir, { mode: 0o700 }); // Exclusive attempt; never overwrite.
    const sourcePath = path.join(dir, 'original.pdf');
    await fs.writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 });
    const count = await this.pageCount(sourcePath);
    if (expectedSlideCount !== null && count !== expectedSlideCount) throw new EventAccessError('LOCALE_SLIDE_COUNT_MISMATCH', 422);
    const converted = await this.convert({ deckDir: dir, pdfPath: sourcePath, manifest: {}, workRoot: dir, boundDimensions: true });
    if (!Array.isArray(converted?.slides) || converted.slides.length !== count) fail();
    let total = 0;
    const slides = [];
    for (let n = 1; n <= count; n++) {
      const id = 'slide-' + String(n).padStart(3, '0');
      const original = converted.slides[n - 1];
      if (original.id !== id || original.src !== `slides/${id}.jpg` || original.thumb !== `thumbs/${id}.jpg`) fail();
      const slide = { id };
      for (const [variant, folder] of [['full', 'slides'], ['thumb', 'thumbs']]) {
        const file = `${folder}/${id}.jpg`;
        const image = await this.read(dir, file, MAX_IMAGE_BYTES);
        if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) fail();
        total += image.length;
        if (total > MAX_OUTPUT_BYTES) throw new EventAccessError('PDF_OUTPUT_LIMIT', 413);
        slide[variant] = { file, size: image.length, sha256: digest(image) };
        await fs.chmod(path.join(dir, file), 0o400);
      }
      slides.push(slide);
    }
    const source = await this.read(dir, 'original.pdf', MAX_SOURCE_BYTES);
    if (digest(source) !== digest(bytes)) fail();
    const manifest = { schema: 1, ...scope, source: { size: bytes.length, sha256: digest(bytes) }, slides };
    const json = JSON.stringify(manifest);
    await fs.writeFile(path.join(dir, 'manifest.json'), json, { flag: 'wx', mode: 0o400 });
    await fs.chmod(sourcePath, 0o400);
    return { json, digest: digest(json), slideCount: slides.length };
  }

  async image(row, slideId, variant) {
    if (!/^slide-\d{3}$/.test(slideId) || !['full', 'thumb'].includes(variant)) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
    try {
      const dir = this.directory(row);
      const manifestBytes = await this.read(dir, 'manifest.json', 2 * 1024 * 1024);
      if (digest(manifestBytes) !== row.manifestDigest || digest(row.manifestJson) !== row.manifestDigest) fail();
      const manifest = JSON.parse(manifestBytes);
      for (const key of ['eventId', 'deckId', 'versionId', 'attemptId']) if (manifest[key] !== row[key]) fail();
      if (manifest.schema !== 1 || manifest.slides.length !== row.slideCount) fail();
      const asset = manifest.slides.find(s => s.id === slideId)?.[variant];
      if (!asset) throw new EventAccessError('RESOURCE_NOT_FOUND', 404);
      const bytes = await this.read(dir, asset.file, MAX_IMAGE_BYTES);
      if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) fail();
      return bytes;
    } catch (error) {
      if (error instanceof EventAccessError) throw error;
      fail();
    }
  }
}

module.exports = { EventDeckPrivateStore, MAX_SOURCE_BYTES, MAX_PAGES, digest };
