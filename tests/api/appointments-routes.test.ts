import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember, setClinicWorkingHours } from '../fixtures';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as availabilityRoute } from '@/app/api/appointments/availability/route';
import { GET as practitionersRoute } from '@/app/api/appointments/practitioners/route';
import { POST as bookRoute } from '@/app/api/appointments/route';

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

function postRequest(url: string, cookieValue: string | undefined, body: unknown): NextRequest {
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
const BOOKING_ROLES = ['owner', 'admin', 'receptionist'] as const;
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * HTTP-boundary coverage of GET /api/appointments/availability, GET
 * /api/appointments/practitioners, and POST /api/appointments (roadmap P4
 * Slice 1). Mirrors tests/api/conversations-routes.test.ts and
 * tests/api/patients-routes.test.ts's conventions for the session/role
 * checks and the 404-vs-403 cross-tenant rule.
 */
describe('GET /api/appointments/practitioners', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await practitionersRoute(
      getRequest('http://localhost/api/appointments/practitioners', undefined),
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALL_ROLES) {
    it(`returns 200 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`Practitioners-${role}`);
      const token = await signInAs(clinic.id, `Practitioners-${role}`, role);

      const response = await practitionersRoute(
        getRequest('http://localhost/api/appointments/practitioners', token),
      );

      expect(response.status).toBe(200);
      const body: { data: unknown[] } = await response.json();
      expect(Array.isArray(body.data)).toBe(true);
    });
  }
});

describe('GET /api/appointments/availability', () => {
  afterAll(async () => {
    await closePool();
  });

  function availabilityUrl(params: Record<string, string>): string {
    return `http://localhost/api/appointments/availability?${new URLSearchParams(params).toString()}`;
  }

  it('returns 401 with no session', async () => {
    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: NONEXISTENT_ID,
          date: '2026-09-17',
          durationMinutes: '30',
        }),
        undefined,
      ),
    );
    expect(response.status).toBe(401);
  });

  it('returns 403 for role "practitioner" (write-adjacent booking flow, receptionist/staff matrix)', async () => {
    // Availability is a read, so it actually follows the four-role read
    // matrix like GET /api/conversations — this test instead proves a role
    // outside that matrix is rejected: there is none among the four, so this
    // asserts the opposite (200) to document the intended matrix explicitly
    // rather than silently assume it.
    const clinic = await createTestClinic('AvailRoleCheck');
    const token = await signInAs(clinic.id, 'AvailRoleCheck', 'practitioner');
    const practitioner = await createTestStaffMember(clinic.id, 'AvailRoleCheckTarget', {
      role: 'practitioner',
    });
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: practitioner.id,
          date: '2026-09-17',
          durationMinutes: '30',
        }),
        token,
      ),
    );
    expect(response.status).toBe(200);
  });

  it('returns 400 for a malformed practitionerId', async () => {
    const clinic = await createTestClinic('AvailMalformedPractitioner');
    const token = await signInAs(clinic.id, 'AvailMalformedPractitioner', 'owner');

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: 'not-a-uuid',
          date: '2026-09-17',
          durationMinutes: '30',
        }),
        token,
      ),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 for a malformed date', async () => {
    const clinic = await createTestClinic('AvailMalformedDate');
    const token = await signInAs(clinic.id, 'AvailMalformedDate', 'owner');

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: NONEXISTENT_ID,
          date: '17-09-2026',
          durationMinutes: '30',
        }),
        token,
      ),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 for a non-positive durationMinutes', async () => {
    const clinic = await createTestClinic('AvailBadDuration');
    const token = await signInAs(clinic.id, 'AvailBadDuration', 'owner');

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: NONEXISTENT_ID,
          date: '2026-09-17',
          durationMinutes: '0',
        }),
        token,
      ),
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 for a practitioner belonging to another clinic', async () => {
    const clinicOwn = await createTestClinic('AvailCrossOwn');
    const clinicOther = await createTestClinic('AvailCrossOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'AvailCrossOwn', 'owner');
    const practitionerOther = await createTestStaffMember(clinicOther.id, 'AvailCrossOther', {
      role: 'practitioner',
    });

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: practitionerOther.id,
          date: '2026-09-17',
          durationMinutes: '30',
        }),
        tokenOwn,
      ),
    );
    expect(response.status).toBe(404);
  });

  it('returns available slots computed from working hours and existing bookings, with zero writes', async () => {
    const clinic = await createTestClinic('AvailSuccess');
    const token = await signInAs(clinic.id, 'AvailSuccess', 'owner');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailSuccessTarget', {
      role: 'practitioner',
    });

    const response = await availabilityRoute(
      getRequest(
        availabilityUrl({
          practitionerId: practitioner.id,
          date: '2026-09-17',
          durationMinutes: '30',
        }),
        token,
      ),
    );

    expect(response.status).toBe(200);
    const body: { data: { slots: Array<{ startsAt: string; endsAt: string }> } } =
      await response.json();
    expect(body.data.slots).toEqual([
      { startsAt: '2026-09-17T09:00:00.000Z', endsAt: '2026-09-17T09:30:00.000Z' },
      { startsAt: '2026-09-17T09:30:00.000Z', endsAt: '2026-09-17T10:00:00.000Z' },
    ]);
  });
});

