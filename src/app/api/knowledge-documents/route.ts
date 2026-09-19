import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  createKnowledgeDocument,
  listKnowledgeDocumentsForClinic,
} from '@/features/knowledge-base';

/**
 * docs/technical/03-api-contracts.md: GET /api/knowledge-documents, owner/
 * admin only — this screen "governs what the assistant is allowed to say,
 * not day-to-day work" (docs/product/06-acceptance-criteria.md), so
 * practitioner/receptionist are excluded, unlike the read paths for
 * conversations/patients/appointments. `clinicId` comes only from the
 * validated session, never a request parameter.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  try {
    requireRole(session, ['owner', 'admin']);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Your role does not permit this action.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  const documents = await listKnowledgeDocumentsForClinic(session.clinicId);
  return NextResponse.json({ data: documents });
}

/**
 * docs/technical/03-api-contracts.md: POST /api/knowledge-documents, owner/
 * admin only. This slice creates a `title`/`content` entry directly (no
 * file upload, no processing pipeline — see
 * `db/migrations/0013_knowledge_documents.sql`), matching the task's
 * create/edit UI rather than the design doc's upload flow. `clinicId` comes
 * only from the validated session, never the request body.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  try {
    requireRole(session, ['owner', 'admin']);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Your role does not permit this action.' } },
        { status: 403 },
      );
    }
    throw err;
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

  const document = await createKnowledgeDocument(session.clinicId, { title, content });
  return NextResponse.json({ data: document }, { status: 201 });
}
