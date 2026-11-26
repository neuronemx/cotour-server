import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import shop from "../live-shop-config.js";
import mysql from "../db/mysql.js";
import access from "../access-links.js";
import { createBetterAuthRuntime } from "../auth/better-auth-runtime.mjs";

const email = "liveshop@example.test";
const deckId = "live-shop-demo";
const sessionId = "live-shop-demo-v01";
const password = process.env.IMMERSA_LIVE_SHOP_DEMO_PASSWORD;
const dataDir = process.env.IMMERSA_DATA_DIR;
const fixture = fileURLToPath(new URL("../bootstrap/immersa-demo-master", import.meta.url));

async function seedDeck(deckDir) {
  const manifestPath = path.join(deckDir, "manifest.json");
  try {
    await fs.access(manifestPath);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = JSON.parse(await fs.readFile(path.join(fixture, "manifest.json"), "utf8"));
  const slides = manifest.slides.slice(0, 3).map(({ planLevel, ...slide }) => slide);
  const { interactions } = JSON.parse(await fs.readFile(path.join(fixture, "interactions.json"), "utf8"));
  await Promise.all(["slides", "thumbs"].map(folder => fs.mkdir(path.join(deckDir, folder), { recursive: true })));
  for (const slide of slides) {
    for (const src of [slide.src, slide.thumb]) {
      const relative = src.split("?")[0];
      await fs.copyFile(path.join(fixture, relative), path.join(deckDir, relative));
    }
  }
  await fs.writeFile(path.join(deckDir, "interactions.json"), JSON.stringify({ deck_id: deckId, interactions }) + "\n");
  const demo = {
    deckId, session_id: sessionId, title: "LIVE SHOP · Demo v0.1",
    ratio: "16:9", status: "converted", slide_count: slides.length, slides,
    conversion: { status: "completed" },
    source: { sizeBytes: 0 }, createdAt: new Date().toISOString()
  };
  const tempManifest = manifestPath + ".tmp";
  await fs.writeFile(tempManifest, JSON.stringify(demo, null, 2) + "\n");
  await fs.rename(tempManifest, manifestPath);
}

async function accountFor(database, runtime) {
  const [rows] = await database.execute("SELECT id, email FROM `user` WHERE email = ?", [email]);
  if (rows[0]) return rows[0];
  const result = await runtime.auth.api.signUpEmail({ body: { email, password, name: "LIVE SHOP Demo" } });
  if (!result.user?.id) throw new Error("Unable to create the Live Shop demo account");
  return result.user;
}

async function main() {
  if (!shop.liveShopEnabled()) throw new Error("The Live Shop bootstrap requires the isolated demo environment");
  if (!password || !dataDir || !shop.liveShopTester({ id: "seed", email })) {
    throw new Error("Configure the Live Shop demo account, password and data directory");
  }
  const database = mysql.createMysqlPool();
  try {
    const runtime = createBetterAuthRuntime({
      database,
      env: { ...process.env, IMMERSA_LIVE_SHOP_ENVIRONMENT_ID: "" }
    });
    const user = await accountFor(database, runtime);
    const workspace = await runtime.workspaces.ensurePersonalWorkspace(user);
    await database.execute("UPDATE `user` SET emailVerified = true WHERE id = ?", [user.id]);
    if (workspace.plan !== "SPEAKER_PRO") {
      await runtime.workspaces.changePlan({
        workspaceId: workspace.id, plan: "SPEAKER_PRO", changedByUserId: user.id, note: "LIVE SHOP demo"
      });
    }
    const dataDecksDir = path.join(dataDir, "decks");
    await seedDeck(path.join(dataDecksDir, deckId));
    if (!await runtime.workspaces.ownsDeck(user.id, deckId)) {
      await runtime.workspaces.registerDeck({ userId: user.id, workspaceId: workspace.id, deckId, sessionId, sourceSizeBytes: 0 });
    }
    const storePath = path.join(dataDir, "access-links.json");
    const handlers = access.createAccessLinkHandlers({ dataDir, dataDecksDir, staticDecksDir: dataDecksDir });
    for (const role of ["speaker", "screen"]) {
      const links = await fs.readFile(storePath, "utf8").then(JSON.parse).catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      if (!links.some(link => link.deck_id === deckId && link.role === role && link.active !== false)) {
        await handlers.createAccessLinkForDeck({ deckId, role });
      }
    }
    console.log("LIVE SHOP demo account and deck ready");
  } finally {
    await database.end();
  }
}

main().catch(error => {
  console.error("LIVE SHOP demo setup failed:", error.message);
  process.exitCode = 1;
});
