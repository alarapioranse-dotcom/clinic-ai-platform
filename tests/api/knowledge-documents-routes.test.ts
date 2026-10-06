import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closePool, withTenantContext } from '@/lib/db';
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
 * `headObject`'s and `readObjectPrefix`'s mock return values drive each
 * completion scenario (ADR-0021: the signature check reads a bounded prefix
 * of the stored object).
 */
const { headObjectMock, readObjectPrefixMock, createPresignedUploadUrlMock } = vi.hoisted(() => ({
  headObjectMock: vi.fn(),
  readObjectPrefixMock: vi.fn(),
  createPresignedUploadUrlMock: vi.fn(),
}));
vi.mock('@/features/knowledge-base/storage', () => ({
  headObject: headObjectMock,
  readObjectPrefix: readObjectPrefixMock,
  createPresignedUploadUrl: createPresignedUploadUrlMock,
}));

const ETAG = '"9b2cf535f27731c974343645a3985328"';

function pdfPrefix(version = '1.7'): { outcome: 'ok'; bytes: Uint8Array } {
  return {
    outcome: 'ok',
    bytes: Uint8Array.from(Buffer.from(`%PDF-${version}\n%\xe2\xe3\xcf\xd3`, 'latin1')),
  };
}

function prefixOf(...values: number[]): { outcome: 'ok'; bytes: Uint8Array } {
  return { outcome: 'ok', bytes: Uint8Array.from(values) };
}

