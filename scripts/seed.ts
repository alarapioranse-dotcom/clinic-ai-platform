/**
 * Deployment-validation seed: creates exactly one demo clinic and one demo
 * staff account, so a fresh deployment's staff sign-in -> app_user -> RLS
 * path (P2-A) can be exercised end-to-end when there is no other data yet.
 * Render Free has no Shell/One-Off Jobs, so this is run manually from a
 * developer's machine against the database's External URL once a
 * deployment goes live — see README.md, "Deployment validation seed".
 *
 * For deployment validation only, per CLAUDE.md's hard rule against real
 * patient or clinic data: seeds nothing beyond the fixed demo clinic and
 * demo staff row below, ever (no patients, conversations, appointments, or
 * any other clinical data).
 *
 * Idempotent by construction: every identifier below is a fixed constant,
 * never read from the environment, so rerunning this script converges the
 * same two rows to the same values (`INSERT ... ON CONFLICT DO UPDATE`)
 * instead of creating duplicates or letting a caller choose the identity of
 * what gets written.
 *
 * Connects with DATABASE_URL (the owner/migration role), exactly like
 * scripts/migrate.ts — never APP_DATABASE_URL, which only the running
 * application and its tests use (see src/lib/env.ts).
 */
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env.local' });

/** Fixed, deterministic demo identifiers — never overridable via the environment (see module doc). */
export const DEMO_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
export const DEMO_CLINIC_NAME = 'Deployment Validation Demo Clinic';
export const DEMO_CLINIC_CONTACT_EMAIL = 'demo-clinic@example.test';
export const DEMO_STAFF_ID = '00000000-0000-0000-0000-000000000002';
export const DEMO_STAFF_EMAIL = 'demo-staff@example.test';
/**
 * The lowest-privilege ADR-0004 role with any API access — not `owner`
 * (PR #40 review, IMPORTANT I1). This account's identity (email, role,
 * clinic id) is published in this repository, so its blast radius if the
 * password is ever compromised should be minimized, not maximized; nothing
 * this seed exists to validate (sign-in, app_user, tenant context,
 * `GET /api/patients`) requires more than `receptionist` — that endpoint's
 * own `requireRole` call accepts all four roles equally.
 */
export const DEMO_STAFF_ROLE = 'receptionist';

/**
 * The "refuse to run in production" gate. Pure and dependency-free —
 * doesn't read `process.env` or touch a database — so it's directly
 * testable. `forced` must be the exact value `isSeedForceEnabled()`
 * (src/lib/env.ts) computes: SEED_FORCE is checked there against the
 * literal string `"true"`, never merely "is this set", so an empty value
 * or a typo can't accidentally authorize a production run.
 */
export function assertNotProductionWithoutForce(appEnv: string, forced: boolean): void {
  if (appEnv === 'production' && !forced) {
    throw new Error(
      'Refusing to run scripts/seed.ts against NEXT_PUBLIC_APP_ENV=production. ' +
        'This seed is for deployment validation only, never a source of real clinic or ' +
        'patient data. Set SEED_FORCE=true to run it anyway — see README.md, ' +
        '"Deployment validation seed".',
    );
  }
}

/**
 * The actual seed write: one transaction, fixed identifiers only. `client`
 * must already be connected via DATABASE_URL.
 *
 * `staff_members` carries `FORCE ROW LEVEL SECURITY` (db/migrations/0005_staff_members.sql),
 * which applies even to this owner-role connection, not only to `app_user`
 * (see docs/STATUS.md's "Verified security properties" and CONTRIBUTING.md).
 * Skipping the `set_config` below would not fail loudly — the staff
 * INSERT/UPDATE would simply match zero rows, RLS's fail-closed default.
 * `clinics` carries no RLS at all (db/migrations/0003_clinics.sql: "a
 * clinic must be able to find its own row before any
 * app.current_clinic_id context exists"), so that insert needs none.
 */
export async function seedDemoData(
  client: Client,
  passwordHash: string,
): Promise<{ clinicId: string; staffId: string; staffEmail: string }> {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO clinics (id, name, contact_email, owner_email, status)
       VALUES ($1, $2, $3, $3, 'active')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         contact_email = EXCLUDED.contact_email,
         owner_email = EXCLUDED.owner_email,
         status = EXCLUDED.status,
         updated_at = now()`,
      [DEMO_CLINIC_ID, DEMO_CLINIC_NAME, DEMO_CLINIC_CONTACT_EMAIL],
    );

    // Bind parameter, never interpolated — the same discipline as
    // src/lib/db.ts's withTenantContext, which this mirrors for the one
    // write this script makes to a tenant-scoped table.
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);

    await client.query(
      `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO UPDATE SET
         clinic_id = EXCLUDED.clinic_id,
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         status = EXCLUDED.status`,
      [DEMO_STAFF_ID, DEMO_CLINIC_ID, DEMO_STAFF_EMAIL, passwordHash, DEMO_STAFF_ROLE],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Seed failed, rolled back: ${(err as Error).message}`, { cause: err });
  }

  return { clinicId: DEMO_CLINIC_ID, staffId: DEMO_STAFF_ID, staffEmail: DEMO_STAFF_EMAIL };
}

async function main(): Promise<void> {
  // Dynamic import, deliberately not static — see the identical note in
  // scripts/migrate.ts: a static import is hoisted above the config() call
  // above, which would evaluate src/lib/env.ts's eager NEXT_PUBLIC_APP_*
  // checks (and, transitively through src/features/auth -> @/lib/db, that
  // same env.ts module) before dotenv has populated process.env from
  // .env.local. Relative paths, not the `@/*` alias, for the same reason
  // migrate.ts uses one: this runs standalone via `tsx`, outside Next.js's
  // own module resolution.
  const { env, getDatabaseUrl, getSeedStaffPassword, isSeedForceEnabled } =
    await import('../src/lib/env');
  const { hashPassword } = await import('../src/features/auth');

  assertNotProductionWithoutForce(env.appEnv, isSeedForceEnabled());

  const passwordHash = await hashPassword(getSeedStaffPassword());

  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result = await seedDemoData(client, passwordHash);
    process.stdout.write(
      `Seed complete: clinic ${result.clinicId} (${DEMO_CLINIC_NAME}), staff ${result.staffEmail}. ` +
        'Password not printed — see README.md, "Deployment validation seed".\n',
    );
  } finally {
    await client.end();
  }
}

// Guards the CLI entry point from running as a side effect of
// tests/db/seed.test.ts importing this module's other exports — running
// `tsx scripts/seed.ts` directly still executes main() as normal.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
