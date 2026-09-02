const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { generateUniqueSessionId, manifestSessionId } = require('./session-id');

const APP_DIR = __dirname;
const PUBLIC_DECKS_DIR = path.join(APP_DIR, 'public', 'decks');
const DATA_DIR = process.env.IMMERSA_DATA_DIR ? path.resolve(process.env.IMMERSA_DATA_DIR) : path.join(APP_DIR, 'data');
const DATA_DECKS_DIR = path.join(DATA_DIR, 'decks');
const DATA_TMP_DIR = path.join(DATA_DIR, 'tmp');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizeId(value, fallback = 'deck') {
  const normalized = String(value || fallback)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

async function ensureDataDirs() {
  await fs.promises.mkdir(DATA_DECKS_DIR, { recursive: true });
  await fs.promises.mkdir(DATA_TMP_DIR, { recursive: true });
}

function deckExists(deckId) {
  return fs.existsSync(path.join(PUBLIC_DECKS_DIR, deckId)) || fs.existsSync(path.join(DATA_DECKS_DIR, deckId));
}

async function uniqueDeckId(baseId) {
  await ensureDataDirs();
  const base = normalizeId(baseId);
  let candidate = base;
  let suffix = 2;
  while (deckExists(candidate)) {
    candidate = base + '-' + suffix;
    suffix += 1;
  }
  return candidate;
}

async function collectUsedSessionIds(rootDirs = [PUBLIC_DECKS_DIR, DATA_DECKS_DIR]) {
  const usedSessionIds = new Set();
  for (const rootDir of rootDirs) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await fs.promises.readFile(path.join(rootDir, entry.name, 'manifest.json'), 'utf8'));
        const sessionId = manifestSessionId(manifest);
        if (sessionId) usedSessionIds.add(sessionId);
      } catch (_error) {
        // Ignore incomplete or invalid deck folders while reserving IDs for valid manifests.
      }
    }
  }
  return usedSessionIds;
}

function ensureManifestHasSessionId(manifest, sessionId) {
  if (manifestSessionId(manifest)) return manifest;
  return { ...manifest, session_id: sessionId };
}

function placeholderSvg(title, sourceType) {
  const sourceLabel = sourceType === 'pdf' ? 'PDF' : 'PPTX';
  const safeTitle = String(title || 'Presentacion cargada')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="' + sourceLabel + ' cargado, conversion pendiente">',
    '<rect width="1600" height="900" fill="#07090d"/>',
    '<rect x="120" y="110" width="1360" height="680" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>',
    '<text x="160" y="178" fill="#f3d27a" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="7">IMMERSA</text>',
    '<text x="800" y="382" fill="#f7f2e8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="74" font-weight="850" text-anchor="middle">' + sourceLabel + ' cargado</text>',
    '<text x="800" y="468" fill="#68d8cc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="38" font-weight="700" text-anchor="middle">Conversion pendiente</text>',
    '<text x="800" y="548" fill="#c8d2ce" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" text-anchor="middle">' + safeTitle + '</text>',
    '</svg>',
    ''
  ].join('\n');
}

function manifestSummary(manifest) {
  const slides = Array.isArray(manifest.slides) ? manifest.slides.length : 0;
  const status = manifest.status || 'ready';
  const conversionStatus = manifest.conversion?.status || 'ready';
  const realSlideCount = (status === 'converted' && conversionStatus === 'completed') || (status === 'ready' && conversionStatus === 'ready');
  return {
    deckId: manifest.deckId,
    title: manifest.title,
    session_id: manifestSessionId(manifest),
    slides,
    slideCount: realSlideCount ? slides : null,
    placeholderSlides: realSlideCount ? 0 : slides,
    ratio: manifest.ratio || '16:9',
    status,
    conversionStatus,
    conversionMessage: manifest.conversion?.message || '',
    sourceSizeBytes: Number(manifest.source?.sizeBytes || 0),
    associationsReviewRequired: Boolean(manifest.replacement?.associationsReviewRequired),
    replacement: manifest.replacement || null,
    thumbnail: manifest.slides?.[0]?.thumb || manifest.slides?.[0]?.src || ''
  };
}

