import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { POST as initiateRoute } from '@/app/api/knowledge-documents/route';
import { POST as completeRoute } from '@/app/api/knowledge-documents/[id]/complete/route';

/**
 * HTTP-boundary coverage for roadmap P5 Slice 1B (ADR-0018): POST
 * /api/knowledge-documents (upload initiation) and POST
 * /api/knowledge-documents/:id/complete (upload completion). Mirrors
 * tests/api/appointments-routes.test.ts's conventions for the session/role
 * checks and the 404-vs-403/malformed-id cross-tenant rules.
 *
 * Storage is mocked for the whole file — these are HTTP/role/validation
 * tests, not Scaleway integration tests. `createPresignedUploadUrl` is
 * mocked to a fixed string (initiation never fails on it here);
 * `headObject`'s mock return value drives each completion scenario.
 */
const { headObjectMock, createPresignedUploadUrlMock } = vi.hoisted(() => ({
  headObjectMock: vi.fn(),
  createPresignedUploadUrlMock: vi.fn(),
}));
vi.mock('@/features/knowledge-base/storage', () => ({
  headObject: headObjectMock,
  createPresignedUploadUrl: createPresignedUploadUrlMock,
}));

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
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

function initiate(cookieValue: string | undefined, body: unknown) {
  return initiateRoute(postRequest('http://localhost/api/knowledge-documents', cookieValue, body));
}

function complete(id: string, cookieValue: string | undefined, body: unknown) {
  return completeRoute(
    postRequest(`http://localhost/api/knowledge-documents/${id}/complete`, cookieValue, body),
    { params: Promise.resolve({ id }) },
  );
}

const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';
const KNOWLEDGE_BASE_ROLES = ['owner', 'admin'] as const;
const OTHER_ROLES = ['practitioner', 'receptionist'] as const;

