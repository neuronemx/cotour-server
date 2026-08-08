const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { detectLogo } = require("./brand-mentions-api");
const { ProfileValidationError } = require("./auth/profile-repository");

const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_PHOTO_DIMENSION = 4096;
const SAFE_PHOTO_KEY = /^profile-[a-f0-9-]+\.(?:png|jpg|webp)$/i;

class ProfilePhotoError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "ProfilePhotoError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeProfilePhoto(file) {
  if (!file?.buffer) throw new ProfilePhotoError("PHOTO_REQUIRED", "Selecciona una foto.");
  if (file.buffer.length > MAX_PROFILE_PHOTO_BYTES) {
    throw new ProfilePhotoError("PHOTO_TOO_LARGE", "La foto debe pesar máximo 5 MB.", 413);
  }
  let detected;
  try {
    detected = detectLogo(file.buffer);
  } catch (_error) {
    throw new ProfilePhotoError("INVALID_PHOTO", "La foto debe ser PNG, JPG o WebP.");
  }
  const originalExtension = path.extname(String(file.originalname || "")).toLowerCase();
  const compatibleExtensions = detected.extension === ".jpg" ? new Set([".jpg", ".jpeg"]) : new Set([detected.extension]);
  if (!compatibleExtensions.has(originalExtension)) {
    throw new ProfilePhotoError("PHOTO_TYPE_MISMATCH", "El tipo del archivo no coincide con la foto.");
  }
  const suppliedMime = String(file.mimetype || "").toLowerCase();
  if (suppliedMime && suppliedMime !== "application/octet-stream" && suppliedMime !== detected.mimeType) {
    throw new ProfilePhotoError("PHOTO_TYPE_MISMATCH", "El tipo del archivo no coincide con la foto.");
  }
  if (
    !Number.isInteger(detected.width) || !Number.isInteger(detected.height) ||
    detected.width < 1 || detected.height < 1 ||
    detected.width > MAX_PROFILE_PHOTO_DIMENSION || detected.height > MAX_PROFILE_PHOTO_DIMENSION
  ) {
    throw new ProfilePhotoError("INVALID_PHOTO_DIMENSIONS", "La foto no puede superar 4096 × 4096 px.");
  }
  return detected;
}

function safePhotoKey(value) {
  const key = path.basename(String(value || ""));
  return SAFE_PHOTO_KEY.test(key) ? key : "";
}

async function removePhotoFile(profilesDir, photoKey) {
  const key = safePhotoKey(photoKey);
  if (!key) return;
  await fs.promises.unlink(path.join(profilesDir, key)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function createProfileHandlers({ bridge, profilesDir }) {
  if (!bridge) throw new Error("An Auth bridge is required for profiles");
  const resolvedProfilesDir = path.resolve(profilesDir);
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1, fields: 2 }
  }).single("photo");

  function failure(res, error) {
    const validation = error instanceof ProfileValidationError || error instanceof ProfilePhotoError;
    const uploadError = error instanceof multer.MulterError;
    const statusCode = validation ? error.statusCode : error?.code === "LIMIT_FILE_SIZE" ? 413 : uploadError ? 400 : 500;
    if (statusCode >= 500) console.error("Profile operation failed", error);
    const message = validation
      ? error.message
      : statusCode === 413
        ? "La foto debe pesar máximo 5 MB."
        : uploadError
          ? "No se pudo leer la foto."
          : "No se pudo guardar el perfil.";
    return res.status(statusCode).json({ error: message, code: validation ? error.code : "PROFILE_UNAVAILABLE" });
  }

  async function getProfile(req, res) {
    try {
      const profile = await bridge.getAccountProfile(req);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ profile });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function saveProfile(req, res) {
    try {
      const profile = await bridge.saveAccountProfile(req, req.body || {});
      res.setHeader("Cache-Control", "no-store");
      return res.json({ profile });
    } catch (error) {
      return failure(res, error);
    }
  }

  function uploadPhoto(req, res) {
    photoUpload(req, res, async (uploadError) => {
      if (uploadError) return failure(res, uploadError);
      let pendingPath = "";
      let savedPath = "";
      try {
        const detected = normalizeProfilePhoto(req.file);
        await fs.promises.mkdir(resolvedProfilesDir, { recursive: true });
        const nextKey = `profile-${crypto.randomUUID()}${detected.extension}`;
        pendingPath = path.join(resolvedProfilesDir, `${nextKey}.tmp`);
        await fs.promises.writeFile(pendingPath, req.file.buffer, { flag: "wx" });
        savedPath = path.join(resolvedProfilesDir, nextKey);
        await fs.promises.rename(pendingPath, savedPath);
        pendingPath = "";
        const previousKey = await bridge.getAccountPhotoKey(req);
        const profile = await bridge.setAccountPhotoKey(req, nextKey);
        savedPath = "";
        await removePhotoFile(resolvedProfilesDir, previousKey).catch((error) => {
          console.warn("Unable to remove the previous profile photo", error.message);
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json({ profile });
      } catch (error) {
        if (pendingPath) await fs.promises.unlink(pendingPath).catch(() => {});
        if (savedPath) await fs.promises.unlink(savedPath).catch(() => {});
        return failure(res, error);
      }
    });
  }

  async function deletePhoto(req, res) {
    try {
      const previousKey = await bridge.getAccountPhotoKey(req);
      const profile = await bridge.setAccountPhotoKey(req, null);
      await removePhotoFile(resolvedProfilesDir, previousKey).catch((error) => {
        console.warn("Unable to remove the previous profile photo", error.message);
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ profile });
    } catch (error) {
      return failure(res, error);
    }
  }

  async function getDeckSpeakerProfile(req, res) {
    try {
      const profile = await bridge.getDeckSpeakerProfile(req.params.deckId);
      res.setHeader("Cache-Control", "no-store");
      if (!profile?.displayName) return res.json({ available: false, profile: null });
      const { hasUploadedPhoto: _accountOnlyPhotoState, ...publicProfile } = profile;
      return res.json({ available: true, profile: publicProfile });
    } catch (error) {
      return failure(res, error);
    }
  }

  return { getProfile, saveProfile, uploadPhoto, deletePhoto, getDeckSpeakerProfile };
}

module.exports = {
  createProfileHandlers,
  normalizeProfilePhoto,
  safePhotoKey,
  ProfilePhotoError,
  constants: { MAX_PROFILE_PHOTO_BYTES, MAX_PROFILE_PHOTO_DIMENSION }
};
