import { describe, it, expect, afterAll } from 'vitest';
import { withTenantContext, closePool } from '@/lib/db';
import { signIn, validateSession } from '@/features/auth';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

describe('validateSession', () => {
  afterAll(async () => {
    await closePool();
  });

  it('resolves a valid session to the authenticated staff identity', async () => {
    const clinic = await createTestClinic('SessionOK');
    const staff = await createTestStaffMember(clinic.id, 'SessionOK', { role: 'practitioner' });
    const { token } = await signIn(staff.email, staff.password);

    const session = await validateSession(token);

    expect(session).toEqual({ staffId: staff.id, clinicId: clinic.id, role: 'practitioner' });
  });

  it('returns null for a missing token', async () => {
    await expect(validateSession(undefined)).resolves.toBeNull();
    await expect(validateSession(null)).resolves.toBeNull();
    await expect(validateSession('')).resolves.toBeNull();
  });

  it('returns null for a garbage/unknown token', async () => {
    await expect(validateSession('this-token-was-never-issued')).resolves.toBeNull();
  });

  it('returns null for an expired session', async () => {
    const clinic = await createTestClinic('SessionExpired');
    const staff = await createTestStaffMember(clinic.id, 'SessionExpired');
    const { token } = await signIn(staff.email, staff.password);

    // Force expiry directly — an ordinary tenant-scoped write, same path
    // the application itself would use.
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `UPDATE staff_sessions SET expires_at = now() - interval '1 minute'
                    WHERE staff_member_id = $1`,
        [staff.id],
      ),
    );

    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('returns null for a revoked session', async () => {
    const clinic = await createTestClinic('SessionRevoked');
    const staff = await createTestStaffMember(clinic.id, 'SessionRevoked');
    const { token } = await signIn(staff.email, staff.password);

    await withTenantContext(clinic.id, (client) =>
      client.query(`UPDATE staff_sessions SET revoked_at = now() WHERE staff_member_id = $1`, [
        staff.id,
      ]),
    );

    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('returns null once the staff member is deactivated, even with an otherwise-live session', async () => {
    const clinic = await createTestClinic('SessionDeact');
    const staff = await createTestStaffMember(clinic.id, 'SessionDeact');
    const { token } = await signIn(staff.email, staff.password);

    await withTenantContext(clinic.id, (client) =>
      client.query(`UPDATE staff_members SET status = 'deactivated' WHERE id = $1`, [staff.id]),
    );

    await expect(validateSession(token)).resolves.toBeNull();
  });
});
