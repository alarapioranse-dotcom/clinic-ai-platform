import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { signIn, signOut, validateSession } from '@/features/auth';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

describe('signOut', () => {
  afterAll(async () => {
    await closePool();
  });

  it('revokes the session, so it no longer validates afterward', async () => {
    const clinic = await createTestClinic('SignOutOK');
    const staff = await createTestStaffMember(clinic.id, 'SignOutOK');
    const { token } = await signIn(staff.email, staff.password);

    await expect(validateSession(token)).resolves.not.toBeNull();

    const revoked = await signOut(token);
    expect(revoked).toBe(true);

    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('is a no-op for a token that was never issued', async () => {
    await expect(signOut('never-issued-token')).resolves.toBe(false);
  });

  it('is a no-op for a missing token', async () => {
    await expect(signOut(undefined)).resolves.toBe(false);
    await expect(signOut(null)).resolves.toBe(false);
  });

  it('is a no-op for an already-revoked token (sign-out is idempotent, not an error)', async () => {
    const clinic = await createTestClinic('SignOutTwice');
    const staff = await createTestStaffMember(clinic.id, 'SignOutTwice');
    const { token } = await signIn(staff.email, staff.password);

    expect(await signOut(token)).toBe(true);
    expect(await signOut(token)).toBe(false);
  });
});
