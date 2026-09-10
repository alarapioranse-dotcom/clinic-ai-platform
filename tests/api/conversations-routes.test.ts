import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as conversationsRoute } from '@/app/api/conversations/route';
import { GET as conversationDetailRoute } from '@/app/api/conversations/[id]/route';

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

function detailRequest(id: string, cookieValue: string | undefined) {
  return conversationDetailRoute(
    getRequest(`http://localhost/api/conversations/${id}`, cookieValue),
    { params: Promise.resolve({ id }) },
  );
}

const ALL_ROLES = ['owner', 'admin', 'practitioner', 'receptionist'] as const;

/**
 * HTTP-boundary coverage of GET /api/conversations (roadmap P3-B). Mirrors
 * tests/api/patients-routes.test.ts's GET /api/patients suite exactly — same
 * four-role read matrix (practitioner included, read-only — ADR-0004), same
 * "own clinic only" scoping assertion.
 */
describe('GET /api/conversations', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await conversationsRoute(
      getRequest('http://localhost/api/conversations', undefined),
    );
    expect(response.status).toBe(401);
  });

  it('returns 401 with an invalid session cookie', async () => {
    const response = await conversationsRoute(
      getRequest('http://localhost/api/conversations', 'not-a-real-token'),
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALL_ROLES) {
    it(`returns 200 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`ConvList-${role}`);
      const token = await signInAs(clinic.id, `ConvList-${role}`, role);

      const response = await conversationsRoute(
        getRequest('http://localhost/api/conversations', token),
      );

      expect(response.status).toBe(200);
      const body: { data: unknown[] } = await response.json();
      expect(Array.isArray(body.data)).toBe(true);
    });
  }

  it('only returns conversations belonging to the calling staff member clinic', async () => {
    const clinicOwn = await createTestClinic('ConvListScopeOwn');
    const clinicOther = await createTestClinic('ConvListScopeOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'ConvListScopeOwn', 'owner');

    const patientOwn = await createPatient(clinicOwn.id, { phoneNumber: '+201000000601' });
    const { conversationId: ownConversationId } = await receiveInboundMessage(
      clinicOwn.id,
      patientOwn.id,
      'own clinic message',
    );
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000602' });
    const { conversationId: otherConversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );

    const response = await conversationsRoute(
      getRequest('http://localhost/api/conversations', tokenOwn),
    );
    expect(response.status).toBe(200);
    const body: { data: Array<{ id: string; clinicId: string }> } = await response.json();
    expect(body.data.some((c) => c.id === ownConversationId)).toBe(true);
    expect(body.data.some((c) => c.id === otherConversationId)).toBe(false);
    for (const conversation of body.data) {
      expect(conversation.clinicId).toBe(clinicOwn.id);
    }
  });
});

/**
 * HTTP-boundary coverage of GET /api/conversations/:id (roadmap P3-B). The
 * cross-clinic and nonexistent cases assert the same 404 status and the same
 * generic error body — docs/technical/03-api-contracts.md's "404 vs. 403 for
 * cross-tenant access" rule requires them to stay indistinguishable at this
 * boundary.
 */
describe('GET /api/conversations/:id', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await detailRequest('00000000-0000-0000-0000-000000000000', undefined);
    expect(response.status).toBe(401);
  });

  it('returns 401 with an invalid session cookie', async () => {
    const response = await detailRequest(
      '00000000-0000-0000-0000-000000000000',
      'not-a-real-token',
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALL_ROLES) {
    it(`returns 200 for role "${role}" on the caller's own conversation`, async () => {
      const clinic = await createTestClinic(`ConvDetail-${role}`);
      const token = await signInAs(clinic.id, `ConvDetail-${role}`, role);
      const patient = await createPatient(clinic.id, { phoneNumber: '+201000000603' });
      const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

      const response = await detailRequest(conversationId, token);

      expect(response.status).toBe(200);
      const body: { data: { conversation: { id: string }; messages: unknown[] } } =
        await response.json();
      expect(body.data.conversation.id).toBe(conversationId);
      expect(Array.isArray(body.data.messages)).toBe(true);
    });
  }

  it('returns the conversation plus messages for the own-clinic case', async () => {
    const clinic = await createTestClinic('ConvDetailOwn');
    const token = await signInAs(clinic.id, 'ConvDetailOwn', 'owner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000604' });
    const { conversationId, messageId } = await receiveInboundMessage(
      clinic.id,
      patient.id,
      'hello there',
    );

    const response = await detailRequest(conversationId, token);
    expect(response.status).toBe(200);
    const body: { data: { conversation: { id: string }; messages: Array<{ id: string }> } } =
      await response.json();
    expect(body.data.conversation.id).toBe(conversationId);
    expect(body.data.messages.map((m) => m.id)).toContain(messageId);
  });

  it('returns 404 for a valid UUID belonging to another clinic', async () => {
    const clinicOwn = await createTestClinic('ConvDetailCrossOwn');
    const clinicOther = await createTestClinic('ConvDetailCrossOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'ConvDetailCrossOwn', 'owner');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000605' });
    const { conversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );

    const response = await detailRequest(conversationId, tokenOwn);

    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent (but valid-format) UUID', async () => {
    const clinic = await createTestClinic('ConvDetailNonexistent');
    const token = await signInAs(clinic.id, 'ConvDetailNonexistent', 'owner');

    const response = await detailRequest('00000000-0000-0000-0000-000000000000', token);

    expect(response.status).toBe(404);
  });

  it('returns 404 for a malformed (non-UUID) ID', async () => {
    const clinic = await createTestClinic('ConvDetailMalformed');
    const token = await signInAs(clinic.id, 'ConvDetailMalformed', 'owner');

    const response = await detailRequest('not-a-uuid', token);

    expect(response.status).toBe(404);
  });

  it('nonexistent and cross-clinic cases return the same response shape', async () => {
    const clinicOwn = await createTestClinic('ConvDetailShapeOwn');
    const clinicOther = await createTestClinic('ConvDetailShapeOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'ConvDetailShapeOwn', 'owner');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000606' });
    const { conversationId: otherConversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );

    const crossClinicResponse = await detailRequest(otherConversationId, tokenOwn);
    const nonexistentResponse = await detailRequest(
      '00000000-0000-0000-0000-000000000000',
      tokenOwn,
    );
    const malformedResponse = await detailRequest('not-a-uuid', tokenOwn);

    expect(crossClinicResponse.status).toBe(404);
    expect(nonexistentResponse.status).toBe(404);
    expect(malformedResponse.status).toBe(404);

    const [crossBody, nonexistentBody, malformedBody] = await Promise.all([
      crossClinicResponse.json(),
      nonexistentResponse.json(),
      malformedResponse.json(),
    ]);
    expect(crossBody).toEqual(nonexistentBody);
    expect(crossBody).toEqual(malformedBody);
  });
});
