import { pathToFileURL } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import mysqlModule from "../db/mysql.js";
import { createBetterAuthOptions } from "./better-auth-runtime.mjs";

const { createMysqlPool } = mysqlModule;

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export async function runAuthMigration(options = {}) {
  const env = options.env || process.env;
  if (!enabled(env.IMMERSA_AUTH_ENABLED)) return { skipped: true, created: [], updated: [] };

  const database = options.database || createMysqlPool({ env });
  const ownsDatabase = !options.database;
  try {
    const migration = await (options.getMigrations || getMigrations)(
      createBetterAuthOptions({ database, env })
    );
    await migration.runMigrations();
    return {
      skipped: false,
      created: migration.toBeCreated.map((table) => table.table),
      updated: migration.toBeAdded.map((table) => table.table)
    };
  } finally {
    if (ownsDatabase) await database.end();
  }
}

async function main() {
  const result = await runAuthMigration();
  if (result.skipped) {
    console.log("Immersa Auth migration skipped (IMMERSA_AUTH_ENABLED is off).");
    return;
  }
  console.log("Immersa Auth schema is ready.");
  console.log("Created tables:", result.created.join(", ") || "none");
  console.log("Updated tables:", result.updated.join(", ") || "none");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error("Immersa Auth migration failed:", error.message);
    process.exitCode = 1;
  });
}
