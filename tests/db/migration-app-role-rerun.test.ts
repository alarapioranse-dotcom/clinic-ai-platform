import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { Client } from 'pg';
import { getDatabaseUrl } from '@/lib/env';

/**
 * Regression coverage for issue #41: 0002_app_role.sql used to run an
 * unconditional `ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS` on every
 * run. Postgres rejects any change to the SUPERUSER attribute from a
 * connection that isn't itself a superuser -- even a no-op change that
 * would only reassert a value the role already has -- so on managed
 * Postgres (the owner/migration role is not a superuser there) the
 * migration aborted before 0003 ever ran, leaving the database empty.
 *
 * These tests run the real migration file's SQL, unmodified except for
 * swapping the role name it manages (see migrationSqlFor below), against a
 * genuinely non-superuser owner role in a scratch database -- the same
 * shape of connection issue #41 was filed against -- rather than as the
 * superuser DATABASE_URL connection this repo's CI otherwise uses. Roles
 * are cluster-wide in Postgres, so this must never touch the real
 * `app_user` role that every other test and the running application
 * depend on.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', '..', 'db', 'migrations', '0002_app_role.sql');
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

/** Swaps every reference to `app_user` in the migration for a throwaway, per-test role name. */
function migrationSqlFor(testRoleName: string): string {
  return MIGRATION_SQL.replaceAll('app_user', testRoleName);
}

function withDatabaseName(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function withCredentials(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

interface Scratch {
  ownerRoleName: string;
  ownerPassword: string;
  databaseName: string;
  ownerConnectionString: string;
}

/**
 * Provisions a scratch database owned by a fresh, genuinely non-superuser
 * role -- mirroring a managed-Postgres owner role (e.g. Render's
 * `clinic_ai_platform_user`): it owns its database and schema, and can
 * create roles (0002_app_role.sql's `CREATE ROLE` branch requires that in
 * every real environment), but holds neither SUPERUSER nor BYPASSRLS
 * itself and cannot grant either.
 */
async function createScratchOwner(admin: Client): Promise<Scratch> {
  const suffix = randomUUID().replace(/-/g, '_');
  const ownerRoleName = `test_owner_${suffix}`;
  const databaseName = `test_db_${suffix}`;
  const ownerPassword = `pw_${suffix}`;

  await admin.query(
    `CREATE ROLE ${ownerRoleName} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
  );
  await admin.query(`CREATE DATABASE ${databaseName} OWNER ${ownerRoleName}`);

  const ownerConnectionString = withCredentials(
    withDatabaseName(getDatabaseUrl(), databaseName),
    ownerRoleName,
    ownerPassword,
  );

  // A freshly created database's `public` schema is owned by whoever ran
  // CREATE DATABASE (the admin connection here), not the new database
  // owner -- transfer it so the scratch owner can run the migration's
  // `GRANT ... ON SCHEMA public` without needing superuser for that either.
  const scratchAdmin = new Client({
    connectionString: withDatabaseName(getDatabaseUrl(), databaseName),
  });
  await scratchAdmin.connect();
  await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${ownerRoleName}`);
  await scratchAdmin.end();

  return { ownerRoleName, ownerPassword, databaseName, ownerConnectionString };
}

async function dropScratchOwner(admin: Client, scratch: Scratch): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch.databaseName} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${scratch.ownerRoleName}`);
}

describe('db/migrations/0002_app_role.sql: re-runnable on a non-superuser owner connection', () => {
  let admin: Client;
  let scratch: Scratch | undefined;

  afterEach(async () => {
    if (scratch) {
      await dropScratchOwner(admin, scratch);
      scratch = undefined;
    }
    await admin.end();
  });

  it('creates the role on a first run with no pre-existing role', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratchOwner(admin);

    const ownerClient = new Client({ connectionString: scratch.ownerConnectionString });
    await ownerClient.connect();
    const testRoleName = `test_app_user_${randomUUID().replace(/-/g, '_')}`;
    try {
      await ownerClient.query(migrationSqlFor(testRoleName));

      const roleRows = await admin.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [testRoleName],
      );
      expect(roleRows.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    } finally {
      await ownerClient.end();
      // The GRANT the migration issued on schema `public` is a dependency
      // on testRoleName within the scratch database, so it must go first.
      await dropScratchOwner(admin, scratch);
      scratch = undefined;
      await admin.query(`DROP ROLE ${testRoleName}`);
    }
  });

  it('re-running the migration against a role that already exists with correct attributes succeeds -- issue #41', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratchOwner(admin);

    const testRoleName = `test_app_user_${randomUUID().replace(/-/g, '_')}`;
    // Simulate a role that a previous run of this same migration already
    // left in the correct state (or a hosting provider's pre-provisioned
    // role that happens to already be correct) -- created here by the
    // superuser admin connection, standing in for whichever connection
    // created it originally.
    await admin.query(`CREATE ROLE ${testRoleName} LOGIN NOSUPERUSER NOBYPASSRLS`);

    const ownerClient = new Client({ connectionString: scratch.ownerConnectionString });
    await ownerClient.connect();
    try {
      // Before the fix, this unconditionally ran `ALTER ROLE ... NOSUPERUSER
      // NOBYPASSRLS`, which Postgres rejects from a non-superuser connection
      // even though the values are already correct (SQLSTATE 42501) -- this
      // is the exact failure from issue #41. It must now succeed by skipping
      // the no-op ALTER entirely.
      await expect(ownerClient.query(migrationSqlFor(testRoleName))).resolves.toBeDefined();

      const roleRows = await admin.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [testRoleName],
      );
      expect(roleRows.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    } finally {
      await ownerClient.end();
      await dropScratchOwner(admin, scratch);
      scratch = undefined;
      await admin.query(`DROP ROLE ${testRoleName}`);
    }
  });

  it('fails loudly with an actionable message when the role has elevated privileges the connection cannot fix', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratchOwner(admin);

    const testRoleName = `test_app_user_${randomUUID().replace(/-/g, '_')}`;
    // A pre-existing role with elevated privileges -- exactly what PR #25's
    // review was guarding against -- that only a superuser can revoke.
    await admin.query(`CREATE ROLE ${testRoleName} LOGIN NOSUPERUSER BYPASSRLS`);

    const ownerClient = new Client({ connectionString: scratch.ownerConnectionString });
    await ownerClient.connect();
    try {
      await expect(ownerClient.query(migrationSqlFor(testRoleName))).rejects.toThrow(
        /elevated privileges.*does not have the privilege to remove them/s,
      );

      // Nothing was silently left alone without saying so: the role still
      // has BYPASSRLS, exactly as it did before the failed run.
      const roleRows = await admin.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [testRoleName],
      );
      expect(roleRows.rows).toEqual([{ rolsuper: false, rolbypassrls: true }]);
    } finally {
      await ownerClient.end();
      await dropScratchOwner(admin, scratch);
      scratch = undefined;
      await admin.query(`DROP ROLE ${testRoleName}`);
    }
  });
});
