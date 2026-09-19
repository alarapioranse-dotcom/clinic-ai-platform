import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { createKnowledgeDocument } from '@/features/knowledge-base';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import {
  GET as knowledgeDocumentsRoute,
  POST as createKnowledgeDocumentRoute,
} from '@/app/api/knowledge-documents/route';
import {
  GET as knowledgeDocumentDetailRoute,
  PATCH as patchKnowledgeDocumentRoute,
  DELETE as deleteKnowledgeDocumentRoute,
} from '@/app/api/knowledge-documents/[id]/route';

function jsonRequest(url: string, method: string, cookieValue: string | undefined, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(cookieValue ? { cookie: `session=${cookieValue}` } : {}),
    },
  });
}

function getRequest(url: string, cookieValue: string | undefined): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieValue ? { cookie: `session=${cookieValue}` } : {},
  });
}

function deleteRequest(url: string, cookieValue: string | undefined): NextRequest {
  return new NextRequest(url, {
    method: 'DELETE',
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
    jsonRequest('http://localhost/api/auth/sign-in', 'POST', undefined, {
      email: staff.email,
      password: staff.password,
    }),
  );
  const token = signInResponse.cookies.get('session')?.value;
  if (!token) throw new Error('sign-in fixture did not return a session token');
  return token;
}

function detailRequest(id: string, cookieValue: string | undefined) {
  return knowledgeDocumentDetailRoute(
    getRequest(`http://localhost/api/knowledge-documents/${id}`, cookieValue),
    { params: Promise.resolve({ id }) },
  );
}

function patchRequest(id: string, cookieValue: string | undefined, body: unknown) {
  return patchKnowledgeDocumentRoute(
    jsonRequest(`http://localhost/api/knowledge-documents/${id}`, 'PATCH', cookieValue, body),
    { params: Promise.resolve({ id }) },
  );
}

function deleteDocRequest(id: string, cookieValue: string | undefined) {
  return deleteKnowledgeDocumentRoute(
    deleteRequest(`http://localhost/api/knowledge-documents/${id}`, cookieValue),
    { params: Promise.resolve({ id }) },
  );
}

const ALLOWED_ROLES = ['owner', 'admin'] as const;
const DISALLOWED_ROLES = ['practitioner', 'receptionist'] as const;
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * HTTP-boundary coverage of GET /api/knowledge-documents
 * (docs/technical/03-api-contracts.md: owner/admin only — this screen
 * "governs what the assistant is allowed to say," unlike the
 * all-four-roles read paths for conversations/patients/appointments).
 * Mirrors tests/api/patients-routes.test.ts.
 */
describe('GET /api/knowledge-documents', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await knowledgeDocumentsRoute(
      getRequest('http://localhost/api/knowledge-documents', undefined),
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALLOWED_ROLES) {
    it(`returns 200 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KbList-${role}`);
      const token = await signInAs(clinic.id, `KbList-${role}`, role);

      const response = await knowledgeDocumentsRoute(
        getRequest('http://localhost/api/knowledge-documents', token),
      );

      expect(response.status).toBe(200);
      const body: { data: unknown[] } = await response.json();
      expect(Array.isArray(body.data)).toBe(true);
    });
  }

  for (const role of DISALLOWED_ROLES) {
    it(`returns 403 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KbList403-${role}`);
      const token = await signInAs(clinic.id, `KbList403-${role}`, role);

      const response = await knowledgeDocumentsRoute(
        getRequest('http://localhost/api/knowledge-documents', token),
      );

      expect(response.status).toBe(403);
    });
  }

  it('only returns documents belonging to the calling staff member clinic', async () => {
    const clinicOwn = await createTestClinic('KbListScopeOwn');
    const clinicOther = await createTestClinic('KbListScopeOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'KbListScopeOwn', 'owner');
    await createKnowledgeDocument(clinicOther.id, { title: 'other', content: 'other content' });

    const response = await knowledgeDocumentsRoute(
      getRequest('http://localhost/api/knowledge-documents', tokenOwn),
    );
    expect(response.status).toBe(200);
    const body: { data: Array<{ clinicId: string }> } = await response.json();
    for (const document of body.data) {
      expect(document.clinicId).toBe(clinicOwn.id);
    }
  });
});

/**
 * HTTP-boundary coverage of POST /api/knowledge-documents. This slice
 * creates a `title`/`content` entry directly (no multipart upload — see
 * `db/migrations/0013_knowledge_documents.sql`).
 */
