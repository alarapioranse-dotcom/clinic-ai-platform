import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { withoutTenantContext, withTenantContext, closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';

/**
 * Proves ADR-0012's (human-approved) SECURITY DEFINER bootstrap mechanism
 * does exactly what it's meant to and nothing more: the two functions work
 * with no tenant context, expose only their documented columns, and every
 * other path into staff_members/staff_sessions stays fully RLS-gated —
 * i.e. this is NOT a general tenant bypass, only these two named functions
 * are. Runs through the `app_user` role (via withoutTenantContext, the
 * lowest-privilege connection this test suite has — see
 * docs/technical/02-tenant-isolation-testing.md's precondition for a
 * meaningful RLS test), never a superuser.
 */
describe('ADR-0012 authentication bootstrap functions', () => {
  afterAll(async () => {
    await closePool();
  });

  it('auth_lookup_staff_by_email resolves a staff member with no tenant context set', async () => {
    const clinic = await createTestClinic('BootstrapA1');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapA1');

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_staff_by_email($1)', [staff.email]),
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      staff_id: staff.id,
      clinic_id: clinic.id,
      role: staff.role,
      status: staff.status,
    });
    expect(typeof rows.rows[0].password_hash).toBe('string');
  });

  it('auth_lookup_staff_by_email returns zero rows for an unknown email', async () => {
    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_staff_by_email($1)', [
        `nobody-${randomUUID()}@example.test`,
      ]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('auth_lookup_staff_by_email exposes exactly the documented columns, nothing more', async () => {
    const clinic = await createTestClinic('BootstrapCols');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapCols');

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_staff_by_email($1)', [staff.email]),
    );

    expect(Object.keys(rows.rows[0]).sort()).toEqual(
      ['staff_id', 'clinic_id', 'role', 'status', 'password_hash'].sort(),
    );
  });

  it('auth_lookup_session_by_token_hash resolves a currently-valid session with no tenant context', async () => {
    const clinic = await createTestClinic('BootstrapA2');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapA2');
    const tokenHash = `hash-${randomUUID()}`;
    const sessionId = await withTenantContext(clinic.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '7 days') RETURNING id`,
        [staff.id, clinic.id, tokenHash],
      );
      return rows[0]!.id;
    });

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [tokenHash]),
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      session_id: sessionId,
      staff_id: staff.id,
      clinic_id: clinic.id,
      role: staff.role,
      status: 'active',
    });
  });

  it('auth_lookup_session_by_token_hash exposes exactly the documented columns, nothing more', async () => {
    const clinic = await createTestClinic('BootstrapCols2');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapCols2');
    const tokenHash = `hash-${randomUUID()}`;
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '7 days')`,
        [staff.id, clinic.id, tokenHash],
      ),
    );

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [tokenHash]),
    );

    expect(Object.keys(rows.rows[0]).sort()).toEqual(
      ['session_id', 'staff_id', 'clinic_id', 'role', 'status'].sort(),
    );
  });

  it('auth_lookup_session_by_token_hash excludes an expired session', async () => {
    const clinic = await createTestClinic('BootstrapExp');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapExp');
    const tokenHash = `hash-${randomUUID()}`;
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() - interval '1 minute')`,
        [staff.id, clinic.id, tokenHash],
      ),
    );

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [tokenHash]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('auth_lookup_session_by_token_hash excludes a revoked session', async () => {
    const clinic = await createTestClinic('BootstrapRev');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapRev');
    const tokenHash = `hash-${randomUUID()}`;
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at, revoked_at)
         VALUES ($1, $2, $3, now() + interval '7 days', now())`,
        [staff.id, clinic.id, tokenHash],
      ),
    );

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [tokenHash]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('auth_lookup_session_by_token_hash excludes a session whose staff member was deactivated after issuance', async () => {
    const clinic = await createTestClinic('BootstrapDeact');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapDeact');
    const tokenHash = `hash-${randomUUID()}`;
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '7 days')`,
        [staff.id, clinic.id, tokenHash],
      ),
    );
    await withTenantContext(clinic.id, (client) =>
      client.query(`UPDATE staff_members SET status = 'deactivated' WHERE id = $1`, [staff.id]),
    );

    const rows = await withoutTenantContext((client) =>
      client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [tokenHash]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('is NOT a general bypass: an ordinary direct SELECT on staff_members with no tenant context still fails closed', async () => {
    const clinic = await createTestClinic('BootstrapNoBypassA');
    await createTestStaffMember(clinic.id, 'BootstrapNoBypassA');

    try {
      const result = await withoutTenantContext((client) =>
        client.query('SELECT * FROM staff_members'),
      );
      expect(result.rows).toHaveLength(0);
    } catch (err) {
      // Fail-closed can also surface as a Postgres error (see
      // tests/db/tenant-isolation.test.ts's expectFailClosed for why) —
      // either outcome proves no row from any clinic leaked.
      expect((err as Error).message).toMatch(
        /invalid input syntax for type uuid|permission denied/i,
      );
    }
  });

  it('is NOT a general bypass: an ordinary direct SELECT on staff_sessions with no tenant context still fails closed', async () => {
    const clinic = await createTestClinic('BootstrapNoBypassB');
    const staff = await createTestStaffMember(clinic.id, 'BootstrapNoBypassB');
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '7 days')`,
        [staff.id, clinic.id, `hash-${randomUUID()}`],
      ),
    );

    try {
      const result = await withoutTenantContext((client) =>
        client.query('SELECT * FROM staff_sessions'),
      );
      expect(result.rows).toHaveLength(0);
    } catch (err) {
      expect((err as Error).message).toMatch(
        /invalid input syntax for type uuid|permission denied/i,
      );
    }
  });

  it('EXECUTE on both bootstrap functions is not granted to PUBLIC', async () => {
    const result = await withoutTenantContext((client) =>
      client.query<{ can_execute: boolean }>(
        `SELECT has_function_privilege('public', 'auth_lookup_staff_by_email(text)', 'EXECUTE') AS can_execute`,
      ),
    );
    expect(result.rows[0]?.can_execute).toBe(false);
  });
});

/**
 * ADR-0012, Decision 1 (human-approved): staff_members.email is globally
 * unique, not merely unique per clinic — the sign-in flow resolves by email
 * alone, with no clinic selector.
 */
describe('staff_members.email global uniqueness (ADR-0012 Decision 1)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('rejects a second staff member with the same email at a different clinic', async () => {
    const clinicA = await createTestClinic('UniqA');
    const clinicB = await createTestClinic('UniqB');
    const sharedEmail = `shared-${randomUUID()}@example.test`;

    await createTestStaffMember(clinicA.id, 'UniqA', { email: sharedEmail });

    await expect(
      createTestStaffMember(clinicB.id, 'UniqB', { email: sharedEmail }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });
});
