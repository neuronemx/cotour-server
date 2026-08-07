import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import workspaceModule from "./workspace-repository.js";

const { WorkspaceRepository } = workspaceModule;

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

export function createBetterAuthOptions(options = {}) {
  const env = options.env || process.env;
  const database = options.database;
  if (!database) throw new Error("A MySQL pool is required by Immersa Auth");

  const secret = requireSetting(env, "BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");

  const emailSender = options.emailSender;
  const googleClientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const googleClientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together");
  }

  const workspaces = options.workspaces || new WorkspaceRepository(database);
  const authOptions = {
    appName: "IMMERSA",
    baseURL: readBaseUrl(env),
    secret,
    database,
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-real-ip"]
      }
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      ...(emailSender ? {
        sendResetPassword: async ({ user, url }) => emailSender({
          kind: "password-reset",
          to: user.email,
          name: user.name,
          url
        })
      } : {})
    },
    ...(emailSender ? {
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => emailSender({
          kind: "email-verification",
          to: user.email,
          name: user.name,
          url
        })
      }
    } : {}),
    ...(googleClientId ? {
      socialProviders: {
        google: { clientId: googleClientId, clientSecret: googleClientSecret }
      }
    } : {}),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await workspaces.ensurePersonalWorkspace(user);
          }
        }
      }
    }
  };

  return authOptions;
}

export function createBetterAuthRuntime(options = {}) {
  const workspaces = options.workspaces || new WorkspaceRepository(options.database);
  const auth = betterAuth(createBetterAuthOptions({ ...options, workspaces }));

  return {
    auth,
    workspaces,
    capabilities: {
      email: Boolean(options.emailSender),
      google: Boolean(String((options.env || process.env).GOOGLE_CLIENT_ID || "").trim())
    },
    handler: toNodeHandler(auth),
    async getSession(nodeHeaders = {}) {
      return auth.api.getSession({ headers: fromNodeHeaders(nodeHeaders) });
    },
    async getAccountContext(nodeHeaders = {}) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(nodeHeaders) });
      return workspaces.accountContext(session);
    }
  };
}
