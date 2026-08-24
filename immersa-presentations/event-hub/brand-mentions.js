const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  BrandMentionStore,
  BrandMentionError,
  normalizeLogoFile
} = require("../brand-mentions-api");

function workspaceId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new BrandMentionError("INVALID_EVENT_HUB", "Event Hub inválido");
  return id;
}

function logoUrl(eventWorkspaceId, fileName) {
  return `/event-hubs/${encodeURIComponent(eventWorkspaceId)}/brand-assets/${encodeURIComponent(fileName)}`;
}

class EventBrandMentionStore extends BrandMentionStore {
  constructor({ dataEventHubsDir }) {
    const root = path.resolve(dataEventHubsDir);
    super({ dataDecksDir: root, staticDecksDir: root });
    this.dataEventHubsDir = root;
  }

  async findDeck(value, { writable = false } = {}) {
    const deckId = workspaceId(value);
    const deckDir = path.join(this.dataEventHubsDir, deckId);
    if (writable) await fs.promises.mkdir(deckDir, { recursive: true });
    return { deckId, deckDir, writable: true };
  }

  normalizeStoredConfig(parsed, eventWorkspaceId) {
    const config = super.normalizeStoredConfig(parsed, eventWorkspaceId);
    return {
      ...config,
      event_workspace_id: eventWorkspaceId,
      brands: config.brands.map((brand) => ({
        ...brand,
        logo: { ...brand.logo, src: logoUrl(eventWorkspaceId, brand.logo.file_name) }
      }))
    };
  }

  async writeLogo(event, file) {
    const detected = normalizeLogoFile(file);
    const fileName = `logo-${crypto.randomUUID()}${detected.extension}`;
    const assetsDir = path.join(event.deckDir, "brand-assets");
    await fs.promises.mkdir(assetsDir, { recursive: true });
    await fs.promises.writeFile(path.join(assetsDir, fileName), file.buffer, { flag: "wx" });
    return {
      fileName,
      record: {
        file_name: fileName,
        src: logoUrl(event.deckId, fileName),
        mime_type: detected.mimeType,
        size_bytes: file.buffer.length,
        width: detected.width,
        height: detected.height
      }
    };
  }

  assetPath(eventWorkspaceId, fileName) {
    const safe = path.basename(String(fileName || ""));
    if (!/^logo-[a-f0-9-]+\.(?:png|jpg|webp)$/i.test(safe)) return null;
    return path.join(this.dataEventHubsDir, workspaceId(eventWorkspaceId), "brand-assets", safe);
  }
}

module.exports = { EventBrandMentionStore };
