import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as patientsRoute, POST as createPatientRoute } from '@/app/api/patients/route';

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

function authedPostRequest(
  url: string,
  cookieValue: string | undefined,
  body: unknown,
): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(cookieValue ? { cookie: `session=${cookieValue}` } : {}),
    },
  });
}

async function signInAs(
  clinicId: string,
  label: string,
  role: 'owner' | 'admin' | 'practitioner' | 'receptionist',
): Promise<string> {
  const staff = await createTestStaffMember(clinicId, label, { role });
  const signInResponse = await signInRoute(
    jsonRequest('http://localhost/api/auth/sign-in', {
      email: staff.email,
      password: staff.password,
    }),
  );
  const token = signInResponse.cookies.get('session')?.value;
  if (!token) throw new Error('sign-in fixture did not return a session token');
  return token;
}

const ALL_ROLES = ['owner', 'admin', 'practitioner', 'receptionist'] as const;
const ALLOWED_CREATE_ROLES = ['owner', 'admin', 'receptionist'] as const;

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

/**
 * HTTP-boundary coverage of POST /api/patients — the P2 role-enforcement
 * slice approved on top of PR #32's GET precedent
 * (docs/technical/03-api-contracts.md: owner/admin/receptionist may create,
 * practitioner may not). `phoneNumber` is a clearly synthetic test value in
 * every case here, never real patient data (CLAUDE.md hard rule).
 */
describe('POST /api/patients', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await createPatientRoute(
      authedPostRequest('http://localhost/api/patients', undefined, {
        phoneNumber: '+10000000001',
      }),
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALLOWED_CREATE_ROLES) {
    it(`returns 201 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`PatientsCreate-${role}`);
      const token = await signInAs(clinic.id, `PatientsCreate-${role}`, role);

      const response = await createPatientRoute(
        authedPostRequest('http://localhost/api/patients', token, {
          phoneNumber: '+10000000002',
          displayName: 'Synthetic Test Patient',
        }),
      );

      expect(response.status).toBe(201);
      const body: { data: { id: string; clinicId: string; phoneNumber: string } } =
        await response.json();
      expect(body.data.clinicId).toBe(clinic.id);
      expect(body.data.phoneNumber).toBe('+10000000002');
    });
  }

  it('returns 403 for role "practitioner"', async () => {
    const clinic = await createTestClinic('PatientsCreate-practitioner');
    const token = await signInAs(clinic.id, 'PatientsCreate-practitioner', 'practitioner');

    const response = await createPatientRoute(
      authedPostRequest('http://localhost/api/patients', token, {
        phoneNumber: '+10000000003',
      }),
    );

    expect(response.status).toBe(403);
  });

  it('returns 400 when phoneNumber is missing', async () => {
    const clinic = await createTestClinic('PatientsCreate-missing-phone');
    const token = await signInAs(clinic.id, 'PatientsCreate-missing-phone', 'owner');

    const response = await createPatientRoute(
      authedPostRequest('http://localhost/api/patients', token, {
        displayName: 'No Phone Number',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('creates the patient scoped to the caller clinic, invisible to another clinic', async () => {
    const clinicOwn = await createTestClinic('PatientsCreateScopeOwn');
    const clinicOther = await createTestClinic('PatientsCreateScopeOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'PatientsCreateScopeOwn', 'owner');
    const tokenOther = await signInAs(clinicOther.id, 'PatientsCreateScopeOther', 'owner');

    const createResponse = await createPatientRoute(
      authedPostRequest('http://localhost/api/patients', tokenOwn, {
        phoneNumber: '+10000000004',
      }),
    );
    expect(createResponse.status).toBe(201);

    const ownListResponse = await patientsRoute(
      getRequest('http://localhost/api/patients', tokenOwn),
    );
    const ownList: { data: Array<{ phoneNumber: string }> } = await ownListResponse.json();
    expect(ownList.data.some((p) => p.phoneNumber === '+10000000004')).toBe(true);

    const otherListResponse = await patientsRoute(
      getRequest('http://localhost/api/patients', tokenOther),
    );
    const otherList: { data: Array<{ phoneNumber: string }> } = await otherListResponse.json();
    expect(otherList.data.some((p) => p.phoneNumber === '+10000000004')).toBe(false);
  });
});
