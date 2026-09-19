import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  getKnowledgeDocumentForClinic,
  editKnowledgeDocument,
  removeKnowledgeDocument,
  KnowledgeDocumentNotFoundError,
} from '@/features/knowledge-base';

/**
 * Same pattern as `src/app/api/conversations/[id]/route.ts`'s
 * `UUID_PATTERN` — validated here, at the HTTP boundary, so a malformed ID
 * never reaches the feature layer and instead returns the same 404 shape as
 * a nonexistent or cross-clinic one (docs/technical/03-api-contracts.md's
 * 404-vs-403 rule).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFoundResponse() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Knowledge document not found.' } },
    { status: 404 },
  );
}

async function authorize(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return {
      session: null,
      response: NextResponse.json(
        { error: { code: 'unauthorized', message: 'No valid session.' } },
        { status: 401 },
      ),
    };
  }

  try {
    requireRole(session, ['owner', 'admin']);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return {
        session: null,
        response: NextResponse.json(
          { error: { code: 'forbidden', message: 'Your role does not permit this action.' } },
          { status: 403 },
        ),
      };
    }
    throw err;
  }

  return { session, response: null };
}

/**
 * docs/technical/03-api-contracts.md: GET /api/knowledge-documents/:id,
 * owner/admin only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await authorize(request);
  if (!session) return response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return notFoundResponse();
  }

  const document = await getKnowledgeDocumentForClinic(session.clinicId, id);
  if (!document) {
    return notFoundResponse();
  }

  return NextResponse.json({ data: document });
}

/**
 * PATCH /api/knowledge-documents/:id — the "edit" half of this slice's
 * create/edit UI (task-specified; not part of the design-only file-upload
 * API contract, which never edits a document in place — see
 * `db/migrations/0013_knowledge_documents.sql`). Same owner/admin
 * restriction as every other endpoint on this resource.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await authorize(request);
  if (!session) return response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return notFoundResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const title =
    typeof body === 'object' && body !== null && 'title' in body && typeof body.title === 'string'
      ? body.title
      : '';
  const content =
    typeof body === 'object' &&
    body !== null &&
    'content' in body &&
    typeof body.content === 'string'
      ? body.content
      : '';

  if (!title.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'title is required.' } },
      { status: 400 },
    );
  }
  if (!content.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'content is required.' } },
      { status: 400 },
    );
  }

  try {
    const document = await editKnowledgeDocument(session.clinicId, id, { title, content });
    return NextResponse.json({ data: document });
  } catch (err) {
    if (err instanceof KnowledgeDocumentNotFoundError) {
      return notFoundResponse();
    }
    throw err;
  }
}

/**
 * docs/technical/03-api-contracts.md: DELETE /api/knowledge-documents/:id,
 * owner/admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await authorize(request);
  if (!session) return response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return notFoundResponse();
  }

  try {
    await removeKnowledgeDocument(session.clinicId, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof KnowledgeDocumentNotFoundError) {
      return notFoundResponse();
    }
    throw err;
  }
}