function withAssetRevision(value, revision) {
  if (!value || typeof value !== 'string' || /^(?:https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  const separator = value.includes('?') ? '&' : '?';
  return value + separator + 'v=' + encodeURIComponent(revision);
}

function reviseSlideAssets(manifest, revision) {
  return {
    ...manifest,
    slides: Array.isArray(manifest.slides) ? manifest.slides.map((slide) => ({
      ...slide,
      src: withAssetRevision(slide.src, revision),
      thumb: withAssetRevision(slide.thumb, revision),
      poster: withAssetRevision(slide.poster, revision),
      fallback: withAssetRevision(slide.fallback, revision)
    })) : []
  };
}

async function writeManifest(deckDir, manifest, sessionId) {
  const manifestToWrite = sessionId ? ensureManifestHasSessionId(manifest, sessionId) : manifest;
  await fs.promises.writeFile(path.join(deckDir, 'manifest.json'), JSON.stringify(manifestToWrite, null, 2) + '\n');
  return manifestToWrite;
}

async function commandExists(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(lookup, [command], { timeout: 10000 });
    return true;
  } catch (_error) {
    return false;
  }
}

async function findLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'libreoffice',
    'soffice',
    process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : null
  ].filter(Boolean);
  for (const command of candidates) {
    try {
      await execFileAsync(command, ['--version'], { timeout: 10000 });
      return command;
    } catch (_error) {
      // Try next candidate.
    }
  }
  throw new Error('LibreOffice no esta disponible. La conversion no pudo completarse.');
}

async function assertPdftoppm() {
  if (!(await commandExists('pdftoppm'))) throw new Error('pdftoppm no esta disponible. La conversion no pudo completarse.');
  try {
    await execFileAsync('pdftoppm', ['-v'], { timeout: 10000 });
  } catch (error) {
    const output = String(error.stdout || '') + String(error.stderr || '');
    if (/command not found|not recognized|no such file/i.test(output)) {
      throw new Error('pdftoppm no esta disponible. La conversion no pudo completarse.');
    }
  }
}

function naturalSlideNumber(fileName) {
  const match = fileName.match(/-(\d+)\.jpe?g$/i) || fileName.match(/(\d+)\.jpe?g$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length - 9) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

async function imageOrientation(filePath) {
  try {
    const dimensions = jpegDimensions(await fs.promises.readFile(filePath));
    if (!dimensions) return undefined;
    if (Math.abs(dimensions.width - dimensions.height) <= 2) return 'square';
    return dimensions.height > dimensions.width ? 'portrait' : 'landscape';
  } catch (_error) {
    return undefined;
  }
}

async function normalizeRenderedImages(sourceDir, targetDir, withMetadata = false) {
  const files = (await fs.promises.readdir(sourceDir))
    .filter((file) => /\.jpe?g$/i.test(file))
    .sort((a, b) => naturalSlideNumber(a) - naturalSlideNumber(b));
  const normalized = [];
  for (let index = 0; index < files.length; index += 1) {
    const nextName = 'slide-' + String(index + 1).padStart(3, '0') + '.jpg';
    const targetPath = path.join(targetDir, nextName);
    await fs.promises.copyFile(path.join(sourceDir, files[index]), targetPath);
    normalized.push(withMetadata ? { fileName: nextName, orientation: await imageOrientation(targetPath) } : nextName);
  }
  return normalized;
}

async function renderPdf(pdfPath, outputDir, prefix, width, quality) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  await execFileAsync('pdftoppm', [
    '-jpeg',
    '-r', '150',
    '-scale-to-x', String(width),
    '-scale-to-y', '-1',
    '-jpegopt', 'quality=' + quality,
    pdfPath,
    path.join(outputDir, prefix)
  ], { timeout: 120000 });
}

