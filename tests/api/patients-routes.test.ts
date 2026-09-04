import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as patientsRoute } from '@/app/api/patients/route';

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function getRequest(url: string, cookieValue: string | undefined): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieValue ? { cookie: `session=${cookieValue}` } : {},
  });
}

const ALL_ROLES = ['owner', 'admin', 'practitioner', 'receptionist'] as const;

/**
 * HTTP-boundary coverage of GET /api/patients, the first route wired to
 * `requireRole` (docs/technical/03-api-contracts.md: all four roles allowed
 * — practitioner included, read-only). Mirrors tests/api/auth-routes.test.ts.
 */
describe('GET /api/patients', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await patientsRoute(getRequest('http://localhost/api/patients', undefined));
    expect(response.status).toBe(401);
  });

  for (const role of ALL_ROLES) {
    it(`returns 200 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`Patients-${role}`);
      const staff = await createTestStaffMember(clinic.id, `Patients-${role}`, { role });

      const signInResponse = await signInRoute(
        jsonRequest('http://localhost/api/auth/sign-in', {
          email: staff.email,
          password: staff.password,
        }),
      );
      const token = signInResponse.cookies.get('session')?.value;
      expect(token).toBeTruthy();

      const response = await patientsRoute(getRequest('http://localhost/api/patients', token));

      expect(response.status).toBe(200);
      const body: { data: unknown[] } = await response.json();
      expect(Array.isArray(body.data)).toBe(true);
    });
  }

  it('only returns patients belonging to the calling staff member clinic', async () => {
    const clinicOwn = await createTestClinic('PatientsScopeOwn');
    const clinicOther = await createTestClinic('PatientsScopeOther');
    const staffOwn = await createTestStaffMember(clinicOwn.id, 'PatientsScopeOwn');
    await createTestStaffMember(clinicOther.id, 'PatientsScopeOther');

    const signInResponse = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staffOwn.email,
        password: staffOwn.password,
      }),
    );
    const token = signInResponse.cookies.get('session')?.value;

    const response = await patientsRoute(getRequest('http://localhost/api/patients', token));
    expect(response.status).toBe(200);
    const body: { data: Array<{ clinicId: string }> } = await response.json();
    for (const patient of body.data) {
      expect(patient.clinicId).toBe(clinicOwn.id);
    }
  });
});
