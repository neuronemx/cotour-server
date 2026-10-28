const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMysqlPool } = require("../db/mysql");
const { EventHubRepository } = require("../event-hub/repository");
const { extractArchive } = require("../local-event-package-archive");
const { importPackage } = require("../local-event-package-storage");

async function writeImportedBrandConfig(dataRoot, snapshot) {
  const workspaceId = String(snapshot?.eventHub?.workspaceId || "").trim();
  if (!workspaceId) throw new Error("Event Hub workspace id is required");
  const destination = path.join(dataRoot, "event-hubs", workspaceId, "brand-mentions.json");
  const config = {
    schema_version: 1,
    deck_id: workspaceId,
    settings: { interval_seconds: 120, display_seconds: 8 },
    brands: (snapshot.brands || []).map((brand, index) => ({
      id: brand.id,
      name: brand.name,
      pitch: brand.pitch,
      target_url: brand.targetUrl,
      active: brand.active !== false,
      order: index + 1,
      logo: brand.logo
    }))
  };
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(config, null, 2) + "\n");
  await fs.promises.rename(temporary, destination);
}

async function main() {
  const archive = String(process.argv[2] || "").trim();
  if (!archive) throw new Error("Usage: node scripts/import-local-event-package.js <package.immersa-local.zip>");
  const dataRoot = path.resolve(process.env.IMMERSA_DATA_DIR || path.join(__dirname, "..", "data"));
  const extracted = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-import-"));
  const pool = createMysqlPool();
  try {
    await extractArchive({ archive, destination: extracted });
    const repository = new EventHubRepository(pool);
    const imported = await importPackage({
      packageRoot: extracted,
      destinationRoot: dataRoot,
      importEventHub: (snapshot) => repository.importLocalSnapshot(snapshot),
      writeEventAssets: (snapshot) => writeImportedBrandConfig(dataRoot, snapshot)
    });
    console.log(`Imported ${imported.eventHub.title} (${imported.decks.length} Decks, ${imported.assets.length} assets).`);
  } finally {
    await pool.end();
    await fs.promises.rm(extracted, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