describe('POST /api/knowledge-documents', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await createKnowledgeDocumentRoute(
      jsonRequest('http://localhost/api/knowledge-documents', 'POST', undefined, {
        title: 'x',
        content: 'y',
      }),
    );
    expect(response.status).toBe(401);
  });

  for (const role of ALLOWED_ROLES) {
    it(`returns 201 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KbCreate-${role}`);
      const token = await signInAs(clinic.id, `KbCreate-${role}`, role);

      const response = await createKnowledgeDocumentRoute(
        jsonRequest('http://localhost/api/knowledge-documents', 'POST', token, {
          title: 'Synthetic test document',
          content: 'Synthetic test content',
        }),
      );

      expect(response.status).toBe(201);
      const body: { data: { id: string; clinicId: string; title: string } } = await response.json();
      expect(body.data.clinicId).toBe(clinic.id);
      expect(body.data.title).toBe('Synthetic test document');
    });
  }

  for (const role of DISALLOWED_ROLES) {
    it(`returns 403 for role "${role}"`, async () => {
      const clinic = await createTestClinic(`KbCreate403-${role}`);
      const token = await signInAs(clinic.id, `KbCreate403-${role}`, role);

      const response = await createKnowledgeDocumentRoute(
        jsonRequest('http://localhost/api/knowledge-documents', 'POST', token, {
          title: 'x',
          content: 'y',
        }),
      );

      expect(response.status).toBe(403);
    });
  }

  it('returns 400 when title is missing', async () => {
    const clinic = await createTestClinic('KbCreate-missing-title');
    const token = await signInAs(clinic.id, 'KbCreate-missing-title', 'owner');

    const response = await createKnowledgeDocumentRoute(
      jsonRequest('http://localhost/api/knowledge-documents', 'POST', token, { content: 'y' }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const clinic = await createTestClinic('KbCreate-missing-content');
    const token = await signInAs(clinic.id, 'KbCreate-missing-content', 'owner');

    const response = await createKnowledgeDocumentRoute(
      jsonRequest('http://localhost/api/knowledge-documents', 'POST', token, { title: 'x' }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 for a malformed request body', async () => {
    const clinic = await createTestClinic('KbCreate-malformed-body');
    const token = await signInAs(clinic.id, 'KbCreate-malformed-body', 'owner');

    const response = await createKnowledgeDocumentRoute(
      new NextRequest('http://localhost/api/knowledge-documents', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json', cookie: `session=${token}` },
      }),
    );

    expect(response.status).toBe(400);
  });
});

/**
 * HTTP-boundary coverage of GET /api/knowledge-documents/:id.
 */
describe('GET /api/knowledge-documents/:id', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await detailRequest(NONEXISTENT_ID, undefined);
    expect(response.status).toBe(401);
  });

  it('returns 200 with the document for its own clinic', async () => {
    const clinic = await createTestClinic('KbDetail1');
    const token = await signInAs(clinic.id, 'KbDetail1', 'owner');
    const document = await createKnowledgeDocument(clinic.id, { title: 'x', content: 'y' });

    const response = await detailRequest(document.id, token);

    expect(response.status).toBe(200);
    const body: { data: { id: string } } = await response.json();
    expect(body.data.id).toBe(document.id);
  });

  it('returns 403 for role "practitioner"', async () => {
    const clinic = await createTestClinic('KbDetail403');
    const token = await signInAs(clinic.id, 'KbDetail403', 'practitioner');

    const response = await detailRequest(NONEXISTENT_ID, token);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbDetail404');
    const token = await signInAs(clinic.id, 'KbDetail404', 'owner');

    const response = await detailRequest(NONEXISTENT_ID, token);

    expect(response.status).toBe(404);
  });

  it('returns 404 for a malformed ID', async () => {
    const clinic = await createTestClinic('KbDetailMalformed');
    const token = await signInAs(clinic.id, 'KbDetailMalformed', 'owner');

    const response = await detailRequest('not-a-uuid', token);

    expect(response.status).toBe(404);
  });

  it("returns 404 for another clinic's document (not 403)", async () => {
    const clinicOwn = await createTestClinic('KbDetailCrossOwn');
    const clinicOther = await createTestClinic('KbDetailCrossOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'KbDetailCrossOwn', 'owner');
    const other = await createKnowledgeDocument(clinicOther.id, { title: 'x', content: 'y' });

    const response = await detailRequest(other.id, tokenOwn);

    expect(response.status).toBe(404);
  });
});

/**
 * HTTP-boundary coverage of PATCH /api/knowledge-documents/:id — the "edit"
 * half of this slice's create/edit UI.
 */
