const PROFILE_LIMITS = Object.freeze({
  displayName: 120,
  roleTitle: 120,
  company: 120,
  bio: 600,
  url: 500
});

const PUBLIC_TITLES = Object.freeze([
  "Speaker",
  "Ponente",
  "Presentador",
  "Presentadora",
  "Profesor",
  "Profesora",
  "Facilitador",
  "Facilitadora"
]);
const PUBLIC_TITLE_SET = new Set(PUBLIC_TITLES);

class ProfileValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProfileValidationError";
    this.code = code;
    this.statusCode = 400;
  }
}

const PROFILE_FIELD_LABELS = Object.freeze({
  display_name: "El nombre completo",
  role_title: "El cargo o especialidad",
  company: "La empresa",
  bio: "Acerca de",
  website_url: "El sitio web",
  linkedin_url: "El enlace de LinkedIn",
  instagram_url: "El enlace de Instagram"
});

function normalizeText(value, field, maxLength, { required = false } = {}) {
  const normalized = String(value || "").trim();
  const label = PROFILE_FIELD_LABELS[field] || "El campo";
  if (required && !normalized) throw new ProfileValidationError(`INVALID_${field.toUpperCase()}`, `${label} es obligatorio.`);
  if (normalized.length > maxLength) {
    throw new ProfileValidationError(`INVALID_${field.toUpperCase()}`, `${label} puede tener máximo ${maxLength} caracteres.`);
  }
  return normalized;
}

function normalizeProfileUrl(value, field) {
  let candidate = normalizeText(value, field, PROFILE_LIMITS.url);
  if (!candidate) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new ProfileValidationError(`INVALID_${field.toUpperCase()}`, `${PROFILE_FIELD_LABELS[field] || "El enlace"} debe ser una dirección HTTPS válida.`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new ProfileValidationError(`INVALID_${field.toUpperCase()}`, `${PROFILE_FIELD_LABELS[field] || "El enlace"} debe ser una dirección HTTPS válida y sin credenciales.`);
  }
  if (parsed.href.length > PROFILE_LIMITS.url) {
    throw new ProfileValidationError(`INVALID_${field.toUpperCase()}`, `${PROFILE_FIELD_LABELS[field] || "El enlace"} puede tener máximo ${PROFILE_LIMITS.url} caracteres.`);
  }
  return parsed.href;
}

function normalizePublicTitle(value) {
  const normalized = String(value ?? "Speaker").trim() || "Speaker";
  if (!PUBLIC_TITLE_SET.has(normalized)) {
    throw new ProfileValidationError("INVALID_PUBLIC_TITLE", "Selecciona una forma válida de presentarte ante tu audiencia.");
  }
  return normalized;
}

function normalizeProfileInput(input = {}) {
  return {
    displayName: normalizeText(input.displayName, "display_name", PROFILE_LIMITS.displayName, { required: true }),
    publicTitle: normalizePublicTitle(input.publicTitle),
    roleTitle: normalizeText(input.roleTitle, "role_title", PROFILE_LIMITS.roleTitle),
    company: normalizeText(input.company, "company", PROFILE_LIMITS.company),
    bio: normalizeText(input.bio, "bio", PROFILE_LIMITS.bio),
    websiteUrl: normalizeProfileUrl(input.websiteUrl, "website_url"),
    linkedinUrl: normalizeProfileUrl(input.linkedinUrl, "linkedin_url"),
    instagramUrl: normalizeProfileUrl(input.instagramUrl, "instagram_url")
  };
}

function publicPhotoUrl(photoKey, fallbackImage = "") {
  const key = String(photoKey || "").trim();
  if (/^profile-[a-f0-9-]+\.(?:png|jpg|webp)$/i.test(key)) {
    return `/profile-images/${encodeURIComponent(key)}`;
  }
  const fallback = String(fallbackImage || "").trim();
  return /^https:\/\//i.test(fallback) ? fallback : "";
}

