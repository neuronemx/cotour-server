const fs = require("fs");
const path = require("path");

const MIGRATION_LOCK = "immersa_schema_migrations";

function splitSqlStatements(sql) {
  const statements = [];
  let statement = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (lineComment) {
      statement += character;
      if (character === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      statement += character;
      if (character === "*" && nextCharacter === "/") {
        statement += nextCharacter;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      statement += character;
      if (character === "\\" && nextCharacter) {
        statement += nextCharacter;
        index += 1;
      } else if (character === quote) {
        if (nextCharacter === quote) {
          statement += nextCharacter;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      statement += character;
      continue;
    }

    if ((character === "-" && nextCharacter === "-" && /\s/.test(sql[index + 2] || "")) || character === "#") {
      lineComment = true;
      statement += character;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      statement += character + nextCharacter;
      index += 1;
      continue;
    }

    if (character === ";") {
      if (statement.trim()) statements.push(statement.trim());
      statement = "";
      continue;
    }

    statement += character;
  }

  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

async function migrationFiles(migrationsDir) {
  const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d+.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function runMigrations(pool, options = {}) {
  if (!pool?.getConnection) throw new Error("A MySQL pool is required");
  const migrationsDir = options.migrationsDir || path.join(__dirname, "migrations");
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [MIGRATION_LOCK]);
    lockAcquired = Number(lockRows?.[0]?.acquired) === 1;
    if (!lockAcquired) throw new Error("Unable to acquire the Immersa migration lock");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await connection.query("SELECT id FROM schema_migrations");
    const applied = new Set((rows || []).map((row) => String(row.id)));
    const files = await migrationFiles(migrationsDir);
    const executed = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.promises.readFile(path.join(migrationsDir, file), "utf8");
      if (!sql.trim()) continue;
      for (const statement of splitSqlStatements(sql)) {
        await connection.query(statement);
      }
      await connection.execute("INSERT INTO schema_migrations (id) VALUES (?)", [file]);
      executed.push(file);
    }

    return { executed, total: files.length };
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    connection.release();
  }
}

module.exports = { runMigrations, migrationFiles, splitSqlStatements, MIGRATION_LOCK };