async function convertPdfToSlides({ deckDir, pdfPath, manifest, sourceType, sourceFilename, titlePrefix, ratio }) {
  await assertPdftoppm();
  const workDir = path.join(DATA_TMP_DIR, manifest.deckId || path.basename(deckDir));
  const fullRawDir = path.join(workDir, 'full');
  const thumbRawDir = path.join(workDir, 'thumbs');
  const slidesDir = path.join(deckDir, 'slides');
  const thumbsDir = path.join(deckDir, 'thumbs');

  await fs.promises.rm(fullRawDir, { recursive: true, force: true });
  await fs.promises.rm(thumbRawDir, { recursive: true, force: true });
  await fs.promises.rm(slidesDir, { recursive: true, force: true });
  await fs.promises.rm(thumbsDir, { recursive: true, force: true });
  await fs.promises.mkdir(slidesDir, { recursive: true });
  await fs.promises.mkdir(thumbsDir, { recursive: true });

  await renderPdf(pdfPath, fullRawDir, 'slide', 1920, 85);
  await renderPdf(pdfPath, thumbRawDir, 'slide', 320, 75);

  const slideFiles = await normalizeRenderedImages(fullRawDir, slidesDir, true);
  const thumbFiles = await normalizeRenderedImages(thumbRawDir, thumbsDir);
  if (!slideFiles.length) throw new Error('No se generaron imagenes JPG desde el PDF.');

  const count = Math.min(slideFiles.length, thumbFiles.length || slideFiles.length);
  manifest.status = 'converted';
  manifest.ratio = ratio;
  manifest.source = { type: sourceType, filename: sourceFilename };
  manifest.slides = Array.from({ length: count }, (_item, index) => {
    const slideInfo = slideFiles[index];
    const fileName = slideInfo.fileName;
    const slide = {
      id: fileName.replace(/\.jpg$/i, ''),
      src: 'slides/' + fileName,
      thumb: 'thumbs/' + (thumbFiles[index] || fileName),
      title: titlePrefix + ' ' + (index + 1)
    };
    if (slideInfo.orientation) slide.orientation = slideInfo.orientation;
    return slide;
  });
  manifest.conversion = {
    status: 'completed',
    message: 'Conversion completada',
    format: 'jpg',
    sourceType,
    slideResolution: '1920px ancho',
    thumbResolution: '320px ancho'
  };

  await fs.promises.rm(workDir, { recursive: true, force: true });
  return manifest;
}

async function convertDeckPptx({ deckDir, pptxPath, manifest }) {
  const libreOffice = await findLibreOffice();
  const workDir = path.join(DATA_TMP_DIR, manifest.deckId || path.basename(deckDir));
  const pdfDir = path.join(workDir, 'pdf');
  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.mkdir(pdfDir, { recursive: true });
  await execFileAsync(libreOffice, ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, pptxPath], { timeout: 120000 });
  const pdfFiles = (await fs.promises.readdir(pdfDir)).filter((file) => file.toLowerCase().endsWith('.pdf'));
  if (!pdfFiles.length) throw new Error('No se genero PDF desde el PPTX.');
  return convertPdfToSlides({ deckDir, pdfPath: path.join(pdfDir, pdfFiles[0]), manifest, sourceType: 'pptx', sourceFilename: 'original.pptx', titlePrefix: 'Slide', ratio: '16:9' });
}

async function convertDeckPdf({ deckDir, pdfPath, manifest }) {
  const workDir = path.join(DATA_TMP_DIR, manifest.deckId || path.basename(deckDir));
  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.mkdir(workDir, { recursive: true });
  return convertPdfToSlides({ deckDir, pdfPath, manifest, sourceType: 'pdf', sourceFilename: 'original.pdf', titlePrefix: 'Pagina', ratio: 'mixed' });
}

async function directorySizeBytes(directory) {
  let total = 0;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySizeBytes(target);
    else if (entry.isFile()) total += Number((await fs.promises.stat(target)).size || 0);
  }
  return total;
}

async function discardConvertedSource(deckDir, sourceFilename) {
  const filename = String(sourceFilename || "");
  if (!/^original\.(pdf|pptx)$/i.test(filename)) return;
  await fs.promises.rm(path.join(deckDir, filename), { force: true });
}

