import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import shop from "../live-shop-config.js";
import mysql from "../db/mysql.js";
import access from "../access-links.js";
import billing from "../billing/repository.js";
import sessions from "../session-id.js";
import { createBetterAuthRuntime } from "../auth/better-auth-runtime.mjs";

const email = "liveshop@example.test";
const deckId = "live-shop-demo";
const password = process.env.IMMERSA_LIVE_SHOP_DEMO_PASSWORD;
const dataDir = process.env.IMMERSA_DATA_DIR;
const fixture = fileURLToPath(new URL("../bootstrap/immersa-demo-master", import.meta.url));

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const temporary = filePath + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(temporary, filePath);
}

async function seedDeck(deckDir) {
  const manifestPath = path.join(deckDir, "manifest.json");
  const existing = await readJson(manifestPath);
  const validSessionId = sessions.manifestSessionId(existing);
  if (validSessionId) return validSessionId;

  const sessionId = sessions.generateSessionId();
  if (existing) {
    await writeJson(manifestPath, { ...existing, session_id: sessionId });
    return sessionId;
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
  await writeJson(manifestPath, demo);
  return sessionId;
}

export async function synchronizeDemoDeck({ database, workspaces, dataDir, userId, workspaceId }) {
  const dataDecksDir = path.join(dataDir, "decks");
  const sessionId = await seedDeck(path.join(dataDecksDir, deckId));
  if (await workspaces.ownsDeck(userId, deckId)) {
    await database.execute(
      "UPDATE decks SET session_id = ? WHERE deck_id = ? AND workspace_id = ? AND session_id <> ?",
      [sessionId, deckId, workspaceId, sessionId]
    );
  } else {
    await workspaces.registerDeck({ userId, workspaceId, deckId, sessionId, sourceSizeBytes: 0 });
  }

  const storePath = path.join(dataDir, "access-links.json");
  const stored = await readJson(storePath);
  const links = Array.isArray(stored) ? stored : stored?.access_links || [];
  let changed = false;
  for (const link of links) {
    if (link.deck_id !== deckId || link.session_id === sessionId) continue;
    link.session_id = sessionId;
    delete link.presentation_session_id;
    changed = true;
  }
  if (changed) await writeJson(storePath, links);

  const handlers = access.createAccessLinkHandlers({ dataDir, dataDecksDir, staticDecksDir: dataDecksDir });
  for (const role of ["speaker", "screen"]) {
    if (!links.some(link => link.deck_id === deckId && link.role === role && link.active !== false)) {
      await handlers.createAccessLinkForDeck({ deckId, role });
    }
  }
  return sessionId;
}

async function accountFor(database, runtime) {
  const [rows] = await database.execute("SELECT id, email FROM `user` WHERE email = ?", [email]);
  if (rows[0]) return rows[0];
  const result = await runtime.auth.api.signUpEmail({ body: { email, password, name: "LIVE SHOP Demo" } });
  if (!result.user?.id) throw new Error("Unable to create the Live Shop demo account");
  return result.user;
}

async function main() {
  if (!shop.liveShopDemoEnabled()) throw new Error("The Live Shop bootstrap requires the isolated demo environment");
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
    const plans = new billing.BillingRepository(database);
    const grants = await plans.getActiveGrants(workspace.id);
    if (!grants.some(grant => grant.plan === "SPEAKER_PRO" && grant.origin === "pilot")) {
      await plans.createPlanGrant({
        workspaceId: workspace.id, plan: "SPEAKER_PRO", origin: "pilot",
        actorUserId: user.id, note: "Acceso para la demo LIVE SHOP"
      });
    }
    await plans.recalculateEntitlement(workspace.id);
    await synchronizeDemoDeck({
      database, workspaces: runtime.workspaces, dataDir, userId: user.id, workspaceId: workspace.id
    });
    console.log("LIVE SHOP demo account and deck ready");
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("LIVE SHOP demo setup failed:", error.message);
    process.exitCode = 1;
  });
}
