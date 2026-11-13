// Guests receive only the current public slide, never the Deck manifest or role links.
function createGuestSlideReader({ getSession, readManifest, readEnglishManifest }) {
  return async ({ deckId, sessionId }, snapshot) => {
    const session = snapshot || getSession(sessionId, deckId) || {};
    const index = session.liveSlideIndex ?? session.slideIndex ?? 0;
    const requestedLocale = session.operationalLocale;
    if (!Number.isInteger(index) || index < 0) return null;
    const base = await readManifest(deckId);
    let manifest = base;
    let locale = "es";
    if (requestedLocale === "en" && base.locales?.en?.active) {
      const english = await readEnglishManifest(deckId).catch(() => null);
      if (english?.slides?.length === base.slides?.length) {
        manifest = english;
        locale = "en";
      }
    }
    const item = manifest.slides?.[index];
    if (typeof item?.src !== "string") return null;
    const source = item.src.replace(/^\/+/, "");
    // Uploaded slide assets are relative to this Deck. Reject traversal and external URLs.
    let decoded;
    try { decoded = decodeURIComponent(source.split(/[?#]/)[0]); } catch { return null; }
    if (!decoded.startsWith("slides/") || /[\\\u0000-\u001f]/.test(decoded)
      || decoded.split("/").some(part => part === ".." || part === ".")) return null;
    return {
      index, locale,
      src: "/decks/" + encodeURIComponent(deckId) + "/" + (locale === "en" ? "locales/en/" : "") + source,
      title: String(item.title || "Slide en curso").slice(0, 200)
    };
  };
}

module.exports = { createGuestSlideReader };
