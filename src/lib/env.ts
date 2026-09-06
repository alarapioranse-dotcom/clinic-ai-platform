import type { AppEnvironment } from '@/types';

/**
 * The only file in this repo permitted to read `process.env` directly.
 * Everything else imports `env` from here.
 */

const ALLOWED_APP_ENVS: readonly AppEnvironment[] = ['development', 'staging', 'production'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAppEnv(name: string): AppEnvironment {
  const value = requireEnv(name);
  if (!ALLOWED_APP_ENVS.includes(value as AppEnvironment)) {
    throw new Error(
      `Invalid value for ${name}: "${value}". Expected one of: ${ALLOWED_APP_ENVS.join(', ')}`,
    );
  }
  return value as AppEnvironment;
}

export const env = {
  appUrl: requireEnv('NEXT_PUBLIC_APP_URL'),
  appEnv: requireAppEnv('NEXT_PUBLIC_APP_ENV'),
} as const;

/**
 * Database connection strings are read lazily (only when something actually
 * opens a database connection — `src/lib/db.ts`, `scripts/migrate.ts`) rather
 * than eagerly in the `env` object above, so that code paths with no database
 * dependency (e.g. `next build` of the marketing site) don't start requiring
 * database credentials just because they import something that imports this
 * module. Both still go through this file — the only one permitted to read
 * `process.env` — and still fail loudly the moment they're actually needed.
 */

/** Owner/migration connection: creates roles, tables, RLS policies. */
export function getDatabaseUrl(): string {
  return requireEnv('DATABASE_URL');
}

/**
 * Least-privilege runtime connection. Per ADR-0006 and
 * docs/technical/02-tenant-isolation-testing.md, application code and tests
 * must never connect as the table owner — RLS (and FORCE ROW LEVEL SECURITY)
 * only bind the isolation guarantee for a non-owner, non-superuser role.
 */
export function getAppDatabaseUrl(): string {
  return requireEnv('APP_DATABASE_URL');
}

/**
 * The app_user role's password, used only by scripts/migrate.ts to set it
 * via a parameterized `ALTER ROLE ... WITH PASSWORD $1` (PR #25 review) —
 * never read by the running application, and never written into a
 * migration's SQL text. Must match the password embedded in
 * APP_DATABASE_URL.
 */
export function getAppUserPassword(): string {
  return requireEnv('APP_USER_PASSWORD');
}

/**
 * Whether this process is running under the test suite (Vitest sets
 * `NODE_ENV=test` automatically). Used only to gate
 * `src/lib/db.ts`'s `withoutTenantContext` against accidental production
 * use (PR #25 review) — not a general-purpose environment check.
 */
export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * The minimum length required of `SEED_STAFF_PASSWORD` (see below). This is
 * a safety floor for the deployment-validation seed specifically — the
 * account it creates has a permanently public identity (its email, role,
 * and clinic id are documented in this repository), so its password is the
 * only thing protecting it once a deployment has run the seed. This does
 * NOT change the normal staff sign-in password policy in
 * `src/features/auth/**` — nothing there currently enforces a minimum
 * length, and this constant is not read by that code path.
 */
export const SEED_STAFF_PASSWORD_MIN_LENGTH = 12;

/**
 * The demo staff account's plaintext password for `scripts/seed.ts`,
 * hashed before it ever touches the database — never read by the running
 * application. Deliberately has no default: an unset value fails loudly
 * rather than the seed falling back to some hardcoded, publicly-known
 * password, which the "no real patient or clinic data anywhere" hard rule
 * in CLAUDE.md would treat no better than a real credential leak.
 *
 * Also rejects a password shorter than SEED_STAFF_PASSWORD_MIN_LENGTH,
 * checked here — before `scripts/seed.ts` opens any database connection or
 * writes anything — so a too-short value fails loudly instead of minting a
 * weakly-protected, publicly-identifiable account (PR #40 review, BLOCKER
 * B1). The error message states the requirement, never the value itself.
 */
export function getSeedStaffPassword(): string {
  const password = requireEnv('SEED_STAFF_PASSWORD');
  if (password.length < SEED_STAFF_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `SEED_STAFF_PASSWORD is too short: it must be at least ${SEED_STAFF_PASSWORD_MIN_LENGTH} ` +
        'characters. Choose a longer value — never log or commit the password itself.',
    );
  }
  return password;
}

/**
 * `scripts/seed.ts`'s explicit override for its "refuse to run when
 * NEXT_PUBLIC_APP_ENV=production" default. Checked against the exact
 * string `"true"`, not merely "is this set", so an empty value or a typo
 * can never accidentally authorize a production seed run.
 */
export function isSeedForceEnabled(): boolean {
  return process.env.SEED_FORCE === 'true';
}
