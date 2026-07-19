const mysql = require("mysql2/promise");

const DEFAULT_CONNECTION_LIMIT = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(value) {
  return /^(1|true|yes|on|required)$/i.test(String(value || "").trim());
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function configFromUrl(connectionUrl) {
  let parsed;
  try {
    parsed = new URL(connectionUrl);
  } catch (_error) {
    throw new Error("IMMERSA_MYSQL_URL must be a valid mysql:// URL");
  }
  if (parsed.protocol !== "mysql:") throw new Error("IMMERSA_MYSQL_URL must use the mysql:// protocol");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error("IMMERSA_MYSQL_URL must include host, user and database");
  }
  return {
    host: parsed.hostname,
    port: positiveInteger(parsed.port, 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database
  };
}

function configFromParts(env) {
  const host = String(env.IMMERSA_MYSQL_HOST || "").trim();
  const user = String(env.IMMERSA_MYSQL_USER || "").trim();
  const database = String(env.IMMERSA_MYSQL_DATABASE || "").trim();
  if (!host || !user || !database) {
    throw new Error("MySQL is not configured: set IMMERSA_MYSQL_URL or host, user and database variables");
  }
  return {
    host,
    port: positiveInteger(env.IMMERSA_MYSQL_PORT, 3306),
    user,
    password: String(env.IMMERSA_MYSQL_PASSWORD || ""),
    database
  };
}

function readMysqlConfig(env = process.env) {
  const connectionUrl = String(env.IMMERSA_MYSQL_URL || env.MYSQL_URL || "").trim();
  const config = connectionUrl ? configFromUrl(connectionUrl) : configFromParts(env);
  const ca = normalizePem(env.IMMERSA_MYSQL_SSL_CA);
  const sslRequired = enabled(env.IMMERSA_MYSQL_SSL) || Boolean(ca);

  return {
    ...config,
    waitForConnections: true,
    connectionLimit: positiveInteger(env.IMMERSA_MYSQL_CONNECTION_LIMIT, DEFAULT_CONNECTION_LIMIT),
    queueLimit: 0,
    connectTimeout: positiveInteger(env.IMMERSA_MYSQL_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: "utf8mb4",
    timezone: "Z",
    ...(sslRequired ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {})
  };
}

function createMysqlPool(options = {}) {
  const config = readMysqlConfig(options.env || process.env);
  return mysql.createPool({ ...config, ...(options.overrides || {}) });
}

module.exports = { createMysqlPool, readMysqlConfig };