async function countDocuments(clinicId: string, documentId: string): Promise<number> {
  return withTenantContext(clinicId, async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM knowledge_documents WHERE id = $1',
      [documentId],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

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

  it('never calls headObject or readObjectPrefix at initiation (no object bytes are read before completion)', async () => {
    const clinic = await createTestClinic('KdocInitNoPrefixRead');
    const token = await signInAs(clinic.id, 'KdocInitNoPrefixRead', 'owner');
    headObjectMock.mockClear();
    readObjectPrefixMock.mockClear();
    createPresignedUploadUrlMock.mockResolvedValueOnce('https://example.test/presigned-put');

    const response = await initiate(token, {
      filename: 'hours.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(response.status).toBe(201);
    expect(headObjectMock).not.toHaveBeenCalled();
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/knowledge-documents/:id/complete (completion)', () => {
  beforeEach(() => {
    headObjectMock.mockReset();
    readObjectPrefixMock.mockReset();
  });

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

  it('returns 422 when the actual object exceeds 10485760 bytes, without reading any bytes', async () => {
    const clinic = await createTestClinic('KdocCompleteTooLarge');
    const token = await signInAs(clinic.id, 'KdocCompleteTooLarge', 'owner');
    headObjectMock.mockResolvedValueOnce({
      contentLength: 10485761,
      contentType: 'application/pdf',
      etag: ETAG,
    });

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
  });

  it('returns 422 when the actual stored Content-Type is not application/pdf, without reading any bytes', async () => {
    const clinic = await createTestClinic('KdocCompleteBadContentType');
    const token = await signInAs(clinic.id, 'KdocCompleteBadContentType', 'owner');
    headObjectMock.mockResolvedValueOnce({
      contentLength: 1024,
      contentType: 'image/png',
      etag: ETAG,
    });

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
  });

  it('returns 422 for a zero-byte object, without reading any bytes and without inserting a row', async () => {
    const clinic = await createTestClinic('KdocCompleteZeroByte');
    const token = await signInAs(clinic.id, 'KdocCompleteZeroByte', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 0,
      contentType: 'application/pdf',
      etag: ETAG,
    });

    const response = await complete(documentId, token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
    expect(await countDocuments(clinic.id, documentId)).toBe(0);
  });

  it('returns 422 for an object shorter than the 8-byte shortest PDF header, without reading any bytes', async () => {
    const clinic = await createTestClinic('KdocCompleteTooShort');
    const token = await signInAs(clinic.id, 'KdocCompleteTooShort', 'owner');
    headObjectMock.mockResolvedValueOnce({
      contentLength: 7,
      contentType: 'application/pdf',
      etag: ETAG,
    });

    const response = await complete(randomUUID(), token, { filename: 'a.pdf' });

    expect(response.status).toBe(422);
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
  });

  it('fails closed with a generic 500 when HeadObject returns no ETag: no read without If-Match, no row', async () => {
    const clinic = await createTestClinic('KdocCompleteNoEtag');
    const token = await signInAs(clinic.id, 'KdocCompleteNoEtag', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: undefined,
    });

    let status: number | undefined;
    let thrown: unknown;
    try {
      status = (await complete(documentId, token, { filename: 'a.pdf' })).status;
    } catch (err) {
      thrown = err;
    }

    // The route maps only its documented typed errors; an integrity error is
    // left to Next.js' generic 500 handling, i.e. it propagates out of the
    // handler (no sensitive detail is turned into a client response here).
    expect(status).toBeUndefined();
    expect((thrown as Error).name).toBe('ObjectStorageIntegrityError');
    expect(readObjectPrefixMock).not.toHaveBeenCalled();
    expect(await countDocuments(clinic.id, documentId)).toBe(0);
  });

  it('reads the prefix once, with the storage key and HeadObject ETag, after HeadObject and before the insert', async () => {
    const clinic = await createTestClinic('KdocCompletePrefixCall');
    const token = await signInAs(clinic.id, 'KdocCompletePrefixCall', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockImplementationOnce(async () => {
      // The row must not exist yet at the moment the prefix is read.
      expect(await countDocuments(clinic.id, documentId)).toBe(0);
      return pdfPrefix();
    });

    const response = await complete(documentId, token, { filename: 'a.pdf' });

    expect(response.status).toBe(201);
    expect(readObjectPrefixMock).toHaveBeenCalledTimes(1);
    expect(readObjectPrefixMock).toHaveBeenCalledWith(`${clinic.id}/${documentId}`, ETAG);
    // `?? Infinity` / `?? -Infinity`: an uncalled mock can never satisfy the ordering.
    expect(headObjectMock.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      readObjectPrefixMock.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it('returns 404 and inserts no row when the object vanished between HeadObject and the prefix read', async () => {
    const clinic = await createTestClinic('KdocCompleteVanished');
    const token = await signInAs(clinic.id, 'KdocCompleteVanished', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockResolvedValueOnce({ outcome: 'not_found' });

    const response = await complete(documentId, token, { filename: 'a.pdf' });

    expect(response.status).toBe(404);
    const body: { error: { code: string } } = await response.json();
    expect(body.error.code).toBe('not_found');
    expect(await countDocuments(clinic.id, documentId)).toBe(0);
  });

  it('returns 409 with code object_changed (not conflict) and inserts no row when If-Match fails', async () => {
    const clinic = await createTestClinic('KdocCompleteChanged');
    const token = await signInAs(clinic.id, 'KdocCompleteChanged', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockResolvedValueOnce({ outcome: 'changed' });

    const response = await complete(documentId, token, { filename: 'a.pdf' });

    expect(response.status).toBe(409);
    const body: { error: { code: string } } = await response.json();
    expect(body.error.code).toBe('object_changed');
    expect(body.error.code).not.toBe('conflict');
    expect(await countDocuments(clinic.id, documentId)).toBe(0);
  });

  it('does not swallow an unknown storage error from the prefix read, and inserts no row', async () => {
    const clinic = await createTestClinic('KdocCompleteStorageError');
    const token = await signInAs(clinic.id, 'KdocCompleteStorageError', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockRejectedValueOnce(new Error('connection reset'));

    await expect(complete(documentId, token, { filename: 'a.pdf' })).rejects.toThrow(
      'connection reset',
    );
    expect(await countDocuments(clinic.id, documentId)).toBe(0);
  });

  const NOT_A_PDF: Array<[string, ReturnType<typeof prefixOf>]> = [
    ['PNG', prefixOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)],
    ['ZIP', prefixOf(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00)],
    [
      'HTML',
      { outcome: 'ok', bytes: Uint8Array.from(Buffer.from('<!DOCTYPE html><html>', 'latin1')) },
    ],
    ['random bytes', prefixOf(0x9f, 0x01, 0xc3, 0x7e, 0x55, 0xaa, 0x10, 0x80, 0xfe, 0x00)],
    ['unsupported version 1.8', pdfPrefix('1.8')],
    ['unsupported version 3.0', pdfPrefix('3.0')],
    ['version X.Y', pdfPrefix('X.Y')],
    ['extra version digit 1.77', pdfPrefix('1.77')],
    ['extra version digit 1.10', pdfPrefix('1.10')],
    ['a letter after the version (%PDF-1.7x)', pdfPrefix('1.7x')],
    ['a dotted sub-version (%PDF-1.7.1)', pdfPrefix('1.7.1')],
    ['a dash suffix (%PDF-1.7-beta)', pdfPrefix('1.7-beta')],
    ['a space after the version', pdfPrefix('1.7 ')],
    ['a tab after the version', pdfPrefix('1.7\t')],
    ['a NUL byte after the version', pdfPrefix('1.7\0')],
    [
      'lower-case %pdf-',
      { outcome: 'ok', bytes: Uint8Array.from(Buffer.from('%pdf-1.7\n', 'latin1')) },
    ],
    [
      'a UTF-8 BOM before the signature',
      prefixOf(0xef, 0xbb, 0xbf, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37),
    ],
    [
      'whitespace before the signature',
      { outcome: 'ok', bytes: Uint8Array.from(Buffer.from(' %PDF-1.7\n', 'latin1')) },
    ],
    [
      'the signature at a non-zero offset',
      { outcome: 'ok', bytes: Uint8Array.from(Buffer.from('xx%PDF-1.7\n', 'latin1')) },
    ],
  ];

  for (const [label, prefix] of NOT_A_PDF) {
    it(`returns 422 and inserts no row for an object that is not a valid PDF by signature: ${label}`, async () => {
      const clinic = await createTestClinic(`KdocCompleteNotPdf-${label}`);
      const token = await signInAs(clinic.id, `KdocCompleteNotPdf-${label}`, 'owner');
      const documentId = randomUUID();
      headObjectMock.mockResolvedValueOnce({
        contentLength: 2048,
        contentType: 'application/pdf',
        etag: ETAG,
      });
      readObjectPrefixMock.mockResolvedValueOnce(prefix);

      const response = await complete(documentId, token, { filename: 'a.pdf' });

      expect(response.status).toBe(422);
      const text = await response.text();
      expect(text).not.toContain('%PDF');
      expect(await countDocuments(clinic.id, documentId)).toBe(0);
    });
  }

  for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
    it(`returns 201 and persists the row for a valid PDF header %PDF-${version}`, async () => {
      const clinic = await createTestClinic(`KdocCompleteVersion-${version}`);
      const token = await signInAs(clinic.id, `KdocCompleteVersion-${version}`, 'owner');
      const documentId = randomUUID();
      headObjectMock.mockResolvedValueOnce({
        contentLength: 2048,
        contentType: 'application/pdf',
        etag: ETAG,
      });
      readObjectPrefixMock.mockResolvedValueOnce(pdfPrefix(version));

      const response = await complete(documentId, token, { filename: 'a.pdf' });

      expect(response.status).toBe(201);
      expect(await countDocuments(clinic.id, documentId)).toBe(1);
    });
  }

  it('returns 201 and persists the document on a successful completion', async () => {
    const clinic = await createTestClinic('KdocCompleteSuccess');
    const token = await signInAs(clinic.id, 'KdocCompleteSuccess', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockResolvedValueOnce(pdfPrefix());

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

  it('returns 409 with code conflict on a retried completion for an already-completed document', async () => {
    const clinic = await createTestClinic('KdocCompleteRetry');
    const token = await signInAs(clinic.id, 'KdocCompleteRetry', 'owner');
    const documentId = randomUUID();
    headObjectMock.mockResolvedValue({
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: ETAG,
    });
    readObjectPrefixMock.mockResolvedValue(pdfPrefix());

    const first = await complete(documentId, token, { filename: 'a.pdf' });
    expect(first.status).toBe(201);

    const second = await complete(documentId, token, { filename: 'a.pdf' });

    expect(second.status).toBe(409);
    const body: { error: { code: string } } = await second.json();
    expect(body.error.code).toBe('conflict');
  });
});
