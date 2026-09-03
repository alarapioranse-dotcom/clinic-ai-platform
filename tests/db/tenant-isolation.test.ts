import { describe, it, expect, afterAll } from 'vitest';
import type { PoolClient, QueryResult } from 'pg';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import { createPatient, getPatientsForClinic } from '@/features/patients';
import { createTestClinic } from '../fixtures';

/**
 * Runs a query expected to be denied by RLS with no tenant context set, and
 * asserts it never returns another clinic's rows. Empirically (verified
 * against a real Postgres 16 instance while writing this suite — see the
 * PR description), `current_setting('app.current_clinic_id', true)` returns
 * true NULL only on a connection that has *never* had the GUC touched;
 * `clinic_id = NULL` is never true, so the policy denies all rows and the
 * query returns zero rows, exactly as
 * docs/technical/02-tenant-isolation-testing.md describes. But once a
 * pooled connection has been used for any clinic's transaction and that
 * transaction committed, Postgres resets the custom GUC to an empty string
 * (not NULL) rather than "undefined" again — so `::uuid` casting it throws
 * a Postgres error instead of evaluating to a 0-row result. Both outcomes
 * are fail-closed: neither ever returns a row belonging to a clinic other
 * than none, so this helper treats either as passing, and is the reason
 * `withoutTenantContext` must never be used by real application code.
 */
async function expectFailClosed(run: (client: PoolClient) => Promise<QueryResult>): Promise<void> {
  try {
    const result = await withoutTenantContext(run);
    expect(result.rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(/invalid input syntax for type uuid/i);
  }
}

/**
 * Proves tenant isolation is enforced by RLS at the data layer, per ADR-0003,
 * ADR-0006, and docs/technical/02-tenant-isolation-testing.md. Every
 * assertion here runs against a real Postgres instance through the
 * least-privilege `app_user` role (never the migration/owner role) — see
 * that document's explicit precondition for a meaningful test.
 */
describe('tenant isolation: patients', () => {
  afterAll(async () => {
    await closePool();
  });

  it('Clinic A sees its own patient', async () => {
    const clinicA = await createTestClinic('A1');
    const patient = await createPatient(clinicA.id, { phoneNumber: '+201000000001' });

    const visible = await getPatientsForClinic(clinicA.id);

    expect(visible.map((p) => p.id)).toContain(patient.id);
  });

  it('Clinic A cannot see Clinic B patients (Test 1)', async () => {
    const clinicA = await createTestClinic('A2');
    const clinicB = await createTestClinic('B2');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000000002' });

    const visibleToA = await getPatientsForClinic(clinicA.id);

    expect(visibleToA.map((p) => p.id)).not.toContain(patientB.id);
    // Not merely "this query shape didn't return it" — an unscoped SELECT *
    // as Clinic A must total exactly Clinic A's own rows.
    expect(visibleToA.every((p) => p.clinicId === clinicA.id)).toBe(true);
  });

  it('no tenant context set (unset variable, inside a transaction) fails closed (Test 2)', async () => {
    const clinicA = await createTestClinic('A3');
    await createPatient(clinicA.id, { phoneNumber: '+201000000003' });

    await expectFailClosed(async (client) => {
      await client.query('BEGIN');
      try {
        // Deliberately never calling set_config: app.current_clinic_id is
        // unset for this transaction.
        const result = await client.query('SELECT id FROM patients');
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  });

  it('a query path that opens no transaction at all also fails closed (ADR-0006 required case)', async () => {
    const clinicA = await createTestClinic('A4');
    await createPatient(clinicA.id, { phoneNumber: '+201000000004' });

    // withoutTenantContext issues a bare query on a pooled connection with
    // no BEGIN and no set_config call — exactly the "connection-pool health
    // check, a raw query helper someone adds later bypassing the normal
    // request path" scenario ADR-0006 names.
    await expectFailClosed((client) => client.query('SELECT id FROM patients'));
  });

  it('rejects an insert whose clinic_id does not match the transaction tenant context', async () => {
    const clinicA = await createTestClinic('A5');
    const clinicB = await createTestClinic('B5');

    // Bypasses the patients feature's own repository (which never lets a
    // caller do this) to prove the *database*, not application code, is
    // what rejects a mismatched clinic_id — the RLS WITH CHECK clause.
    await expect(
      withTenantContext(clinicA.id, (client) =>
        client.query(`INSERT INTO patients (clinic_id, phone_number) VALUES ($1, $2)`, [
          clinicB.id,
          '+201000000005',
        ]),
      ),
    ).rejects.toThrow(/row-level security policy/i);

    // And confirm nothing was actually inserted under either clinic.
    const visibleToB = await getPatientsForClinic(clinicB.id);
    expect(visibleToB.map((p) => p.phoneNumber)).not.toContain('+201000000005');
  });

  it("an update targeting another clinic's patient touches zero rows, not the row", async () => {
    const clinicA = await createTestClinic('A6');
    const clinicB = await createTestClinic('B6');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000000006' });

    const updateResult = await withTenantContext(clinicA.id, (client) =>
      client.query(`UPDATE patients SET display_name = $1 WHERE id = $2`, [
        'should not apply',
        patientB.id,
      ]),
    );
    expect(updateResult.rowCount).toBe(0);

    const [unchanged] = await getPatientsForClinic(clinicB.id);
    expect(unchanged?.id).toBe(patientB.id);
    expect(unchanged?.displayName).toBeNull();
  });
});
