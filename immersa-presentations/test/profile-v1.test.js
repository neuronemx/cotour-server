const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ProfileRepository,
  normalizeProfileInput,
  normalizeProfileUrl,
  publicPhotoUrl
} = require("../auth/profile-repository");
const { normalizeProfilePhoto } = require("../profile-api");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Profile v1 stores one reusable account profile without public email fields", () => {
  const migration = read("db/migrations/007_user_profiles.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_profiles/);
  assert.match(migration, /user_id VARCHAR\(191\)[^\n]+NOT NULL/);
  assert.match(migration, /display_name VARCHAR\(120\) NOT NULL/);
  assert.match(migration, /bio VARCHAR\(600\) NOT NULL/);
  assert.match(migration, /photo_key VARCHAR\(191\)/);
  assert.doesNotMatch(migration, /email|phone|telephone/i);
});

test("Profile input trims fields, normalizes HTTPS links, and enforces the approved limits", () => {
  const profile = normalizeProfileInput({
    displayName: "  Renata Cifuentes ",
    roleTitle: " Directora de Fotografía ",
    company: " Estudios Churubusco ",
    bio: " Cine y narrativa visual. ",
    websiteUrl: "renata.example/perfil",
    linkedinUrl: "https://linkedin.com/in/renata",
    instagramUrl: ""
  });
  assert.equal(profile.displayName, "Renata Cifuentes");
  assert.equal(profile.roleTitle, "Directora de Fotografía");
  assert.equal(profile.websiteUrl, "https://renata.example/perfil");
  assert.equal(profile.instagramUrl, "");
  assert.throws(() => normalizeProfileInput({ displayName: "" }), /nombre completo.*obligatorio/i);
  assert.throws(() => normalizeProfileInput({ displayName: "A", bio: "x".repeat(601) }), /máximo 600/);
  assert.throws(() => normalizeProfileUrl("http://example.com", "website_url"), /HTTPS válida/);
  assert.throws(() => normalizeProfileUrl("https://user:secret@example.com", "website_url"), /sin credenciales/);
});

test("Deck public profile resolves through the owning personal workspace and omits account-only identity", async () => {
  const calls = [];
  const repository = new ProfileRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{
        auth_name: "Renata Cifuentes",
        auth_image: "https://images.example/renata.jpg",
        display_name: "",
        role_title: "Directora de Fotografía",
        company: "Estudios Churubusco",
        bio: "Narrativa visual",
        website_url: "https://renata.example/",
        linkedin_url: "",
        instagram_url: "",
        photo_key: null
      }]];
    }
  });
  const profile = await repository.getDeckSpeakerProfile("deck-amc");
  assert.equal(profile.displayName, "Renata Cifuentes");
  assert.equal(profile.photoUrl, "https://images.example/renata.jpg");
  assert.equal(Object.hasOwn(profile, "email"), false);
  assert.match(calls[0].sql, /INNER JOIN workspaces w ON w\.id = d\.workspace_id/);
  assert.match(calls[0].sql, /w\.personal_owner_user_id/);
  assert.deepEqual(calls[0].params, ["deck-amc"]);
});

test("Uploaded profile photos use immutable public keys and validate their actual bytes", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(800, 20);
  const detected = normalizeProfilePhoto({ buffer: png, originalname: "avatar.png", mimetype: "image/png" });
  assert.equal(detected.extension, ".png");
  assert.equal(publicPhotoUrl("profile-12ab34cd-1234-1234-1234-123456789abc.png"), "/profile-images/profile-12ab34cd-1234-1234-1234-123456789abc.png");
  assert.equal(publicPhotoUrl("../../secret.png"), "");
  assert.throws(() => normalizeProfilePhoto({ buffer: png, originalname: "avatar.jpg", mimetype: "image/jpeg" }), /no coincide/);
});

test("Home exposes Mi perfil with the approved fields and Público reuses it in every owned Deck", () => {
  const server = read("server.js");
  const home = read("public/home/index.html");
  const editor = read("public/home/profile-editor.js");
  const audience = read("public/audience/index.html");
  const publicProfile = read("public/audience/speaker-profile.js");
  const publicCss = read("public/audience/speaker-profile.css");

  assert.match(server, /app\.get\("\/api\/account\/profile", requireAccount/);
  assert.match(server, /app\.put\("\/api\/account\/profile", requireAccount/);
  assert.match(server, /app\.post\("\/api\/account\/profile\/photo", requireAccount/);
  assert.match(server, /app\.get\("\/api\/decks\/:deckId\/speaker-profile", profileHandlers\.getDeckSpeakerProfile/);
  assert.match(home, /id="profileButton"[^>]*>Mi perfil</);
  assert.match(home, /id="profileDisplayName"[^>]+maxlength="120"/);
  assert.match(home, /id="profileBio"[^>]+maxlength="600"/);
  assert.match(home, />Acerca de</);
  assert.match(home, /visible para Público en todos tus Decks/);
  assert.match(editor, /\/api\/account\/profile/);
  assert.match(editor, /\/api\/account\/profile\/photo/);
  assert.match(audience, /id="speakerProfileTab"/);
  assert.match(audience, />Speaker<\/span>/);
  assert.match(audience, />Acerca de<\/p>/);
  assert.match(publicProfile, /\/api\/decks\/\$\{encodeURIComponent\(deckId\)\}\/speaker-profile/);
  assert.match(publicCss, /--speaker-panel-width: 314px/);
  assert.match(publicCss, /--speaker-panel-height: min\(78dvh, 660px\)/);
  assert.match(publicCss, /backdrop-filter: blur\(22px\)/);
});

test("Speaker profile is included only in Público, not Screen", () => {
  const audience = read("public/audience/index.html");
  const screen = read("public/screen/index.html");
  assert.match(audience, /speaker-profile\.css\?v=1/);
  assert.match(audience, /speaker-profile\.js\?v=1/);
  assert.doesNotMatch(screen, /speaker-profile|Mi perfil|Acerca de/);
});
