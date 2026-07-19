const { createMysqlPool } = require("../db/mysql");
const { runMigrations } = require("../db/migrate");

async function main() {
  const pool = createMysqlPool();
  try {
    const result = await runMigrations(pool);
    if (result.executed.length) console.log("Applied Immersa migrations:", result.executed.join(", "));
    else console.log("Immersa database schema is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Immersa database migration failed:", error.message);
  process.exitCode = 1;
});
