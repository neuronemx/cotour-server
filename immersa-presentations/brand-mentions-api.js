const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const BRAND_MENTIONS_SCHEMA_VERSION = 1;
const BRAND_MENTION_INTERVAL_SECONDS = 120;
const BRAND_MENTION_DISPLAY_SECONDS = 8;
const MAX_BRANDS_PER_DECK = 50;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 4096;

class BrandMentionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "BrandMentionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeDeckId(value) {
  const deckId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(deckId)) {
    throw new BrandMentionError("INVALID_DECK_ID", "Invalid deck id");
  }
  return deckId;
}

function normalizeRequiredText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw new BrandMentionError(`INVALID_${field.toUpperCase()}`, `${field} is required`);
  if (text.length > maxLength) {
    throw new BrandMentionError(`INVALID_${field.toUpperCase()}`, `${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function normalizeTargetUrl(value) {
  let candidate = String(value || "").trim();
  if (!candidate) throw new BrandMentionError("INVALID_TARGET_URL", "url is required");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new BrandMentionError("INVALID_TARGET_URL", "url must be a valid HTTPS address");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new BrandMentionError("INVALID_TARGET_URL", "url must be a valid HTTPS address without credentials");
  }
  return parsed.href;
}

function displayDomain(targetUrl) {
  return new URL(targetUrl).hostname.replace(/^www\./i, "");
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new BrandMentionError("INVALID_ACTIVE", "active must be a boolean");
}

function jpegDimensions(buffer) {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    const frameHeader = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (frameHeader >= 0 && frameHeader + 7 <= buffer.length) {
      return {
        width: buffer.readUInt16LE(frameHeader + 3) & 0x3fff,
        height: buffer.readUInt16LE(frameHeader + 5) & 0x3fff
      };
    }
  }
  return null;
}

function detectLogo(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new BrandMentionError("INVALID_LOGO", "logo is required");
  }
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    const dimensions = jpegDimensions(buffer);
    if (dimensions) return { extension: ".jpg", mimeType: "image/jpeg", ...dimensions };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const dimensions = webpDimensions(buffer);
    if (dimensions) return { extension: ".webp", mimeType: "image/webp", ...dimensions };
  }
  throw new BrandMentionError("INVALID_LOGO", "logo must be a valid PNG, JPG or WebP image");
}

function normalizeLogoFile(file) {
  if (!file?.buffer) throw new BrandMentionError("LOGO_REQUIRED", "logo is required");
  if (file.buffer.length > MAX_LOGO_BYTES) {
    throw new BrandMentionError("LOGO_TOO_LARGE", "logo must be 5 MB or smaller", 413);
  }
  const detected = detectLogo(file.buffer);
  const originalExtension = path.extname(String(file.originalname || "")).toLowerCase();
  const compatibleExtensions = detected.extension === ".jpg" ? new Set([".jpg", ".jpeg"]) : new Set([detected.extension]);
  if (!compatibleExtensions.has(originalExtension)) {
    throw new BrandMentionError("LOGO_TYPE_MISMATCH", "logo extension does not match its image data");
  }
  const suppliedMime = String(file.mimetype || "").toLowerCase();
  if (suppliedMime && suppliedMime !== "application/octet-stream" && suppliedMime !== detected.mimeType) {
    throw new BrandMentionError("LOGO_TYPE_MISMATCH", "logo MIME type does not match its image data");
  }
  if (
    !Number.isInteger(detected.width) || !Number.isInteger(detected.height) ||
    detected.width < 1 || detected.height < 1 ||
    detected.width > MAX_LOGO_DIMENSION || detected.height > MAX_LOGO_DIMENSION
  ) {
    throw new BrandMentionError("INVALID_LOGO_DIMENSIONS", `logo dimensions must not exceed ${MAX_LOGO_DIMENSION} × ${MAX_LOGO_DIMENSION}`);
  }
  return detected;
}

function defaultBrandMentionConfig(deckId) {
  return {
    schema_version: BRAND_MENTIONS_SCHEMA_VERSION,
    deck_id: deckId,
    settings: {
      interval_seconds: BRAND_MENTION_INTERVAL_SECONDS,
      display_seconds: BRAND_MENTION_DISPLAY_SECONDS
    },
    brands: []
  };
}

function publicLogoUrl(deckId, fileName) {
  return `/decks/${encodeURIComponent(deckId)}/brand-assets/${encodeURIComponent(fileName)}`;
}

function safeAssetFilename(value) {
  const fileName = path.basename(String(value || ""));
  return /^logo-[a-f0-9-]+\.(?:png|jpg|webp)$/i.test(fileName) ? fileName : "";
}

class BrandMentionStore {
  constructor({ dataDecksDir, staticDecksDir }) {
    this.dataDecksDir = path.resolve(dataDecksDir);
    this.staticDecksDir = path.resolve(staticDecksDir);
    this.locks = new Map();
  }

  async withDeckLock(deckId, operation) {
    const key = String(deckId || "");
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  async findDeck(value, { writable = false } = {}) {
    const deckId = normalizeDeckId(value);
    const dataDeckDir = path.join(this.dataDecksDir, deckId);
    try {
      await fs.promises.access(path.join(dataDeckDir, "manifest.json"), fs.constants.R_OK);
      return { deckId, deckDir: dataDeckDir, writable: true };
    } catch (_error) {}

    const staticDeckDir = path.join(this.staticDecksDir, deckId);
    try {
      await fs.promises.access(path.join(staticDeckDir, "manifest.json"), fs.constants.R_OK);
      if (writable) throw new BrandMentionError("READ_ONLY_DECK", "Static decks cannot be edited", 403);
      return { deckId, deckDir: staticDeckDir, writable: false };
    } catch (error) {
      if (error instanceof BrandMentionError) throw error;
    }
    throw new BrandMentionError("DECK_NOT_FOUND", "Deck not found", 404);
  }

  normalizeStoredConfig(parsed, deckId) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.brands)) {
      throw new BrandMentionError("INVALID_BRAND_CONFIG", "Brand mention configuration is invalid", 500);
    }
    const brands = parsed.brands.map((brand, index) => {
      const targetUrl = normalizeTargetUrl(brand?.target_url || brand?.url);
      const fileName = safeAssetFilename(brand?.logo?.file_name || path.basename(String(brand?.logo?.src || "")));
      if (!fileName) throw new BrandMentionError("INVALID_BRAND_CONFIG", "Brand logo reference is invalid", 500);
      return {
        id: normalizeRequiredText(brand?.id, "brand id", 96),
        name: normalizeRequiredText(brand?.name, "name", 80),
        pitch: normalizeRequiredText(brand?.pitch, "pitch", 140),
        target_url: targetUrl,
        display_domain: displayDomain(targetUrl),
        active: normalizeBoolean(brand?.active, true),
        order: index + 1,
        logo: {
          file_name: fileName,
          src: publicLogoUrl(deckId, fileName),
          mime_type: String(brand?.logo?.mime_type || ""),
          size_bytes: Math.max(0, Number(brand?.logo?.size_bytes) || 0),
          width: Math.max(0, Number(brand?.logo?.width) || 0),
          height: Math.max(0, Number(brand?.logo?.height) || 0)
        }
      };
    });
    return { ...defaultBrandMentionConfig(deckId), brands };
  }

  async readConfigFromDeck(deck) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.join(deck.deckDir, "brand-mentions.json"), "utf8"));
      return this.normalizeStoredConfig(parsed, deck.deckId);
    } catch (error) {
      if (error.code === "ENOENT") return defaultBrandMentionConfig(deck.deckId);
      throw error;
    }
  }

  async read(deckId) {
    const deck = await this.findDeck(deckId);
    return this.readConfigFromDeck(deck);
  }

  async atomicWrite(deckDir, config) {
    const destination = path.join(deckDir, "brand-mentions.json");
    const temporary = path.join(deckDir, `.brand-mentions-${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  brandFields(input = {}, existing = null) {
    const targetUrl = input.url === undefined && input.target_url === undefined && existing
      ? existing.target_url
      : normalizeTargetUrl(input.target_url ?? input.url);
    return {
      name: input.name === undefined && existing ? existing.name : normalizeRequiredText(input.name, "name", 80),
      pitch: input.pitch === undefined && existing ? existing.pitch : normalizeRequiredText(input.pitch, "pitch", 140),
      target_url: targetUrl,
      display_domain: displayDomain(targetUrl),
      active: normalizeBoolean(input.active, existing?.active ?? true)
    };
  }

  async writeLogo(deck, file) {
    const detected = normalizeLogoFile(file);
    const fileName = `logo-${crypto.randomUUID()}${detected.extension}`;
    const assetsDir = path.join(deck.deckDir, "brand-assets");
    await fs.promises.mkdir(assetsDir, { recursive: true });
    await fs.promises.writeFile(path.join(assetsDir, fileName), file.buffer, { flag: "wx" });
    return {
      fileName,
      record: {
        file_name: fileName,
        src: publicLogoUrl(deck.deckId, fileName),
        mime_type: detected.mimeType,
        size_bytes: file.buffer.length,
        width: detected.width,
        height: detected.height
      }
    };
  }

  async removeLogo(deckDir, logo) {
    const fileName = safeAssetFilename(logo?.file_name || path.basename(String(logo?.src || "")));
    if (!fileName) return false;
    await fs.promises.rm(path.join(deckDir, "brand-assets", fileName), { force: true });
    return true;
  }

  async cleanupLogo(deckDir, logo) {
    try {
      return await this.removeLogo(deckDir, logo);
    } catch (error) {
      console.warn("Unable to clean obsolete brand logo", error.message);
      return false;
    }
  }

  async create(deckId, input, file) {
    return this.withDeckLock(deckId, async () => {
      const deck = await this.findDeck(deckId, { writable: true });
      const config = await this.readConfigFromDeck(deck);
      if (config.brands.length >= MAX_BRANDS_PER_DECK) {
        throw new BrandMentionError("BRAND_LIMIT_REACHED", `A deck can contain at most ${MAX_BRANDS_PER_DECK} brands`, 409);
      }
      const fields = this.brandFields(input);
      const storedLogo = await this.writeLogo(deck, file);
      const brand = {
        id: `brand_${crypto.randomUUID()}`,
        ...fields,
        order: config.brands.length + 1,
        logo: storedLogo.record
      };
      const next = { ...config, brands: [...config.brands, brand] };
      try {
        await this.atomicWrite(deck.deckDir, next);
      } catch (error) {
        await this.cleanupLogo(deck.deckDir, storedLogo.record);
        throw error;
      }
      return { config: next, brand };
    });
  }

  async update(deckId, brandId, input, file = null) {
    return this.withDeckLock(deckId, async () => {
      const deck = await this.findDeck(deckId, { writable: true });
      const config = await this.readConfigFromDeck(deck);
      const index = config.brands.findIndex((brand) => brand.id === String(brandId || ""));
      if (index < 0) throw new BrandMentionError("BRAND_NOT_FOUND", "Brand not found", 404);
      const current = config.brands[index];
      let storedLogo = null;
      if (file) storedLogo = await this.writeLogo(deck, file);
      const updated = {
        ...current,
        ...this.brandFields(input, current),
        logo: storedLogo?.record || current.logo
      };
      const brands = [...config.brands];
      brands[index] = updated;
      const next = { ...config, brands };
      try {
        await this.atomicWrite(deck.deckDir, next);
      } catch (error) {
        if (storedLogo) await this.cleanupLogo(deck.deckDir, storedLogo.record);
        throw error;
      }
      if (storedLogo) await this.cleanupLogo(deck.deckDir, current.logo);
      return { config: next, brand: updated };
    });
  }

  async remove(deckId, brandId) {
    return this.withDeckLock(deckId, async () => {
      const deck = await this.findDeck(deckId, { writable: true });
      const config = await this.readConfigFromDeck(deck);
      const index = config.brands.findIndex((brand) => brand.id === String(brandId || ""));
      if (index < 0) throw new BrandMentionError("BRAND_NOT_FOUND", "Brand not found", 404);
      const removed = config.brands[index];
      const brands = config.brands.filter((_brand, brandIndex) => brandIndex !== index)
        .map((brand, brandIndex) => ({ ...brand, order: brandIndex + 1 }));
      const next = { ...config, brands };
      await this.atomicWrite(deck.deckDir, next);
      await this.cleanupLogo(deck.deckDir, removed.logo);
      return { config: next, brand: removed };
    });
  }

  async reorder(deckId, brandIds) {
    return this.withDeckLock(deckId, async () => {
      const deck = await this.findDeck(deckId, { writable: true });
      const config = await this.readConfigFromDeck(deck);
      const ids = Array.isArray(brandIds) ? brandIds.map((id) => String(id || "")) : [];
      if (ids.length !== config.brands.length || new Set(ids).size !== ids.length) {
        throw new BrandMentionError("INVALID_BRAND_ORDER", "brand_ids must contain every brand exactly once");
      }
      const byId = new Map(config.brands.map((brand) => [brand.id, brand]));
      if (ids.some((id) => !byId.has(id))) {
        throw new BrandMentionError("INVALID_BRAND_ORDER", "brand_ids contains an unknown brand");
      }
      const brands = ids.map((id, index) => ({ ...byId.get(id), order: index + 1 }));
      const next = { ...config, brands };
      await this.atomicWrite(deck.deckDir, next);
      return next;
    });
  }
}

function createBrandMentionHandlers({ dataDecksDir, staticDecksDir, store = null }) {
  const brandStore = store || new BrandMentionStore({ dataDecksDir, staticDecksDir });
  const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 8 }
  }).single("logo");

  function failure(res, error) {
    const known = error instanceof BrandMentionError;
    const uploadError = error instanceof multer.MulterError;
    const statusCode = known ? error.statusCode : error?.code === "LIMIT_FILE_SIZE" ? 413 : uploadError ? 400 : 500;
    const code = known
      ? error.code
      : error?.code === "LIMIT_FILE_SIZE"
        ? "LOGO_TOO_LARGE"
        : uploadError
          ? "INVALID_LOGO_UPLOAD"
          : "BRAND_MENTIONS_UNAVAILABLE";
    if (statusCode >= 500) console.error("Brand mention operation failed", error);
    const message = known
      ? error.message
      : statusCode === 413
        ? "logo must be 5 MB or smaller"
        : uploadError
          ? "Invalid logo upload"
          : "Brand mention operation failed";
    return res.status(statusCode).json({ error: message, code });
  }

  function withLogoUpload(operation) {
    return (req, res) => {
      logoUpload(req, res, async (uploadError) => {
        if (uploadError) return failure(res, uploadError);
        try {
          await operation(req, res);
        } catch (error) {
          failure(res, error);
        }
      });
    };
  }

  async function getConfig(req, res) {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await brandStore.read(req.params.deckId));
    } catch (error) {
      failure(res, error);
    }
  }

  const createBrand = withLogoUpload(async (req, res) => {
    const result = await brandStore.create(req.params.deckId, req.body || {}, req.file);
    res.status(201).json(result);
  });

  const updateBrand = withLogoUpload(async (req, res) => {
    res.json(await brandStore.update(req.params.deckId, req.params.brandId, req.body || {}, req.file || null));
  });

  async function deleteBrand(req, res) {
    try {
      res.json(await brandStore.remove(req.params.deckId, req.params.brandId));
    } catch (error) {
      failure(res, error);
    }
  }

  async function reorderBrands(req, res) {
    try {
      res.json(await brandStore.reorder(req.params.deckId, req.body?.brand_ids));
    } catch (error) {
      failure(res, error);
    }
  }

  return { store: brandStore, getConfig, createBrand, updateBrand, deleteBrand, reorderBrands };
}

module.exports = {
  BrandMentionError,
  BrandMentionStore,
  createBrandMentionHandlers,
  defaultBrandMentionConfig,
  detectLogo,
  normalizeLogoFile,
  normalizeTargetUrl,
  constants: {
    BRAND_MENTIONS_SCHEMA_VERSION,
    BRAND_MENTION_INTERVAL_SECONDS,
    BRAND_MENTION_DISPLAY_SECONDS,
    MAX_BRANDS_PER_DECK,
    MAX_LOGO_BYTES,
    MAX_LOGO_DIMENSION
  }
};
