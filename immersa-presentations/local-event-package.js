const { createHash } = require("node:crypto");

const FORMAT = "immersa-local-event-package";
const VERSION = 1;

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function checksum(payload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function createManifest({ eventHub, decks, assets, snapshotChecksum, exportedAt = new Date().toISOString() }) {
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt,
    eventHub: {
      workspaceId: required(eventHub?.workspaceId, "eventHub.workspaceId"),
      slug: required(eventHub?.slug, "eventHub.slug"),
      title: required(eventHub?.title, "eventHub.title")
    },
    snapshotChecksum: required(snapshotChecksum, "snapshotChecksum"),
    decks: Array.isArray(decks) ? decks.map((deck) => ({ id: required(deck?.id, "deck.id"), manifest: required(deck?.manifest, "deck.manifest") })) : [],
    assets: Array.isArray(assets) ? assets.map((asset) => ({ path: required(asset?.path, "asset.path"), sha256: required(asset?.sha256, "asset.sha256"), bytes: Number(asset?.bytes || 0) })) : []
  };
  return { ...payload, checksum: checksum(payload) };
}

function verifyManifest(manifest) {
  if (manifest?.format !== FORMAT || manifest?.version !== VERSION) throw new Error("Unsupported Immersa Local package");
  const { checksum: received, ...payload } = manifest || {};
  if (received !== checksum(payload)) throw new Error("Immersa Local package checksum mismatch");
  return payload;
}

module.exports = { FORMAT, VERSION, stableJson, checksum, createManifest, verifyManifest };
