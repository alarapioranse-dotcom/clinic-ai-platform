import { describe, it, expect, afterAll } from 'vitest';
import { Client } from 'pg';
import { withTenantContext, closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createTestClinic } from '../fixtures';

/**
 * Database coverage for `db/migrations/0012_clinic_timezone.sql`
 * (ADR-0016, Accepted): `clinics.timezone` is `NOT NULL` with no `DEFAULT`,
 * and `app_user` can read it (needed by
 * `src/features/appointments/repository.ts`'s `getEffectiveSchedule`). The
 * demo-clinic backfill itself is covered by `tests/db/seed.test.ts`
 * (`scripts/seed.ts` writes the same fixed row this migration backfills).
 *
 * `clinics` carries no RLS by design (0003_clinics.sql) and this migration
 * does not change that -- there is no RLS behavior of this table's own to
 * test here. `appointments`' RLS, EXCLUDE constraint, and composite foreign
 * keys (tests/db/appointments-invariants.test.ts) are unmodified by this
 * migration and continue to pass unchanged, which is this change's proof
 * that existing security behavior is unaffected.
 */
describe('clinics.timezone (db/migrations/0012_clinic_timezone.sql)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('exists, is NOT NULL, and carries no DEFAULT', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{
        is_nullable: string;
        column_default: string | null;
        data_type: string;
      }>(
        `SELECT is_nullable, column_default, data_type
         FROM information_schema.columns
         WHERE table_name = 'clinics' AND column_name = 'timezone'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        is_nullable: 'NO',
        column_default: null,
        data_type: 'text',
      });
    } finally {
      await admin.end();
    }
  });

  it('rejects inserting a new clinic with no timezone', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      await expect(
        admin.query(
          `INSERT INTO clinics (id, name, owner_email, contact_email)
           VALUES (gen_random_uuid(), 'No Timezone Clinic', 'no-tz@example.test', 'no-tz@example.test')`,
        ),
      ).rejects.toThrow(/null value in column "timezone"|violates not-null constraint/);
    } finally {
      await admin.end();
    }
  });

  it('accepts a new clinic that explicitly supplies an IANA timezone', async () => {
    const clinic = await createTestClinic('TimezoneAccepted', 'Africa/Cairo');

    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ timezone: string }>(
        'SELECT timezone FROM clinics WHERE id = $1',
        [clinic.id],
      );
      expect(rows[0]?.timezone).toBe('Africa/Cairo');
    } finally {
      await admin.end();
    }
  });

  it('does not itself validate that the string is a real IANA zone (no DB-level lookup table, ADR-0016 decision item 6) -- validation is an application-layer concern (isValidIanaTimeZone, schedule.ts)', async () => {
    // Demonstrates the schema's actual, current behavior (accepts any
    // non-null text), not a policy this migration establishes -- the same
    // "no custom timezone/offset table" instruction that rules out a
    // hand-rolled DST engine also rules out inventing DB-level open-set
    // validation infrastructure for this slice.
    const clinic = await createTestClinic('TimezoneNotDbValidated', 'Not/ARealZone');

    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ timezone: string }>(
        'SELECT timezone FROM clinics WHERE id = $1',
        [clinic.id],
      );
      expect(rows[0]?.timezone).toBe('Not/ARealZone');
    } finally {
      await admin.end();
    }
  });

  it('app_user can read clinics.timezone (GRANT SELECT (timezone))', async () => {
    const clinic = await createTestClinic('TimezoneAppUserRead', 'Asia/Dubai');

    const timezone = await withTenantContext(clinic.id, async (client) => {
      const { rows } = await client.query<{ timezone: string }>(
        'SELECT timezone FROM clinics WHERE id = $1',
        [clinic.id],
      );
      return rows[0]?.timezone;
    });

    expect(timezone).toBe('Asia/Dubai');
  });
});