function createUploadHandler(options = {}) {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  return (req, res) => {
    upload.single('pptx')(req, res, async (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el limite de 100 MB' : 'No se pudo recibir el archivo';
        return res.status(400).json({ error: message });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Falta el archivo' });
      const sourceExt = path.extname(file.originalname).toLowerCase();
      const sourceType = sourceExt === '.pdf' ? 'pdf' : sourceExt === '.pptx' ? 'pptx' : null;
      if (!sourceType) return res.status(400).json({ error: 'Solo se aceptan archivos .pptx o .pdf' });

      let reservedDeck = null;
      let deckDir = null;
      try {
        await ensureDataDirs();
        const sourceTitle = req.body.title || path.basename(file.originalname, path.extname(file.originalname));
        const requestedDeckId = options.fixedDeckId || req.body.deckId || sourceTitle;
        const deckId = options.fixedDeckId ? normalizeId(requestedDeckId) : await uniqueDeckId(requestedDeckId);
        if (options.fixedDeckId && deckExists(deckId)) {
          throw replacementError(409, 'La presentación ya existe', 'DECK_ALREADY_EXISTS');
        }
        const session_id = generateUniqueSessionId(await collectUsedSessionIds());
        const sourceSizeBytes = Number(file.size || file.buffer?.length || 0);
        reservedDeck = { deckId, session_id, sourceSizeBytes };
        if (options.onDeckCreateStart) {
          await options.onDeckCreateStart({ req, file, deck: reservedDeck });
        } else {
          reservedDeck = null;
        }

        deckDir = path.join(DATA_DECKS_DIR, deckId);
        const slidesDir = path.join(deckDir, 'slides');
        const sourceFilename = sourceType === 'pdf' ? 'original.pdf' : 'original.pptx';
        const originalPath = path.join(deckDir, sourceFilename);
        await fs.promises.mkdir(slidesDir, { recursive: true });
        await fs.promises.writeFile(originalPath, file.buffer);

        const title = String(sourceTitle || deckId).trim() || deckId;
        let manifest = {
          deckId,
          title,
          session_id,
          ratio: sourceType === 'pdf' ? 'mixed' : '16:9',
          status: 'uploaded',
          source: { type: sourceType, filename: sourceFilename, sizeBytes: sourceSizeBytes },
          slides: [{ id: 'placeholder', src: 'slides/placeholder.svg', title: 'Presentacion cargada' }],
          conversion: { status: 'pending', message: sourceType === 'pdf' ? 'Convirtiendo PDF' : 'Convirtiendo PPTX' }
        };

        await fs.promises.writeFile(path.join(slidesDir, 'placeholder.svg'), placeholderSvg(title, sourceType));
        manifest = await writeManifest(deckDir, manifest, session_id);

        try {
          manifest = sourceType === 'pdf'
            ? await convertDeckPdf({ deckDir, pdfPath: originalPath, manifest })
            : await convertDeckPptx({ deckDir, pptxPath: originalPath, manifest });
          await discardConvertedSource(deckDir, sourceFilename);
          manifest.source = { ...(manifest.source || {}), type: sourceType, filename: null, sizeBytes: sourceSizeBytes };
        } catch (conversionError) {
          await fs.promises.rm(path.join(DATA_TMP_DIR, deckId), { recursive: true, force: true });
          manifest.status = 'conversion_failed';
          manifest.conversion = { status: 'failed', message: conversionError.message || 'La conversion no pudo completarse' };
        }

        if (options.decorateManifest) {
          manifest = await options.decorateManifest({ req, file, manifest, deck: { deckId, session_id, sourceSizeBytes } }) || manifest;
        }

        manifest = await writeManifest(deckDir, manifest, session_id);
        const meteredStorageBytes = await directorySizeBytes(deckDir);
        if (options.onDeckCreateFinalized) {
          await options.onDeckCreateFinalized({ req, manifest, deck: { deckId, session_id, sourceSizeBytes: meteredStorageBytes } });
        }
        const summary = manifestSummary(manifest);
        if (!options.onDeckCreateStart && options.onDeckCreated) {
          try {
            await options.onDeckCreated({ req, manifest, deck: { ...summary, sourceSizeBytes } });
          } catch (ownershipError) {
            await fs.promises.rm(deckDir, { recursive: true, force: true }).catch(() => {});
            throw ownershipError;
          }
        }
        return res.status(201).json(summary);
      } catch (writeError) {
        if (reservedDeck && options.onDeckCreateFailed) {
          await options.onDeckCreateFailed({ req, deck: reservedDeck, error: writeError }).catch((cleanupError) => {
            console.error('Unable to release failed deck reservation', cleanupError);
          });
        }
        if (deckDir) await fs.promises.rm(deckDir, { recursive: true, force: true }).catch(() => {});
        const statusCode = Number(writeError.statusCode) || 500;
        if (statusCode >= 500) console.error('Unable to store presentation', writeError);
        const payload = { error: writeError.publicMessage || 'No se pudo guardar la presentacion' };
        if (statusCode < 500 && writeError.code) payload.code = writeError.code;
        if (statusCode < 500 && writeError.details) payload.plan = writeError.details;
        return res.status(statusCode).json(payload);
      }
    });
  };
}

function replacementError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  if (code) error.code = code;
  return error;
}