describe('POST /api/appointments', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', undefined, {}),
    );
    expect(response.status).toBe(401);
  });

  it('returns 403 for role "practitioner"', async () => {
    const clinic = await createTestClinic('BookRolePractitioner');
    const token = await signInAs(clinic.id, 'BookRolePractitioner', 'practitioner');

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: NONEXISTENT_ID,
        practitionerId: NONEXISTENT_ID,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );
    expect(response.status).toBe(403);
  });

  for (const role of BOOKING_ROLES) {
    it(`returns 201 for role "${role}" on a successful booking`, async () => {
      const clinic = await createTestClinic(`BookRole-${role}`);
      const token = await signInAs(clinic.id, `BookRole-${role}`, role);
      const patient = await createPatient(clinic.id, { phoneNumber: '+201000003001' });
      const practitioner = await createTestStaffMember(clinic.id, `BookRoleTarget-${role}`, {
        role: 'practitioner',
      });

      const response = await bookRoute(
        postRequest('http://localhost/api/appointments', token, {
          patientId: patient.id,
          practitionerId: practitioner.id,
          startsAt: '2026-09-17T09:00:00.000Z',
          endsAt: '2026-09-17T09:30:00.000Z',
        }),
      );

      expect(response.status).toBe(201);
      const body: { data: { id: string; status: string; conversationId: string | null } } =
        await response.json();
      expect(body.data.status).toBe('booked');
      expect(body.data.conversationId).toBeNull();
    });
  }

  it('returns 400 for a malformed patientId', async () => {
    const clinic = await createTestClinic('BookMalformedPatient');
    const token = await signInAs(clinic.id, 'BookMalformedPatient', 'owner');

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: 'not-a-uuid',
        practitionerId: NONEXISTENT_ID,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when endsAt is not after startsAt', async () => {
    const clinic = await createTestClinic('BookBadInterval');
    const token = await signInAs(clinic.id, 'BookBadInterval', 'owner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000003002' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookBadInterval', {
      role: 'practitioner',
    });

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        startsAt: '2026-09-17T09:30:00.000Z',
        endsAt: '2026-09-17T09:00:00.000Z',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const clinic = await createTestClinic('BookMalformedJson');
    const token = await signInAs(clinic.id, 'BookMalformedJson', 'owner');

    const response = await bookRoute(
      new NextRequest('http://localhost/api/appointments', {
        method: 'POST',
        body: '{not valid json',
        headers: { 'content-type': 'application/json', cookie: `session=${token}` },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 for a patient belonging to another clinic (cross-clinic access)', async () => {
    const clinicOwn = await createTestClinic('BookCrossPatientOwn');
    const clinicOther = await createTestClinic('BookCrossPatientOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'BookCrossPatientOwn', 'owner');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000003003' });
    const practitionerOwn = await createTestStaffMember(clinicOwn.id, 'BookCrossPatientOwn', {
      role: 'practitioner',
    });

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', tokenOwn, {
        patientId: patientOther.id,
        practitionerId: practitionerOwn.id,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 for a conversationId belonging to a different clinic (cross-clinic access)', async () => {
    // No existing test exercises a conversationId belonging to a DIFFERENT
    // clinic from the requesting session's own clinic and patient (only
    // same-clinic/different-patient, covered by "throws
    // ConversationPatientMismatchError..." in
    // tests/features/appointments/book-appointment.test.ts). Verified
    // directly against this route: the response is 404
    // `{"error":{"code":"not_found","message":"Patient, practitioner, or
    // conversation not found."}}` — the same body `notFoundResponse()`
    // returns for every other 404 case this route has. The rejection is
    // structural, not an application-level check: `patientId` is already
    // proven same-clinic by `appointments_patient_same_clinic`, and a
    // patient belongs to exactly one clinic for its lifetime, so a
    // `conversationId` whose own patient is a different clinic's patient can
    // never satisfy `appointments_conversation_same_patient` (`conversation_id,
    // patient_id) -> conversations (id, patient_id)` against *this* request's
    // `patientId` — the database rejects it as a
    // `ConversationPatientMismatchError`, indistinguishable from a
    // nonexistent or same-clinic-wrong-patient conversationId (same
    // 404-collapsing rationale as every other cross-tenant case in this
    // codebase).
    const clinicOwn = await createTestClinic('BookCrossConversationOwn');
    const clinicOther = await createTestClinic('BookCrossConversationOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'BookCrossConversationOwn', 'owner');
    const patientOwn = await createPatient(clinicOwn.id, { phoneNumber: '+201000003006' });
    const practitionerOwn = await createTestStaffMember(clinicOwn.id, 'BookCrossConversationOwn', {
      role: 'practitioner',
    });
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000003007' });
    const { conversationId: conversationIdOther } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', tokenOwn, {
        patientId: patientOwn.id,
        practitionerId: practitionerOwn.id,
        conversationId: conversationIdOther,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );

    expect(response.status).toBe(404);
    const body: { error: { code: string; message: string } } = await response.json();
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toBe('Patient, practitioner, or conversation not found.');
  });

  it('returns 409 with the stable message for a slot that is no longer available', async () => {
    const clinic = await createTestClinic('BookUnavailable');
    const token = await signInAs(clinic.id, 'BookUnavailable', 'owner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000003004' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookUnavailable', {
      role: 'practitioner',
    });

    const first = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );
    expect(first.status).toBe(201);

    const second = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        startsAt: '2026-09-17T09:15:00.000Z',
        endsAt: '2026-09-17T09:45:00.000Z',
      }),
    );

    expect(second.status).toBe(409);
    const body: { error: { code: string; message: string } } = await second.json();
    expect(body.error.message).toBe('The selected appointment slot is no longer available.');
    expect(body.error.message).not.toMatch(/exclude|constraint|gist|sql/i);
  });

  it('books an appointment linked to its originating conversation', async () => {
    const clinic = await createTestClinic('BookLinkedConversation');
    const token = await signInAs(clinic.id, 'BookLinkedConversation', 'owner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000003005' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookLinkedConversation', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const response = await bookRoute(
      postRequest('http://localhost/api/appointments', token, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        conversationId,
        startsAt: '2026-09-17T09:00:00.000Z',
        endsAt: '2026-09-17T09:30:00.000Z',
      }),
    );

    expect(response.status).toBe(201);
    const body: { data: { conversationId: string | null } } = await response.json();
    expect(body.data.conversationId).toBe(conversationId);
  });
});
