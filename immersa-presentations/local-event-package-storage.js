const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createManifest, verifyManifest, checksum } = require("./local-event-package");
const { createSnapshot } = require("./local-event-hub-snapshot");

function safeRelative(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) throw new Error("Invalid Local package asset path");
  return normalized;
}

async function sha256(file) {
  const content = await fs.promises.readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

function assetDescriptor(asset, sourceRoot) {
  const value = typeof asset === "string" ? { path: asset } : (asset || {});
  const relative = safeRelative(value.path);
  const source = value.source ? path.resolve(value.source) : path.resolve(sourceRoot, relative);
  return { relative, source };
}

async function exportPackage({ destination, eventHub, stages = [], activities = [], publicQrs = [], brands = [], decks = [], assets: extraAssets = [], sourceRoot }) {
  const root = path.resolve(destination);
  await fs.promises.mkdir(root, { recursive: true });
  const assets = [];
  const seenAssets = new Set();
  for (const asset of [...decks.flatMap((deck) => deck.assets || []), ...extraAssets]) {
    const { relative, source } = assetDescriptor(asset, sourceRoot);
    if (seenAssets.has(relative)) continue;
    seenAssets.add(relative);
    const target = path.resolve(root, "assets", relative);
    if (!target.startsWith(path.resolve(root, "assets") + path.sep)) throw new Error("Invalid Local package target");
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
    const stats = await fs.promises.stat(target);
    assets.push({ path: relative, sha256: await sha256(target), bytes: stats.size });
  }
  const snapshot = createSnapshot({ eventHub, stages, activities, publicQrs, brands });
  await fs.promises.mkdir(path.join(root, "data"), { recursive: true });
  const snapshotChecksum = checksum(snapshot);
  await fs.promises.writeFile(path.join(root, "data", "event-hub.json"), JSON.stringify(snapshot, null, 2) + "\n");
  const manifest = createManifest({ eventHub: snapshot.eventHub, snapshotChecksum, decks: decks.map(({ id, manifest }) => ({ id, manifest })), assets });
  await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function verifyPackage(packageRoot) {
  const root = path.resolve(packageRoot);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(root, "manifest.json"), "utf8"));
  const payload = verifyManifest(manifest);
  for (const asset of payload.assets) {
    const source = path.resolve(root, "assets", safeRelative(asset.path));
    if (!source.startsWith(path.resolve(root, "assets") + path.sep)) throw new Error("Invalid Local package asset");
    if (await sha256(source) !== asset.sha256) throw new Error(`Local package asset checksum mismatch: ${asset.path}`);
  }
  const snapshot = JSON.parse(await fs.promises.readFile(path.join(root, "data", "event-hub.json"), "utf8"));
  if (snapshot?.eventHub?.workspaceId !== payload.eventHub.workspaceId) throw new Error("Local package Event Hub mismatch");
  if (payload.snapshotChecksum !== checksum(snapshot)) throw new Error("Local package Event Hub checksum mismatch");
  return { ...payload, snapshot };
}

async function importPackage({ packageRoot, destinationRoot, importEventHub, writeEventAssets = async () => {} }) {
  if (typeof importEventHub !== "function") throw new Error("Local Event Hub importer is required");
  const verified = await verifyPackage(packageRoot);
  const destination = path.resolve(destinationRoot);
  await fs.promises.mkdir(destination, { recursive: true });
  const staging = await fs.promises.mkdtemp(path.join(destination, ".local-import-"));
  try {
    for (const asset of verified.assets) {
      const relative = safeRelative(asset.path);
      const source = path.resolve(packageRoot, "assets", relative);
      const staged = path.resolve(staging, relative);
      if (!staged.startsWith(staging + path.sep)) throw new Error("Invalid Local import target");
      await fs.promises.mkdir(path.dirname(staged), { recursive: true });
      await fs.promises.copyFile(source, staged);
    }
    await importEventHub(verified.snapshot);
    for (const asset of verified.assets) {
      const relative = safeRelative(asset.path);
      const staged = path.resolve(staging, relative);
      const target = path.resolve(destination, relative);
      if (!target.startsWith(destination + path.sep)) throw new Error("Invalid Local import target");
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.rename(staged, target).catch(async (error) => {
        if (error.code !== "EXDEV") throw error;
        await fs.promises.copyFile(staged, target);
      });
    }
    await writeEventAssets(verified.snapshot);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
  return verified;
}

module.exports = { safeRelative, sha256, assetDescriptor, exportPackage, verifyPackage, importPackage };