describe('PATCH /api/knowledge-documents/:id', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await patchRequest(NONEXISTENT_ID, undefined, { title: 'x', content: 'y' });
    expect(response.status).toBe(401);
  });

  it('returns 200 and updates the document', async () => {
    const clinic = await createTestClinic('KbEdit1');
    const token = await signInAs(clinic.id, 'KbEdit1', 'owner');
    const document = await createKnowledgeDocument(clinic.id, {
      title: 'old',
      content: 'old content',
    });

    const response = await patchRequest(document.id, token, {
      title: 'new',
      content: 'new content',
    });

    expect(response.status).toBe(200);
    const body: { data: { title: string; content: string } } = await response.json();
    expect(body.data.title).toBe('new');
    expect(body.data.content).toBe('new content');
  });

  it('returns 403 for role "receptionist"', async () => {
    const clinic = await createTestClinic('KbEdit403');
    const token = await signInAs(clinic.id, 'KbEdit403', 'receptionist');

    const response = await patchRequest(NONEXISTENT_ID, token, { title: 'x', content: 'y' });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbEdit404');
    const token = await signInAs(clinic.id, 'KbEdit404', 'owner');

    const response = await patchRequest(NONEXISTENT_ID, token, { title: 'x', content: 'y' });

    expect(response.status).toBe(404);
  });

  it("returns 404 for another clinic's document", async () => {
    const clinicOwn = await createTestClinic('KbEditCrossOwn');
    const clinicOther = await createTestClinic('KbEditCrossOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'KbEditCrossOwn', 'owner');
    const other = await createKnowledgeDocument(clinicOther.id, {
      title: 'original',
      content: 'original content',
    });

    const response = await patchRequest(other.id, tokenOwn, { title: 'hacked', content: 'hacked' });

    expect(response.status).toBe(404);
    const stillOriginal = await detailRequest(
      other.id,
      await signInAs(clinicOther.id, 'KbEditCrossOtherRead', 'owner'),
    );
    const body: { data: { title: string } } = await stillOriginal.json();
    expect(body.data.title).toBe('original');
  });

  it('returns 400 when title is empty', async () => {
    const clinic = await createTestClinic('KbEditMissingTitle');
    const token = await signInAs(clinic.id, 'KbEditMissingTitle', 'owner');
    const document = await createKnowledgeDocument(clinic.id, { title: 'x', content: 'y' });

    const response = await patchRequest(document.id, token, { title: '', content: 'y' });

    expect(response.status).toBe(400);
  });
});

/**
 * HTTP-boundary coverage of DELETE /api/knowledge-documents/:id.
 */
describe('DELETE /api/knowledge-documents/:id', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 401 with no session', async () => {
    const response = await deleteDocRequest(NONEXISTENT_ID, undefined);
    expect(response.status).toBe(401);
  });

  it('returns 204 and removes the document', async () => {
    const clinic = await createTestClinic('KbDelete1');
    const token = await signInAs(clinic.id, 'KbDelete1', 'owner');
    const document = await createKnowledgeDocument(clinic.id, { title: 'x', content: 'y' });

    const response = await deleteDocRequest(document.id, token);
    expect(response.status).toBe(204);

    const afterDelete = await detailRequest(document.id, token);
    expect(afterDelete.status).toBe(404);
  });

  it('returns 403 for role "practitioner"', async () => {
    const clinic = await createTestClinic('KbDelete403');
    const token = await signInAs(clinic.id, 'KbDelete403', 'practitioner');

    const response = await deleteDocRequest(NONEXISTENT_ID, token);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbDelete404');
    const token = await signInAs(clinic.id, 'KbDelete404', 'owner');

    const response = await deleteDocRequest(NONEXISTENT_ID, token);

    expect(response.status).toBe(404);
  });

  it("returns 404 for another clinic's document and does not delete it", async () => {
    const clinicOwn = await createTestClinic('KbDeleteCrossOwn');
    const clinicOther = await createTestClinic('KbDeleteCrossOther');
    const tokenOwn = await signInAs(clinicOwn.id, 'KbDeleteCrossOwn', 'owner');
    const tokenOther = await signInAs(clinicOther.id, 'KbDeleteCrossOther', 'owner');
    const other = await createKnowledgeDocument(clinicOther.id, { title: 'x', content: 'y' });

    const response = await deleteDocRequest(other.id, tokenOwn);
    expect(response.status).toBe(404);

    const stillThere = await detailRequest(other.id, tokenOther);
    expect(stillThere.status).toBe(200);
  });
});
