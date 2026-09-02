import { readFileSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import { createPatient } from '@/features/patients';
import { createTestClinic } from '../fixtures';

/**
 * The automated form of ADR-0006's mandatory, non-optional condition:
 * "A CI check fails if the pooler configuration is transaction-mode without
 * reset." This codebase has no external connection pooler in front of
 * Postgres in this slice (no PgBouncer/Supabase pooler config file exists
 * to lint) — the guarantee ADR-0006 actually needs comes from how
 * `src/lib/db.ts` itself sets tenant context, so this test checks that
 * directly:
 *
 *  1. `SET LOCAL` (transaction-scoped), never session-level `SET`, is what
 *     the code path uses — a static check of the source, since a session-
 *     level `SET` is exactly the mistake that would let context leak across
 *     a reused pooled connection.
 *  2. A pooled connection that served one clinic's transaction cannot leak
 *     that context into a later transaction on the same underlying
 *     connection with no explicit reset — a runtime check, since this is
 *     the actual failure mode ADR-0006 exists to prevent.
 *
 * If an external pooler is introduced later, this guard must be extended to
 * lint its configuration too (see README/CONTRIBUTING for this note).
 */
describe('ADR-0006 pooler-configuration guard', () => {
  afterAll(async () => {
    await closePool();
  });

  it('src/lib/db.ts sets tenant context with set_config(..., true) (SET LOCAL semantics), never a session-level SET', () => {
    const source = readFileSync(new URL('../../src/lib/db.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/set_config\(\s*'app\.current_clinic_id'\s*,\s*\$1\s*,\s*true\s*\)/);
    // Forbid the unsafe session-level form anywhere in the file.
    expect(source).not.toMatch(/(?<!SELECT\s)SET\s+(?!LOCAL)app\.current_clinic_id/i);
  });

  it("a pooled connection reused after one clinic's transaction carries no leftover tenant context", async () => {
    const clinicA = await createTestClinic('PoolA');
    const clinicB = await createTestClinic('PoolB');
    await createPatient(clinicA.id, { phoneNumber: '+201000000010' });

    // Run enough transactions back-to-back that the pool is very likely to
    // reuse the same underlying connection for at least one of them
    // (the pool defaults to a small number of connections).
    for (let i = 0; i < 5; i += 1) {
      await withTenantContext(clinicA.id, (client) => client.query('SELECT 1'));
    }

    // Immediately after, with no explicit reset performed by this test,
    // open a bare connection/transaction with no tenant context and prove
    // it does not inherit Clinic A's context from whichever connection it
    // happens to reuse.
    const leaked = await withoutTenantContext(async (client) => {
      const { rows } = await client.query(
        "SELECT current_setting('app.current_clinic_id', true) AS clinic_id",
      );
      return rows[0]?.clinic_id;
    });

    expect(leaked === null || leaked === '' || leaked === undefined).toBe(true);
    expect(leaked).not.toBe(clinicA.id);
    expect(leaked).not.toBe(clinicB.id);
  });
});
