import { pathToFileURL } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import mysqlModule from "../db/mysql.js";
import { createBetterAuthOptions } from "./better-auth-runtime.mjs";

const { createMysqlPool } = mysqlModule;

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export async function runCompatibilityMigration(options = {}) {
  const env = options.env || process.env;
  if (!isEnabled(env.IMMERSA_AUTH_SPIKE_ENABLED)) {
    throw new Error("IMMERSA_AUTH_SPIKE_ENABLED=true is required");
  }
  if (!isEnabled(env.IMMERSA_AUTH_SPIKE_MIGRATE)) {
    throw new Error("IMMERSA_AUTH_SPIKE_MIGRATE=true is required");
  }

  const database = options.database || createMysqlPool({ env });
  const ownsDatabase = !options.database;

  try {
    const migration = await (options.getMigrations || getMigrations)(
      createBetterAuthOptions({ database, env })
    );
    await migration.runMigrations();
    return {
      created: migration.toBeCreated.map((table) => table.table),
      updated: migration.toBeAdded.map((table) => table.table)
    };
  } finally {
    if (ownsDatabase) await database.end();
  }
}

async function main() {
  const result = await runCompatibilityMigration();
  console.log("Better Auth compatibility schema is ready.");
  console.log("Created tables:", result.created.join(", ") || "none");
  console.log("Updated tables:", result.updated.join(", ") || "none");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error("Better Auth compatibility migration failed:", error.message);
    process.exitCode = 1;
  });
}
