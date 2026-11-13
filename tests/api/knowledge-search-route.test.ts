import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseError } from 'pg';
import { NextRequest } from 'next/server';
import { closePool, withTenantContext } from '@/lib/db';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import * as searchRouteModule from '@/app/api/knowledge-search/route';

/**
 * ADR-0030: POST /api/knowledge-search at the HTTP boundary. The search
 * itself is covered against PostgreSQL in tests/db/knowledge-search.test.ts;
 * here: session, roles, body validation, the no-terms and timeout responses,
 * the session-derived clinic, no GET handler, and that the query never
 * reaches a log line or an error body. Synthetic text only.
 */
const { searchSpy } = vi.hoisted(() => ({ searchSpy: vi.fn() }));
vi.mock('@/features/knowledge-base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/knowledge-base')>();
  searchSpy.mockImplementation(actual.searchKnowledgeBase);
  return { ...actual, searchKnowledgeBase: searchSpy };
});

const POST = searchRouteModule.POST;
const URL_ = 'http://localhost/api/knowledge-search';

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function searchRequest(cookie: string | undefined, rawBody: string): NextRequest {
  return new NextRequest(URL_, {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie: `session=${cookie}` } : {}),
    },
  });
}

async function signInAs(
  clinicId: string,
  label: string,
  role: 'owner' | 'admin' | 'practitioner' | 'receptionist',
): Promise<string> {
  const staff = await createTestStaffMember(clinicId, label, { role });
  const response = await signInRoute(
    jsonRequest('http://localhost/api/auth/sign-in', {
      email: staff.email,
      password: staff.password,
    }),
  );
  const token = response.cookies.get('session')?.value;
  if (!token) throw new Error('sign-in fixture did not return a session token');
  return token;
}

async function readyDocument(clinicId: string, label: string, text: string): Promise<string> {
  const staff = await createTestStaffMember(clinicId, label, { role: 'owner' });
  const document = await createTestKnowledgeDocument(clinicId, staff.id);
  await withTenantContext(clinicId, (client) =>
    client.query('SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[])', [
      document.id,
      'test',
      'test',
      text,
      [text],
    ]),
  );
  return document.id;
}

describe('POST /api/knowledge-search (ADR-0030)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closePool();
  });

  it('has no GET handler, so the query can never travel in a URL', () => {
    expect(Object.keys(searchRouteModule)).toEqual(['POST']);
  });

  it('returns 401 with no session', async () => {
    const response = await POST(searchRequest(undefined, JSON.stringify({ query: 'hours' })));
    expect(response.status).toBe(401);
  });

  for (const role of ['owner', 'admin', 'practitioner', 'receptionist'] as const) {
    it(`returns results for role "${role}"`, async () => {
      const clinic = await createTestClinic(`SearchRoute ${role}`);
      const documentId = await readyDocument(
        clinic.id,
        `SearchRouteUploader ${role}`,
        'Fillings take thirty minutes.',
      );
      const token = await signInAs(clinic.id, `SearchRoute ${role}`, role);

      const response = await POST(searchRequest(token, JSON.stringify({ query: 'fillings' })));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        data: {
          outcome: 'results',
          results: [
            {
              documentId,
              filename: expect.any(String),
              ordinal: 0,
              content: 'Fillings take thirty minutes.',
            },
          ],
        },
      });
    });
  }

  it('derives the clinic from the session, never from the body', async () => {
    const mine = await createTestClinic('SearchRouteMine');
    const other = await createTestClinic('SearchRouteOther');
    await readyDocument(other.id, 'SearchRouteOtherUploader', 'Root canal treatment.');
    const token = await signInAs(mine.id, 'SearchRouteMineReceptionist', 'receptionist');

    const response = await POST(
      searchRequest(token, JSON.stringify({ query: 'root canal', clinicId: other.id })),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ outcome: 'results', results: [] });
    expect(searchSpy).toHaveBeenLastCalledWith(mine.id, 'root canal');
  });

  it('returns no_terms with an empty list for a query with no search term', async () => {
    const clinic = await createTestClinic('SearchRouteNoTerms');
    const token = await signInAs(clinic.id, 'SearchRouteNoTermsStaff', 'receptionist');
    const response = await POST(searchRequest(token, JSON.stringify({ query: '!!! ??' })));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ outcome: 'no_terms', results: [] });
  });

  it('returns 400 with a fixed message for every invalid body, never echoing the query', async () => {
    const clinic = await createTestClinic('SearchRouteInvalid');
    const token = await signInAs(clinic.id, 'SearchRouteInvalidStaff', 'admin');
    const longQuery = 'Synthetic patient sentence. '.repeat(10);
    const bodies = [
      '{not json',
      'null',
      '[]',
      '"text"',
      JSON.stringify({}),
      JSON.stringify({ query: 42 }),
      JSON.stringify({ query: '' }),
      JSON.stringify({ query: '   ' }),
      JSON.stringify({ query: longQuery }),
    ];
    for (const raw of bodies) {
      const response = await POST(searchRequest(token, raw));
      expect(response.status, raw).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text).error.code, raw).toBe('invalid_request');
      expect(text, raw).not.toContain('Synthetic');
    }
  });

  it('returns 503 search_timeout when the search hits its statement timeout', async () => {
    const clinic = await createTestClinic('SearchRouteTimeout');
    const token = await signInAs(clinic.id, 'SearchRouteTimeoutStaff', 'receptionist');
    const canceled = new DatabaseError('canceling statement due to statement timeout', 0, 'error');
    canceled.code = '57014';
    searchSpy.mockRejectedValueOnce(canceled);

    const response = await POST(searchRequest(token, JSON.stringify({ query: 'braces' })));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('search_timeout');
  });

  it('never writes the query to a log line', async () => {
    const clinic = await createTestClinic('SearchRouteLogs');
    await readyDocument(clinic.id, 'SearchRouteLogsUploader', 'Emergency appointments daily.');
    const token = await signInAs(clinic.id, 'SearchRouteLogsStaff', 'receptionist');
    const secret = 'SyntheticPatientMarker emergency';
    const lines: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args);
      });
    }

    const ok = await POST(searchRequest(token, JSON.stringify({ query: secret })));
    expect(ok.status).toBe(200);
    const tooLong = await POST(
      searchRequest(token, JSON.stringify({ query: `${secret} ${'x'.repeat(200)}` })),
    );
    expect(tooLong.status).toBe(400);

    for (const args of lines) {
      expect(args.map(String).join(' ')).not.toContain('SyntheticPatientMarker');
    }
  });
});