function mapProfileRow(row) {
  if (!row) return null;
  return {
    displayName: String(row.display_name || row.auth_name || "").trim(),
    publicTitle: PUBLIC_TITLE_SET.has(String(row.public_title || "").trim()) ? String(row.public_title).trim() : "Speaker",
    roleTitle: String(row.role_title || "").trim(),
    company: String(row.company || "").trim(),
    bio: String(row.bio || "").trim(),
    websiteUrl: String(row.website_url || "").trim(),
    linkedinUrl: String(row.linkedin_url || "").trim(),
    instagramUrl: String(row.instagram_url || "").trim(),
    photoUrl: publicPhotoUrl(row.photo_key, row.auth_image),
    hasUploadedPhoto: Boolean(String(row.photo_key || "").trim())
  };
}

class ProfileRepository {
  constructor(pool) {
    if (!pool) throw new Error("A MySQL pool is required for Immersa profiles");
    this.pool = pool;
  }

  async getAccountProfile(userId) {
    const [rows] = await this.pool.execute(
      `SELECT u.name AS auth_name, u.image AS auth_image,
              p.display_name, p.public_title, p.role_title, p.company, p.bio,
              p.website_url, p.linkedin_url, p.instagram_url, p.photo_key
       FROM \`user\` u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [String(userId)]
    );
    return mapProfileRow(rows?.[0]);
  }

  async saveAccountProfile(userId, input) {
    const profile = normalizeProfileInput(input);
    await this.pool.execute(
      `INSERT INTO user_profiles
         (user_id, display_name, public_title, role_title, company, bio, website_url, linkedin_url, instagram_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         public_title = VALUES(public_title),
         role_title = VALUES(role_title),
         company = VALUES(company),
         bio = VALUES(bio),
         website_url = VALUES(website_url),
         linkedin_url = VALUES(linkedin_url),
         instagram_url = VALUES(instagram_url)`,
      [
        String(userId),
        profile.displayName,
        profile.publicTitle,
        profile.roleTitle,
        profile.company,
        profile.bio,
        profile.websiteUrl,
        profile.linkedinUrl,
        profile.instagramUrl
      ]
    );
    return this.getAccountProfile(userId);
  }

  async setPhotoKey(userId, photoKey) {
    const accountProfile = await this.getAccountProfile(userId);
    if (!accountProfile) return null;
    const key = String(photoKey || "").trim() || null;
    await this.pool.execute(
      `INSERT INTO user_profiles (user_id, display_name, photo_key)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE photo_key = VALUES(photo_key)`,
      [String(userId), accountProfile.displayName, key]
    );
    return this.getAccountProfile(userId);
  }

  async getPhotoKey(userId) {
    const [rows] = await this.pool.execute(
      "SELECT photo_key FROM user_profiles WHERE user_id = ? LIMIT 1",
      [String(userId)]
    );
    return String(rows?.[0]?.photo_key || "").trim();
  }

  async getDeckSpeakerProfile(deckId) {
    const [rows] = await this.pool.execute(
      `SELECT u.name AS auth_name, u.image AS auth_image,
              p.display_name, p.public_title, p.role_title, p.company, p.bio,
              p.website_url, p.linkedin_url, p.instagram_url, p.photo_key
       FROM decks d
       INNER JOIN workspaces w ON w.id = d.workspace_id
       INNER JOIN \`user\` u ON u.id = w.personal_owner_user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE d.deck_id = ?
       LIMIT 1`,
      [String(deckId)]
    );
    return mapProfileRow(rows?.[0]);
  }
}

module.exports = {
  ProfileRepository,
  ProfileValidationError,
  PROFILE_LIMITS,
  PUBLIC_TITLES,
  normalizeProfileInput,
  normalizePublicTitle,
  normalizeProfileUrl,
  publicPhotoUrl,
  mapProfileRow
};
