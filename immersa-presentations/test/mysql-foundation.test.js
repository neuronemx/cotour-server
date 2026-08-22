const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readMysqlConfig } = require("../db/mysql");
const { runMigrations, splitSqlStatements } = require("../db/migrate");

const migrationsDir = path.join(__dirname, "..", "db", "migrations");

test("MySQL URL config is UTC, utf8mb4 and safely pooled", () => {
  const config = readMysqlConfig({
    IMMERSA_MYSQL_URL: "mysql://immersa_app:s3cret@db.example.com:3307/immersa",
    IMMERSA_MYSQL_CONNECTION_LIMIT: "7",
    IMMERSA_MYSQL_SSL: "required"
  });
  assert.equal(config.host, "db.example.com");
  assert.equal(config.port, 3307);
  assert.equal(config.user, "immersa_app");
  assert.equal(config.password, "s3cret");
  assert.equal(config.database, "immersa");
  assert.equal(config.connectionLimit, 7);
  assert.equal(config.charset, "utf8mb4");
  assert.equal(config.timezone, "Z");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("MySQL config accepts individual Immersa variables and a TLS CA", () => {
  const config = readMysqlConfig({
    IMMERSA_MYSQL_HOST: "mysql.internal",
    IMMERSA_MYSQL_USER: "immersa_app",
    IMMERSA_MYSQL_PASSWORD: "secret",
    IMMERSA_MYSQL_DATABASE: "immersa",
    IMMERSA_MYSQL_SSL_CA: "line-one\\nline-two"
  });
  assert.equal(config.port, 3306);
  assert.equal(config.connectionLimit, 10);
  assert.equal(config.ssl.ca, "line-one\nline-two");
  assert.equal(config.ssl.rejectUnauthorized, true);
});

test("MySQL config fails clearly when required values are absent", () => {
  assert.throws(() => readMysqlConfig({}), /MySQL is not configured/);
  assert.throws(() => readMysqlConfig({ IMMERSA_MYSQL_URL: "postgres://example.test/db" }), /mysql:\/\//);
});

test("database schema preserves Q&A and Speaker metrics storage contracts", async () => {
  const files = (await fs.promises.readdir(migrationsDir)).sort();
  assert.deepEqual(files, [
    "001_presentation_sessions.sql",
    "002_qna_rounds.sql",
    "003_qna_questions.sql",
    "004_knowledge_activities.sql",
    "005_presentation_lifecycle.sql",
    "006_auth_workspaces.sql",
    "007_user_profiles.sql",
    "008_user_profile_public_title.sql",
    "009_free_plan_usage.sql",
    "010_account_activation_notifications.sql",
    "011_qna_submission_cooldown.sql",
    "012_workspace_plan_changes.sql",
    "013_pending_plan_downgrades.sql",
    "014_plan_downgrade_grace_period.sql",
    "015_speaker_basic_metrics.sql",
    "016_billing_v1.sql",
    "017_billing_cleanup_requirements.sql",
    "017_billing_event_pass.sql",
    "018_billing_invoice_requests.sql",
    "019_billing_email_notifications.sql",
    "020_event_hub_foundation.sql"
  ]);
  const schema = (await Promise.all(files.map((file) => fs.promises.readFile(path.join(migrationsDir, file), "utf8")))).join("\n");
  assert.match(schema, /ENGINE=InnoDB/g);
  assert.match(schema, /utf8mb4/g);
  assert.match(schema, /UNIQUE KEY uq_qna_question_per_audience \(qna_round_id, audience_id\)/);
  assert.match(schema, /DROP INDEX uq_qna_question_per_audience/);
  assert.match(schema, /idx_qna_questions_audience_cooldown \(qna_round_id, audience_id, created_at\)/);
  assert.match(schema, /ENUM\('new', 'selected'\)/);
  assert.match(schema, /projected_at DATETIME\(3\) NULL/);
  assert.match(schema, /UNIQUE KEY uq_qna_selected_per_round \(selected_round_id\)/);
  assert.match(schema, /status = 'new' AND selected_round_id IS NULL/);
  assert.match(schema, /status = 'selected' AND selected_round_id = qna_round_id/);
  assert.doesNotMatch(schema, /GENERATED ALWAYS/);
  assert.doesNotMatch(schema, /deleted_at|projected_by|projection_count|projected_with_name/i);
  assert.match(schema, /presentation_session_attendance/);
  assert.match(schema, /presentation_poll_executions/);
  assert.match(schema, /presentation_poll_responses/);
  assert.match(schema, /event_hubs/);
  assert.match(schema, /event_live_sessions/);
});

test("migration runner serializes and records pending SQL files", async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ kind: "query", sql: String(sql), values });
      if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }], []];
      if (/SELECT id FROM schema_migrations/.test(sql)) return [[], []];
      return [[], []];
    },
    async execute(sql, values) {
      calls.push({ kind: "execute", sql: String(sql), values });
      return [[], []];
    },
    release() { calls.push({ kind: "release" }); }
  };
  const result = await runMigrations({ async getConnection() { return connection; } }, { migrationsDir });
  assert.deepEqual(result.executed, [
    "001_presentation_sessions.sql",
    "002_qna_rounds.sql",
    "003_qna_questions.sql",
    "004_knowledge_activities.sql",
    "005_presentation_lifecycle.sql",
    "006_auth_workspaces.sql",
    "007_user_profiles.sql",
    "008_user_profile_public_title.sql",
    "009_free_plan_usage.sql",
    "010_account_activation_notifications.sql",
    "011_qna_submission_cooldown.sql",
    "012_workspace_plan_changes.sql",
    "013_pending_plan_downgrades.sql",
    "014_plan_downgrade_grace_period.sql",
    "015_speaker_basic_metrics.sql",
    "016_billing_v1.sql",
    "017_billing_cleanup_requirements.sql",
    "017_billing_event_pass.sql",
    "018_billing_invoice_requests.sql",
    "019_billing_email_notifications.sql"
  ]);
  const recorded = calls.filter((call) => call.kind === "execute").map((call) => call.values[0]);
  assert.deepEqual(recorded, result.executed);
  const migrationQueries = calls.filter((call) => (
    call.kind === "query"
    && /CREATE TABLE IF NOT EXISTS (presentation_(?:sessions|session_attendance|poll_)|qna_|knowledge_activity_)/.test(call.sql || "")
  ));
  assert.equal(migrationQueries.length, 13);
  assert.ok(migrationQueries.every((call) => (
    (call.sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length === 1
  )));
  assert.ok(calls.some((call) => /RELEASE_LOCK/.test(call.sql || "")));
  assert.equal(calls.at(-1).kind, "release");
});

test("SQL migration splitting ignores semicolons inside strings and comments", () => {
  const statements = splitSqlStatements(`
    CREATE TABLE example (value VARCHAR(32) DEFAULT 'one;two');
    -- semicolon in a comment;
    INSERT INTO example (value) VALUES ("three;four");
    /* another comment; */
    SELECT \`value;label\` FROM example;
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /one;two/);
  assert.match(statements[1], /three;four/);
  assert.match(statements[2], /value;label/);
});