function replacementDeckDir(deckId) {
  const normalized = String(deckId || '').trim();
  if (!normalized || !/^[a-z0-9][a-z0-9-]*$/i.test(normalized)) {
    throw replacementError(400, 'Identificador de presentación inválido', 'INVALID_DECK_ID');
  }
  const deckDir = path.resolve(DATA_DECKS_DIR, normalized);
  const root = path.resolve(DATA_DECKS_DIR) + path.sep;
  if (!deckDir.startsWith(root)) throw replacementError(400, 'Identificador de presentación inválido', 'INVALID_DECK_ID');
  return { deckId: normalized, deckDir };
}

async function moveReplacementIntoPlace({ deckDir, nextDir, backupDir }) {
  await fs.promises.rename(deckDir, backupDir);
  try {
    await fs.promises.rename(nextDir, deckDir);
  } catch (error) {
    await fs.promises.rename(backupDir, deckDir).catch(() => {});
    throw error;
  }
}

async function restoreReplacement({ deckDir, backupDir, failedDir }) {
  await fs.promises.rename(deckDir, failedDir).catch(() => {});
  await fs.promises.rename(backupDir, deckDir);
  await fs.promises.rm(failedDir, { recursive: true, force: true }).catch(() => {});
}

async function buildReplacementDirectory({ deckDir, stageDir, nextDir, manifest }) {
  await fs.promises.cp(deckDir, nextDir, { recursive: true, errorOnExist: true });
  for (const name of ['slides', 'thumbs', 'original.pdf', 'original.pptx', 'manifest.json']) {
    await fs.promises.rm(path.join(nextDir, name), { recursive: true, force: true });
  }
  await fs.promises.cp(path.join(stageDir, 'slides'), path.join(nextDir, 'slides'), { recursive: true });
  await fs.promises.cp(path.join(stageDir, 'thumbs'), path.join(nextDir, 'thumbs'), { recursive: true });
  await writeManifest(nextDir, manifest, manifestSessionId(manifest));
}

