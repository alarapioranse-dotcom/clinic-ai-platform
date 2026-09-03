import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { signIn, validateSession } from '@/features/auth';
import { createPatient, getPatientsForClinic } from '@/features/patients';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

/**
 * Proves the full authenticated chain from docs/technical/04-auth-implementation.md:
 * staff member -> sign-in -> session -> clinic_id derived from the
 * server-side session -> tenant context -> RLS-protected data access.
 * `clinic_id` here comes entirely from `validateSession`'s return value —
 * never a parameter either test supplies to a data-access call directly.
 */
describe('tenant context derived from an authenticated session', () => {
  afterAll(async () => {
    await closePool();
  });

  it("Clinic A staff's authenticated session cannot be used to read Clinic B's patients", async () => {
    const clinicA = await createTestClinic('AuthTenantA');
    const clinicB = await createTestClinic('AuthTenantB');
    const staffA = await createTestStaffMember(clinicA.id, 'AuthTenantA');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000000101' });

    const { token } = await signIn(staffA.email, staffA.password);
    const session = await validateSession(token);
    expect(session).not.toBeNull();

    // The only clinic_id this test ever uses for the data-access call is the
    // one that came back from the authenticated session — not clinicA.id
    // directly, not clinicB.id.
    const visible = await getPatientsForClinic(session!.clinicId);

    expect(session!.clinicId).toBe(clinicA.id);
    expect(visible.map((p) => p.id)).not.toContain(patientB.id);
    expect(visible.every((p) => p.clinicId === clinicA.id)).toBe(true);
  });

  it('two different staff members, at two different clinics, each resolve only their own clinic_id', async () => {
    const clinicA = await createTestClinic('AuthTenantC');
    const clinicB = await createTestClinic('AuthTenantD');
    const staffA = await createTestStaffMember(clinicA.id, 'AuthTenantC');
    const staffB = await createTestStaffMember(clinicB.id, 'AuthTenantD');

    const sessionA = await validateSession((await signIn(staffA.email, staffA.password)).token);
    const sessionB = await validateSession((await signIn(staffB.email, staffB.password)).token);

    expect(sessionA?.clinicId).toBe(clinicA.id);
    expect(sessionB?.clinicId).toBe(clinicB.id);
    expect(sessionA?.clinicId).not.toBe(sessionB?.clinicId);
  });
});
