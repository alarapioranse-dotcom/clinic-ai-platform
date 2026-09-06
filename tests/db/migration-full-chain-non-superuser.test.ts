import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { Client } from 'pg';
import { getDatabaseUrl } from '@/lib/env';

/**
 * Regression coverage for issue #43: db/migrations/0007_auth_bootstrap_functions.sql used to run
 * `CREATE ROLE auth_bootstrap NOLOGIN NOSUPERUSER BYPASSRLS`, which Postgres rejects
 * (SQLSTATE 42501, "Only roles with the BYPASSRLS attribute may create roles with the BYPASSRLS
 * attribute") unless the *executing* role already carries BYPASSRLS. The owner/migration role on
 * every managed Postgres this project deploys to (Render, Supabase, Neon, RDS) has neither
 * SUPERUSER nor BYPASSRLS, so that CREATE ROLE could never succeed there — the exact same shape of
 * masking issue #41 was filed against (see tests/db/migration-app-role-rerun.test.ts): the local
 * Postgres superuser used for day-to-day development and CI has BYPASSRLS itself (it's a
 * superuser), so it never hit this failure.
 *
 * Per docs/adr/0013-auth-bootstrap-rls-without-bypassrls.md, auth_bootstrap no longer requests
 * BYPASSRLS at all -- it gets the row-visibility it needs from an explicit, role-scoped RLS policy
 * instead, exactly like every other role in this schema.
 *
 * This test runs the *entire* migration chain (0001-0008), unmodified except for substituting the
 * two role names the migrations manage (see roleSubstitutedSql below) for throwaway, per-test role
 * names, against a scratch database owned by a genuinely non-superuser, non-BYPASSRLS role that can
 * create roles (CREATEROLE) -- mirroring a managed-Postgres owner role -- rather than against the
 * superuser DATABASE_URL connection this repo's CI otherwise uses. Roles are cluster-wide in
 * Postgres, so substituting both names, not just app_user, is required: reusing the real
 * `auth_bootstrap` role name would spuriously pass or fail depending on what earlier, unrelated test
 * runs happened to leave behind in the shared cluster.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));

/** Swaps every reference to app_user/auth_bootstrap for throwaway, per-test role names. */
function roleSubstitutedSql(sql: string, appUserName: string, authBootstrapName: string): string {
  return sql.replaceAll('app_user', appUserName).replaceAll('auth_bootstrap', authBootstrapName);
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
  appUserName: string;
  authBootstrapName: string;
}

/**
 * Provisions a scratch database owned by a fresh, genuinely non-superuser role -- mirroring a
 * managed-Postgres owner role (e.g. Render's `clinic_ai_platform_user`): it owns its database and
 * schema, and can create roles (both 0002_app_role.sql's and 0007's `CREATE ROLE` branches require
 * that in every real environment), but holds neither SUPERUSER nor BYPASSRLS itself and cannot
 * grant either -- same shape as tests/db/migration-app-role-rerun.test.ts's helper of the same
 * name, extended here to also hand back the two substituted role names this test needs.
 */
async function createScratchOwner(admin: Client): Promise<Scratch> {
  const suffix = randomUUID().replace(/-/g, '_');
  const ownerRoleName = `test_owner_${suffix}`;
  const databaseName = `test_db_${suffix}`;
  const ownerPassword = `pw_${suffix}`;
  const appUserName = `test_app_user_${suffix}`;
  const authBootstrapName = `test_auth_bootstrap_${suffix}`;

  await admin.query(
    `CREATE ROLE ${ownerRoleName} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
  );
  await admin.query(`CREATE DATABASE ${databaseName} OWNER ${ownerRoleName}`);

  const ownerConnectionString = withCredentials(
    withDatabaseName(getDatabaseUrl(), databaseName),
    ownerRoleName,
    ownerPassword,
  );

  // A freshly created database's `public` schema is owned by whoever ran CREATE DATABASE (the
  // admin connection here), not the new database owner -- transfer it so the scratch owner can run
  // the migrations' `GRANT ... ON SCHEMA public` (and 0007's `GRANT CREATE ON SCHEMA public`)
  // without needing superuser for that either.
  const scratchAdmin = new Client({
    connectionString: withDatabaseName(getDatabaseUrl(), databaseName),
  });
  await scratchAdmin.connect();
  await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${ownerRoleName}`);
  await scratchAdmin.end();

  return {
    ownerRoleName,
    ownerPassword,
    databaseName,
    ownerConnectionString,
    appUserName,
    authBootstrapName,
  };
}

