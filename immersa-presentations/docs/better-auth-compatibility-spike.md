# Better Auth compatibility spike

This branch tests Better Auth without adopting it as IMMERSA's production identity system.

## Scope

- Keep the existing CommonJS application unchanged.
- Load Better Auth 1.6.25 from an isolated ESM module.
- Reuse IMMERSA's existing `mysql2` pool and MariaDB connection settings.
- Mount the Express 4 handler before `express.json()`.
- Prove that a Better Auth session can be attached to a Socket.IO handshake.
- Keep the entire integration disabled by default.

This spike does not add account screens, migrate Decks, protect administrative routes, or authorize Speaker/Stage/Screen commands.

## Activation for an isolated environment

Set all of the following variables only in a disposable test environment:

```text
IMMERSA_AUTH_SPIKE_ENABLED=true
IMMERSA_AUTH_SPIKE_MIGRATE=true
BETTER_AUTH_URL=https://test.example.com
BETTER_AUTH_SECRET=<at least 32 high-entropy characters>
IMMERSA_MYSQL_URL=mysql://...
```

When enabled, `GET /api/auth/ok` verifies that Better Auth's handler is mounted and `GET /api/auth-spike/session` verifies session resolution. When disabled, existing IMMERSA behavior is preserved and no Better Auth database pool is created.

For a disposable database only, run `npm run auth-spike:migrate` before starting the service. The command requires both spike flags and uses Better Auth's own migration generator for the installed version. It is idempotent and reports which tables were created or updated.

The compatibility migration is deliberately not part of IMMERSA's numbered production migrations. A later adoption PR must generate and review permanent SQL before Better Auth can be enabled outside an isolated environment.
