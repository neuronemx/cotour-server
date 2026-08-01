import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

function requireSetting(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) throw new Error(`${name} is required when the Better Auth compatibility spike is enabled`);
  return value;
}

function readBaseUrl(env) {
  const value = requireSetting(env, "BETTER_AUTH_URL");
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch (_error) {
    throw new Error("BETTER_AUTH_URL must be an absolute URL");
  }
}

export function createBetterAuthRuntime(options = {}) {
  const env = options.env || process.env;
  const database = options.database;
  if (!database) throw new Error("A MySQL pool is required by the Better Auth compatibility spike");

  const secret = requireSetting(env, "BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");

  const auth = betterAuth({
    appName: "IMMERSA",
    baseURL: readBaseUrl(env),
    secret,
    database,
    emailAndPassword: { enabled: true }
  });

  return {
    auth,
    handler: toNodeHandler(auth),
    async getSession(nodeHeaders = {}) {
      return auth.api.getSession({ headers: fromNodeHeaders(nodeHeaders) });
    }
  };
}