async function dropScratchOwner(admin: Client, scratch: Scratch): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch.databaseName} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${scratch.ownerRoleName}`);
  await admin.query(`DROP ROLE IF EXISTS ${scratch.appUserName}`);
  await admin.query(`DROP ROLE IF EXISTS ${scratch.authBootstrapName}`);
}

describe('full migration chain (0001-0008) against a non-superuser, non-BYPASSRLS owner role', () => {
  let admin: Client;
  let scratch: Scratch | undefined;

  afterEach(async () => {
    if (scratch) {
      await dropScratchOwner(admin, scratch);
      scratch = undefined;
    }
    await admin.end();
  });

  it('applies every migration file, in order, with no BYPASSRLS anywhere', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratchOwner(admin);

    const ownerClient = new Client({ connectionString: scratch.ownerConnectionString });
    await ownerClient.connect();
    try {
      for (const { file, sql } of MIGRATION_FILES) {
        const substituted = roleSubstitutedSql(sql, scratch.appUserName, scratch.authBootstrapName);
        await expect(
          ownerClient.query(substituted),
          `${file} failed against a genuine non-superuser, non-BYPASSRLS owner role`,
        ).resolves.toBeDefined();
      }

      const roleRows = await admin.query(
        'SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
        [[scratch.appUserName, scratch.authBootstrapName]],
      );
      expect(roleRows.rows).toEqual([
        {
          rolname: scratch.appUserName,
          rolsuper: false,
          rolbypassrls: false,
          rolcanlogin: true,
        },
        {
          rolname: scratch.authBootstrapName,
          rolsuper: false,
          rolbypassrls: false,
          rolcanlogin: false,
        },
      ]);
    } finally {
      await ownerClient.end();
    }
  });

  it('the resulting schema lets the bootstrap functions resolve rows with no tenant context, and nothing else does', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratchOwner(admin);

    const ownerClient = new Client({ connectionString: scratch.ownerConnectionString });
    await ownerClient.connect();
    try {
      for (const { sql } of MIGRATION_FILES) {
        await ownerClient.query(
          roleSubstitutedSql(sql, scratch.appUserName, scratch.authBootstrapName),
        );
      }
    } finally {
      await ownerClient.end();
    }

    // The migrations deliberately never set app_user's password (a hardcoded password in a
    // committed file would be a published credential) -- scripts/migrate.ts sets it separately via
    // a parameterized statement. Set one here, directly, purely so this test can connect as the
    // scratch app_user role to prove the resulting schema behaves correctly end to end. ALTER ROLE
    // (unlike inserting fixture rows) doesn't need a per-database connection -- roles are
    // cluster-wide -- so the admin connection to the main database is fine for this one statement.
    const appUserPassword = `pw_${randomUUID().replace(/-/g, '_')}`;
    await admin.query(`ALTER ROLE ${scratch.appUserName} WITH PASSWORD '${appUserPassword}'`);

    const clinicId = randomUUID();
    const staffId = randomUUID();
    const email = `full-chain-${randomUUID()}@example.test`;
    // `clinics` lives in the scratch database, not the one `admin` is connected to.
    const scratchAdmin = new Client({
      connectionString: withDatabaseName(getDatabaseUrl(), scratch.databaseName),
    });
    await scratchAdmin.connect();
    await scratchAdmin.query(
      `INSERT INTO clinics (id, name, owner_email, contact_email) VALUES ($1, $2, $3, $3)`,
      [clinicId, 'Full Chain Test Clinic', 'owner@example.test'],
    );
    await scratchAdmin.end();
    // withTenantContext-equivalent: set the tenant context directly to insert a fixture row, using
    // the substituted app_user role.
    const setupClient = new Client({
      connectionString: withCredentials(
        withDatabaseName(getDatabaseUrl(), scratch.databaseName),
        scratch.appUserName,
        appUserPassword,
      ),
    });
    await setupClient.connect();
    try {
      await setupClient.query('BEGIN');
      await setupClient.query(`SET LOCAL app.current_clinic_id = '${clinicId}'`);
      await setupClient.query(
        `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'irrelevant-hash', 'owner', 'active')`,
        [staffId, clinicId, email],
      );
      await setupClient.query('COMMIT');
    } finally {
      await setupClient.end();
    }

    const appUserClient = new Client({
      connectionString: withCredentials(
        withDatabaseName(getDatabaseUrl(), scratch.databaseName),
        scratch.appUserName,
        appUserPassword,
      ),
    });
    await appUserClient.connect();
    try {
      const bootstrapRows = await appUserClient.query(
        `SELECT * FROM auth_lookup_staff_by_email($1)`,
        [email],
      );
      expect(bootstrapRows.rows).toEqual([
        {
          staff_id: staffId,
          clinic_id: clinicId,
          role: 'owner',
          status: 'active',
          password_hash: 'irrelevant-hash',
        },
      ]);

      // Not a general bypass: an ordinary direct SELECT with no tenant context set still fails
      // closed, exactly as tests/db/auth-bootstrap.test.ts already proves against the real,
      // cluster-wide app_user/auth_bootstrap roles this test deliberately avoids touching.
      const direct = await appUserClient.query('SELECT * FROM staff_members');
      expect(direct.rows).toHaveLength(0);

      const executeGrant = await appUserClient.query<{ can_execute: boolean }>(
        `SELECT has_function_privilege('public', $1, 'EXECUTE') AS can_execute`,
        ['auth_lookup_staff_by_email(text)'],
      );
      expect(executeGrant.rows[0]?.can_execute).toBe(false);
    } finally {
      await appUserClient.end();
    }
  });
});
