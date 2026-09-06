import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Client } from 'pg';
import { getDatabaseUrl } from '@/lib/env';
import { closePool } from '@/lib/db';
import { signIn, hashPassword } from '@/features/auth';
import {
  DEMO_CLINIC_ID,
  DEMO_CLINIC_NAME,
  DEMO_STAFF_ID,
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_ROLE,
  assertNotProductionWithoutForce,
  seedDemoData,
} from '../../scripts/seed';

/**
 * Coverage for scripts/seed.ts's deployment-validation seed: refuses
 * production without an explicit force, is idempotent, never stores the
 * demo password in the clear, and produces exactly one demo clinic and one
 * demo staff identity. Runs against a real Postgres instance via
 * DATABASE_URL — the same owner/migration connection the script itself
 * uses — per docs/technical/02-tenant-isolation-testing.md's "RLS cannot be
 * meaningfully faked" precondition: staff_members carries FORCE ROW LEVEL
 * SECURITY even for this role (see seedDemoData's own comment), so reading
 * it back here needs the same set_config dance the seed itself performs.
 */
describe('scripts/seed.ts: production guard', () => {
  it('refuses to run against NEXT_PUBLIC_APP_ENV=production with no force flag', () => {
    expect(() => assertNotProductionWithoutForce('production', false)).toThrow(/SEED_FORCE/);
  });

  it('runs when forced, even in production', () => {
    expect(() => assertNotProductionWithoutForce('production', true)).not.toThrow();
  });

  it('runs unforced outside production', () => {
    expect(() => assertNotProductionWithoutForce('development', false)).not.toThrow();
    expect(() => assertNotProductionWithoutForce('staging', false)).not.toThrow();
  });
});

describe('scripts/seed.ts: seedDemoData', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: getDatabaseUrl() });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  afterAll(async () => {
    await closePool();
  });

  it('produces exactly one demo clinic and one demo staff row, with the password hashed, never plaintext', async () => {
    const password = `SeedTestPassword-${randomUUID()}`;
    const passwordHash = await hashPassword(password);

    const result = await seedDemoData(client, passwordHash);

    expect(result).toEqual({
      clinicId: DEMO_CLINIC_ID,
      staffId: DEMO_STAFF_ID,
      staffEmail: DEMO_STAFF_EMAIL,
    });

    const clinicRows = await client.query('SELECT id, name FROM clinics WHERE id = $1', [
      DEMO_CLINIC_ID,
    ]);
    expect(clinicRows.rows).toHaveLength(1);
    expect(clinicRows.rows[0]).toMatchObject({ id: DEMO_CLINIC_ID, name: DEMO_CLINIC_NAME });

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    const staffRows = await client.query(
      `SELECT id, clinic_id, email, role, password_hash FROM staff_members WHERE id = $1`,
      [DEMO_STAFF_ID],
    );
    await client.query('COMMIT');

    expect(staffRows.rows).toHaveLength(1);
    const staffRow = staffRows.rows[0];
    expect(staffRow.email).toBe(DEMO_STAFF_EMAIL);
    expect(staffRow.role).toBe(DEMO_STAFF_ROLE);
    expect(staffRow.password_hash).toMatch(/^\$argon2id\$/);
    expect(staffRow.password_hash).not.toBe(password);
    expect(staffRow.password_hash).not.toContain(password);

    // Not merely well-formed — genuinely usable to sign in as this account.
    const signInResult = await signIn(DEMO_STAFF_EMAIL, password);
    expect(signInResult.clinicId).toBe(DEMO_CLINIC_ID);
    expect(signInResult.staffId).toBe(DEMO_STAFF_ID);
  });

  it('running the seed twice does not create duplicate rows and converges to the latest password', async () => {
    const passwordA = `SeedTestPasswordA-${randomUUID()}`;
    const passwordB = `SeedTestPasswordB-${randomUUID()}`;

    await seedDemoData(client, await hashPassword(passwordA));
    await seedDemoData(client, await hashPassword(passwordB));

    const clinicCount = await client.query('SELECT count(*)::int AS n FROM clinics WHERE id = $1', [
      DEMO_CLINIC_ID,
    ]);
    expect(clinicCount.rows[0].n).toBe(1);

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    const staffCount = await client.query(
      'SELECT count(*)::int AS n FROM staff_members WHERE id = $1',
      [DEMO_STAFF_ID],
    );
    await client.query('COMMIT');
    expect(staffCount.rows[0].n).toBe(1);

    // The row converged to the second run's password — the first run's
    // password no longer works, it wasn't merely left alongside it.
    await expect(signIn(DEMO_STAFF_EMAIL, passwordA)).rejects.toThrow();
    const result = await signIn(DEMO_STAFF_EMAIL, passwordB);
    expect(result.staffId).toBe(DEMO_STAFF_ID);
  });
});
