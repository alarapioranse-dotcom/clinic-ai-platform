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