describe('POST /api/knowledge-documents (initiation)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await initiate(undefined, {
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(response.status).toBe(401);
  });

  for (const role of OTHER_ROLES) {
    it(`returns 403 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KdocInitRole-${role}`);
      const token = await signInAs(clinic.id, `KdocInitRole-${role}`, role);

      const response = await initiate(token, {
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
      expect(response.status).toBe(403);
    });
  }

  for (const role of KNOWLEDGE_BASE_ROLES) {
    it(`returns 201 with a documentId and uploadUrl for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KdocInitOk-${role}`);
      const token = await signInAs(clinic.id, `KdocInitOk-${role}`, role);
      createPresignedUploadUrlMock.mockResolvedValueOnce('https://example.test/presigned-put');

      const response = await initiate(token, {
        filename: 'hours.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(response.status).toBe(201);
      const body: { data: { documentId: string; uploadUrl: string; expiresAt: string } } =
        await response.json();
      expect(body.data.documentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(body.data.uploadUrl).toBe('https://example.test/presigned-put');
      expect(createPresignedUploadUrlMock).toHaveBeenCalledWith(
        `${clinic.id}/${body.data.documentId}`,
        'application/pdf',
        expect.any(Number),
      );
    });
  }

  it('returns 400 for a missing filename', async () => {
    const clinic = await createTestClinic('KdocInitNoFilename');
    const token = await signInAs(clinic.id, 'KdocInitNoFilename', 'owner');

    const response = await initiate(token, { mimeType: 'application/pdf', sizeBytes: 1024 });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a non-PDF declared mimeType', async () => {
    const clinic = await createTestClinic('KdocInitBadMime');
    const token = await signInAs(clinic.id, 'KdocInitBadMime', 'owner');

    const response = await initiate(token, {
      filename: 'a.docx',
      mimeType: 'application/msword',
      sizeBytes: 1024,
    });
    expect(response.status).toBe(400);
    const body: { error: { code: string } } = await response.json();
    expect(body.error.code).toBe('invalid_request');
  });

  it('returns 400 for a declared sizeBytes over 10485760', async () => {
    const clinic = await createTestClinic('KdocInitTooBig');
    const token = await signInAs(clinic.id, 'KdocInitTooBig', 'owner');

    const response = await initiate(token, {
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10485761,
    });
    expect(response.status).toBe(400);
  });

  it('accepts a declared sizeBytes of exactly 10485760', async () => {
    const clinic = await createTestClinic('KdocInitExactLimit');
    const token = await signInAs(clinic.id, 'KdocInitExactLimit', 'owner');
    createPresignedUploadUrlMock.mockResolvedValueOnce('https://example.test/presigned-put');

    const response = await initiate(token, {
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10485760,
    });
    expect(response.status).toBe(201);
  });

  it('returns 400 for malformed JSON', async () => {
    const clinic = await createTestClinic('KdocInitMalformedJson');
    const token = await signInAs(clinic.id, 'KdocInitMalformedJson', 'owner');

    const response = await initiateRoute(
      new NextRequest('http://localhost/api/knowledge-documents', {
        method: 'POST',
        body: '{not valid json',
        headers: { 'content-type': 'application/json', cookie: `session=${token}` },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('derives clinicId from the session, not the request body', async () => {
    const clinic = await createTestClinic('KdocInitClinicFromSession');
    const other = await createTestClinic('KdocInitClinicFromSessionOther');
    const token = await signInAs(clinic.id, 'KdocInitClinicFromSession', 'owner');
    createPresignedUploadUrlMock.mockResolvedValueOnce('https://example.test/presigned-put');

    const response = await initiate(token, {
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      clinicId: other.id, // ignored — not part of the documented contract
    });

    expect(response.status).toBe(201);
    const body: { data: { documentId: string } } = await response.json();
    expect(createPresignedUploadUrlMock).toHaveBeenCalledWith(
      `${clinic.id}/${body.data.documentId}`,
      'application/pdf',
      expect.any(Number),
    );
  });
});

describe('POST /api/knowledge-documents/:id/complete (completion)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await complete(NONEXISTENT_ID, undefined, { filename: 'a.pdf' });
    expect(response.status).toBe(401);
  });

  for (const role of OTHER_ROLES) {
    it(`returns 403 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KdocCompleteRole-${role}`);
      const token = await signInAs(clinic.id, `KdocCompleteRole-${role}`, role);

      const response = await complete(NONEXISTENT_ID, token, { filename: 'a.pdf' });
      expect(response.status).toBe(403);
    });
  }

  it('returns 404 for a malformed document id', async () => {
    const clinic = await createTestClinic('KdocCompleteMalformedId');
    const token = await signInAs(clinic.id, 'KdocCompleteMalformedId', 'owner');

    const response = await complete('not-a-uuid', token, { filename: 'a.pdf' });
    expect(response.status).toBe(404);
  });

  it('returns 400 for a missing filename', async () => {
    const clinic = await createTestClinic('KdocCompleteNoFilename');
    const token = await signInAs(clinic.id, 'KdocCompleteNoFilename', 'owner');

    const response = await complete(randomUUID(), token, {});
    expect(response.status).toBe(400);
  });

  it('returns 404 when no object exists at the derived storage key (upload never completed)', async () => {
    const clinic = await createTestClinic('KdocCompleteMissingObject');
    const token = await signInAs(clinic.id, 'KdocCompleteMissingObject', 'owner');
    headObjectMock.mockResolvedValueOnce(null);

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(404);
    const body: { error: { code: string } } = await response.json();
    expect(body.error.code).toBe('not_found');
  });

  it("returns 404 for another clinic's document id (cross-clinic access derives a key nothing was uploaded to)", async () => {
    // No object exists under thisClinic.id/documentId even though the id
    // itself is a real document belonging to a different clinic — proving
    // the storage key re-derivation, not a lookup on the id alone, is what
    // enforces isolation here.
    const clinicOwn = await createTestClinic('KdocCompleteCrossOwn');
    const tokenOwn = await signInAs(clinicOwn.id, 'KdocCompleteCrossOwn', 'owner');
    headObjectMock.mockResolvedValueOnce(null);

    const response = await complete(randomUUID(), tokenOwn, { filename: 'a.pdf' });

    expect(response.status).toBe(404);
  });

  it('returns 422 when the actual object exceeds 10485760 bytes', async () => {
    const clinic = await createTestClinic('KdocCompleteTooLarge');
    const token = await signInAs(clinic.id, 'KdocCompleteTooLarge', 'owner');
    headObjectMock.mockResolvedValueOnce({
      contentLength: 10485761,
      contentType: 'application/pdf',
    });

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
  });

  it('returns 422 when the actual stored Content-Type is not application/pdf', async () => {
    const clinic = await createTestClinic('KdocCompleteBadContentType');
    const token = await signInAs(clinic.id, 'KdocCompleteBadContentType', 'owner');
    headObjectMock.mockResolvedValueOnce({ contentLength: 1024, contentType: 'image/png' });

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
  });

  it('returns 201 and persists the document on a successful completion', async () => {
    const clinic = await createTestClinic('KdocCompleteSuccess');
    const token = await signInAs(clinic.id, 'KdocCompleteSuccess', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({ contentLength: 2048, contentType: 'application/pdf' });

    const response = await complete(documentId, token, { filename: 'opening-hours.pdf' });

    expect(response.status).toBe(201);
    const body: {
      data: { id: string; filename: string; status: string; sizeBytes: number };
    } = await response.json();
    expect(body.data).toMatchObject({
      id: documentId,
      filename: 'opening-hours.pdf',
      status: 'processing',
      sizeBytes: 2048,
    });
  });

  it('returns 409 on a retried completion for an already-completed document', async () => {
    const clinic = await createTestClinic('KdocCompleteRetry');
    const token = await signInAs(clinic.id, 'KdocCompleteRetry', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValue({ contentLength: 2048, contentType: 'application/pdf' });

    const first = await complete(documentId, token, { filename: 'a.pdf' });
    expect(first.status).toBe(201);

    const second = await complete(documentId, token, { filename: 'a.pdf' });

    expect(second.status).toBe(409);
    const body: { error: { code: string } } = await second.json();
    expect(body.error.code).toBe('conflict');
  });
});
