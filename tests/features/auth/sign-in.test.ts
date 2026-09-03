import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { signIn, InvalidCredentialsError } from '@/features/auth';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

describe('signIn', () => {
  afterAll(async () => {
    await closePool();
  });

  it('authenticates a valid, active staff member', async () => {
    const clinic = await createTestClinic('SignInOK');
    const staff = await createTestStaffMember(clinic.id, 'SignInOK', { role: 'admin' });

    const result = await signIn(staff.email, staff.password);

    expect(result.staffId).toBe(staff.id);
    expect(result.clinicId).toBe(clinic.id);
    expect(result.role).toBe('admin');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
    // No credential material leaks onto the returned object.
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('password_hash');
    expect(result).not.toHaveProperty('tokenHash');
  });

  it('rejects a wrong password with a generic error', async () => {
    const clinic = await createTestClinic('SignInWrongPw');
    const staff = await createTestStaffMember(clinic.id, 'SignInWrongPw');

    await expect(signIn(staff.email, 'definitely-the-wrong-password')).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('rejects an unknown email with the same generic error as a wrong password', async () => {
    const unknownEmail = `nobody-${randomUUID()}@example.test`;

    let unknownEmailError: unknown;
    try {
      await signIn(unknownEmail, 'whatever-password');
    } catch (err) {
      unknownEmailError = err;
    }

    const clinic = await createTestClinic('SignInWrongPw2');
    const staff = await createTestStaffMember(clinic.id, 'SignInWrongPw2');
    let wrongPasswordError: unknown;
    try {
      await signIn(staff.email, 'definitely-the-wrong-password');
    } catch (err) {
      wrongPasswordError = err;
    }

    expect(unknownEmailError).toBeInstanceOf(InvalidCredentialsError);
    expect(wrongPasswordError).toBeInstanceOf(InvalidCredentialsError);
    expect((unknownEmailError as Error).message).toBe((wrongPasswordError as Error).message);
  });

  it('rejects a deactivated staff member with the same generic error, even with the correct password', async () => {
    const clinic = await createTestClinic('SignInDeact');
    const staff = await createTestStaffMember(clinic.id, 'SignInDeact', { status: 'deactivated' });

    await expect(signIn(staff.email, staff.password)).rejects.toThrow(InvalidCredentialsError);
  });
});
