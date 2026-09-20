import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  createKnowledgeDocumentUploadIntent,
  InvalidDeclaredMimeTypeError,
  DeclaredSizeTooLargeError,
} from '@/features/knowledge-base';

function invalidRequest(message: string) {
  return NextResponse.json({ error: { code: 'invalid_request', message } }, { status: 400 });
}

/**
 * roadmap P5 Slice 1B (ADR-0018): POST /api/knowledge-documents — upload
 * initiation, per docs/technical/03-api-contracts.md's Knowledge base
 * table (owner/admin only). Body: `{ filename, mimeType, sizeBytes }` — all
 * three are client-declared values. This endpoint's checks against them
 * (`mimeType` must be `application/pdf`, `sizeBytes` must not exceed
 * `MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES`) are a UX courtesy, rejecting an
 * obviously wrong file before the browser spends time uploading it — they
 * are NOT authoritative enforcement, since nothing stops a client from
 * declaring one thing and uploading another. `docs/technical/06-knowledge-document-storage.md`'s
 * completion-side HeadObject check is what's authoritative.
 *
 * `clinicId` comes only from the validated session, never the request
 * body. No database row is created here: `storage_key` is still `NOT
 * NULL`, and no legitimate row exists until `POST
 * /api/knowledge-documents/:id/complete` verifies the actual uploaded
 * object. A browser that never calls that endpoint leaves an object with
 * no row — the accepted "orphan object" limitation, not a bug this
 * endpoint tries to prevent.
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

  if (typeof body !== 'object' || body === null) {
    return invalidRequest('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;

  const filename = typeof record.filename === 'string' ? record.filename : '';
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
  const sizeBytes = typeof record.sizeBytes === 'number' ? record.sizeBytes : NaN;

  if (!filename.trim()) {
    return invalidRequest('filename is required.');
  }
  if (!mimeType) {
    return invalidRequest('mimeType is required.');
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return invalidRequest('sizeBytes must be a positive integer.');
  }

  try {
    const intent = await createKnowledgeDocumentUploadIntent(session.clinicId, {
      filename,
      mimeType,
      sizeBytes,
    });
    return NextResponse.json({ data: intent }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidDeclaredMimeTypeError || err instanceof DeclaredSizeTooLargeError) {
      return invalidRequest(err.message);
    }
    throw err;
  }
}
