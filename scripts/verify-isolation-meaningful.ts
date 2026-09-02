/**
 * One-time, human-run verification that the automated tenant-isolation
 * tests are meaningful, per docs/technical/02-tenant-isolation-testing.md's
 * "Test 3": prove the tests would actually fail if isolation were broken.
 * This is NOT part of the CI run or the `npm test` suite — the doc is
 * explicit that this check runs "only when authoring/reviewing this test,
 * against a disposable database — never in a normal CI run, since it
 * deliberately weakens isolation."
 *
 * Run only against a disposable local/test database:
 *   npx tsx scripts/verify-isolation-meaningful.ts
 *
 * Empirically verified against a real Postgres 16 instance while writing
 * this suite: `DROP POLICY tenant_isolation ON patients` alone does NOT
 * leak anything, because the table still has `ENABLE ROW LEVEL SECURITY`
 * set — Postgres denies all access by default when RLS is enabled and zero
 * policies apply, independent of `FORCE`. That is a stronger guarantee than
 * docs/technical/02-tenant-isolation-testing.md's own illustrative Test 3
 * assumed (it expected a dropped policy to leak); this script records that
 * refinement rather than silently treating the doc's assumption as correct.
 *
 * The regression that actually leaks is Row Level Security being disabled
 * on the table entirely (e.g. a future migration reverting
 * `ENABLE ROW LEVEL SECURITY`, or a new tenant-scoped table added without
 * it) — so that is what this script proves the isolation test suite would
 * catch.
 */
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env.local' });

const RESTORE_SQL = `
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON patients;
CREATE POLICY tenant_isolation ON patients
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
`;

async function main(): Promise<void> {
  // Dynamic import, deliberately not static: see the note in
  // scripts/migrate.ts — this must run after config() above.
  const { getDatabaseUrl, getAppDatabaseUrl } = await import('../src/lib/env');
  const admin = new Client({ connectionString: getDatabaseUrl() });
  const app = new Client({ connectionString: getAppDatabaseUrl() });
  await admin.connect();
  await app.connect();

  const clinicAId = '11111111-1111-1111-1111-111111111111';
  const clinicBId = '22222222-2222-2222-2222-222222222222';

  try {
    // Fixture: two clinics, one patient each (test-only data, no real
    // patients or clinics — charter §7 / hard rule).
    await admin.query(
      `INSERT INTO clinics (id, name, owner_email, contact_email)
       VALUES ($1, 'Verify Clinic A', 'a@example.test', 'a@example.test'),
              ($2, 'Verify Clinic B', 'b@example.test', 'b@example.test')
       ON CONFLICT (id) DO NOTHING`,
      [clinicAId, clinicBId],
    );

    await app.query('BEGIN');
    await app.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicBId]);
    const insertB = await app.query(
      `INSERT INTO patients (clinic_id, phone_number) VALUES ($1, '+201000000099') RETURNING id`,
      [clinicBId],
    );
    await app.query('COMMIT');
    const clinicBPatientId: string = insertB.rows[0].id;

    // Baseline: with RLS and the policy in place, Clinic A must not see
    // Clinic B's patient.
    const countAsClinicA = async (): Promise<number> => {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicAId]);
      const result = await app.query('SELECT count(*)::int AS n FROM patients WHERE id = $1', [
        clinicBPatientId,
      ]);
      await app.query('COMMIT');
      return result.rows[0].n;
    };

    const baseline = await countAsClinicA();
    process.stdout.write(
      `Baseline (RLS enabled, policy present): Clinic A sees Clinic B's patient in ${baseline} row(s) (expected 0).\n`,
    );
    if (baseline !== 0) {
      throw new Error(
        'Baseline failed: RLS is not isolating tenants even before any regression. Stopping.',
      );
    }

    try {
      // Step 1: drop only the policy. Expected NOT to leak — RLS enabled
      // with zero policies denies by default (see comment above).
      await admin.query('DROP POLICY IF EXISTS tenant_isolation ON patients');
      const afterDropPolicy = await countAsClinicA();
      process.stdout.write(
        `After DROP POLICY only (RLS still enabled): ${afterDropPolicy} row(s) visible (expected 0 — defense-in-depth from ENABLE ROW LEVEL SECURITY holds even with no policy).\n`,
      );
      if (afterDropPolicy !== 0) {
        throw new Error(`Expected 0 rows with RLS enabled and no policy; got ${afterDropPolicy}.`);
      }

      // Step 2: the actual regression that leaks — RLS disabled entirely.
      await admin.query('ALTER TABLE patients DISABLE ROW LEVEL SECURITY');
      const afterDisableRls = await countAsClinicA();
      process.stdout.write(
        `After DISABLE ROW LEVEL SECURITY: ${afterDisableRls} row(s) visible (expected 1, proving the isolation test suite would catch this regression).\n`,
      );
      if (afterDisableRls !== 1) {
        throw new Error(
          `Expected disabling RLS to leak Clinic B's row (count=1); got ${afterDisableRls}. The isolation test may not be exercising RLS at all.`,
        );
      }

      process.stdout.write(
        'VERIFIED: the tenant-isolation test suite is meaningful — it would fail if Row Level Security were disabled on this table.\n',
      );
    } finally {
      // Restore immediately, regardless of outcome above.
      await admin.query(RESTORE_SQL);
      const afterRestore = await countAsClinicA();
      process.stdout.write(`Restored. ${afterRestore} row(s) visible post-restore (expected 0).\n`);
    }

    // Cleanup: remove every fixture row under these two clinic ids, not
    // just the one just inserted — a prior failed run of this script can
    // leave orphaned patient rows under the same fixed ids.
    await admin.query('DELETE FROM patients WHERE clinic_id = ANY($1)', [[clinicAId, clinicBId]]);
    await admin.query('DELETE FROM clinics WHERE id = ANY($1)', [[clinicAId, clinicBId]]);
  } finally {
    await admin.end();
    await app.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