function createDeckReplacementHandler(options = {}) {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  return (req, res) => {
    upload.single('pptx')(req, res, async (uploadError) => {
      if (uploadError) {
        const message = uploadError.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el límite permitido' : 'No se pudo recibir el archivo';
        return res.status(400).json({ error: message });
      }

      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Falta el archivo' });
      const sourceExt = path.extname(file.originalname).toLowerCase();
      const sourceType = sourceExt === '.pdf' ? 'pdf' : sourceExt === '.pptx' ? 'pptx' : null;
      if (!sourceType) return res.status(400).json({ error: 'Solo se aceptan archivos .pptx o .pdf' });

      let paths = null;
      let swapped = false;
      let lockDir = null;
      try {
        await ensureDataDirs();
        const { deckId, deckDir } = replacementDeckDir(req.params.deckId);
        const currentManifest = JSON.parse(await fs.promises.readFile(path.join(deckDir, 'manifest.json'), 'utf8'));
        const replacementId = crypto.randomUUID();
        lockDir = path.join(DATA_TMP_DIR, deckId + '-replacement.lock');
        try {
          await fs.promises.mkdir(lockDir);
        } catch (error) {
          if (error.code === 'EEXIST') throw replacementError(409, 'Ya hay una sustitución en curso para esta presentación.', 'REPLACEMENT_IN_PROGRESS');
          throw error;
        }

        const stageDir = path.join(DATA_TMP_DIR, deckId + '-replacement-' + replacementId);
        const nextDir = path.join(DATA_DECKS_DIR, '.' + deckId + '-next-' + replacementId);
        const backupDir = path.join(DATA_DECKS_DIR, '.' + deckId + '-backup-' + replacementId);
        const failedDir = path.join(DATA_DECKS_DIR, '.' + deckId + '-failed-' + replacementId);
        paths = { deckDir, stageDir, nextDir, backupDir, failedDir };
        await fs.promises.mkdir(stageDir, { recursive: true });

        const sourceFilename = sourceType === 'pdf' ? 'original.pdf' : 'original.pptx';
        const originalPath = path.join(stageDir, sourceFilename);
        const slidesDir = path.join(stageDir, 'slides');
        const sourceSizeBytes = Number(file.size || file.buffer?.length || 0);
        await fs.promises.mkdir(slidesDir, { recursive: true });
        await fs.promises.writeFile(originalPath, file.buffer);

        const sessionId = manifestSessionId(currentManifest);
        const previousSlideCount = Array.isArray(currentManifest.slides) ? currentManifest.slides.length : 0;
        let nextManifest = {
          ...currentManifest,
          deckId,
          session_id: sessionId,
          status: 'uploaded',
          ratio: sourceType === 'pdf' ? 'mixed' : '16:9',
          source: { type: sourceType, filename: sourceFilename, sizeBytes: sourceSizeBytes },
          slides: [{ id: 'placeholder', src: 'slides/placeholder.svg', title: 'Presentación cargada' }],
          conversion: { status: 'pending', message: sourceType === 'pdf' ? 'Convirtiendo PDF' : 'Convirtiendo PPTX' }
        };
        await fs.promises.writeFile(path.join(slidesDir, 'placeholder.svg'), placeholderSvg(currentManifest.title || deckId, sourceType));

        try {
          const convertPdf = options.convertDeckPdf || convertDeckPdf;
          const convertPptx = options.convertDeckPptx || convertDeckPptx;
          nextManifest = sourceType === 'pdf'
            ? await convertPdf({ deckDir: stageDir, pdfPath: originalPath, manifest: nextManifest })
            : await convertPptx({ deckDir: stageDir, pptxPath: originalPath, manifest: nextManifest });
          await discardConvertedSource(stageDir, sourceFilename);
          nextManifest.source = { ...(nextManifest.source || {}), type: sourceType, filename: null, sizeBytes: sourceSizeBytes };
        } catch (conversionError) {
          throw replacementError(422, conversionError.message || 'La conversión no pudo completarse', 'CONVERSION_FAILED');
        }

        nextManifest = reviseSlideAssets(nextManifest, replacementId);
        const nextSlideCount = Array.isArray(nextManifest.slides) ? nextManifest.slides.length : 0;
        const associationsReviewRequired = previousSlideCount !== nextSlideCount;
        nextManifest.replacement = {
          replacedAt: new Date().toISOString(),
          previousSlideCount,
          nextSlideCount,
          associationsReviewRequired,
          reviewedAt: associationsReviewRequired ? null : new Date().toISOString()
        };

        await buildReplacementDirectory({ deckDir, stageDir, nextDir, manifest: nextManifest });
        const meteredStorageBytes = await directorySizeBytes(nextDir);
        if (options.beforeDeckSwap) await options.beforeDeckSwap({ req, deck: { deckId, sourceSizeBytes: meteredStorageBytes }, manifest: nextManifest });
        await moveReplacementIntoPlace({ deckDir, nextDir, backupDir });
        swapped = true;

        let plan = null;
        if (options.onDeckReplaced) {
          const result = await options.onDeckReplaced({ req, deck: { deckId, sourceSizeBytes: meteredStorageBytes }, manifest: nextManifest });
          plan = result?.plan || result || null;
        }

        await fs.promises.rm(backupDir, { recursive: true, force: true });
        swapped = false;
        const summary = manifestSummary(nextManifest);
        return res.json({
          ...summary,
          plan,
          previousSlideCount,
          nextSlideCount,
          associationsReviewRequired
        });
      } catch (error) {
        if (swapped && paths) {
          await restoreReplacement(paths).catch((restoreError) => {
            console.error('Unable to restore presentation after replacement failure', restoreError);
          });
        }
        const statusCode = Number(error.statusCode) || (error.code === 'ENOENT' ? 404 : 500);
        if (statusCode >= 500) console.error('Unable to replace presentation', error);
        const payload = { error: error.publicMessage || (statusCode === 404 ? 'Presentación no encontrada' : 'No se pudo sustituir la presentación') };
        if (statusCode < 500 && error.code) payload.code = error.code;
        if (statusCode < 500 && error.details) payload.plan = error.details;
        return res.status(statusCode).json(payload);
      } finally {
        if (paths) {
          await Promise.all([
            fs.promises.rm(paths.stageDir, { recursive: true, force: true }),
            fs.promises.rm(paths.nextDir, { recursive: true, force: true }),
            swapped ? Promise.resolve() : fs.promises.rm(paths.backupDir, { recursive: true, force: true }),
            fs.promises.rm(paths.failedDir, { recursive: true, force: true })
          ]).catch(() => {});
        }
        if (lockDir) await fs.promises.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  };
}

module.exports = {
  createUploadHandler,
  createDeckReplacementHandler,
  convertDeckPdf,
  convertDeckPptx,
  convertPdfToSlides,
  directorySizeBytes
};
