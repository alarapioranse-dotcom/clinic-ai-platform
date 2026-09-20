import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  completeKnowledgeDocumentUpload,
  UploadObjectMissingError,
  UploadObjectTooLargeError,
  UploadObjectContentTypeMismatchError,
  DuplicateKnowledgeDocumentError,
} from '@/features/knowledge-base';

/**
 * Same pattern as `src/app/api/conversations/[id]/messages/route.ts`'s
 * `UUID_PATTERN` — a malformed id is treated identically to a missing one
 * below, never distinguished at this boundary.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function missingObjectResponse() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'No uploaded object was found for this document.' } },
    { status: 404 },
  );
}

/**
 * roadmap P5 Slice 1B (ADR-0018): POST /api/knowledge-documents/:id/complete
 * — upload completion, same owner/admin matrix as initiation. `id` is the
 * document identity `POST /api/knowledge-documents` returned; a malformed
 * id gets the same 404 shape as a genuinely missing upload, matching `POST
 * /api/conversations/:id/messages`'s malformed-id-is-404 precedent.
 *
 * The storage key is re-derived inside `completeKnowledgeDocumentUpload`
 * from `(session clinicId, id)` — never accepted from the client — so a
 * request naming another clinic's document id can only ever resolve to an
 * object that was never uploaded under this clinic's own prefix, which is
 * indistinguishable from "missing" (this route's own 404-collapsing rule,
 * covering the cross-clinic-access case structurally rather than with a
 * separate check).
 *
 * `filename` is the only client-supplied value this endpoint still trusts —
 * it is metadata only, never used for any check. The actual
 * ContentLength/Content-Type come from HeadObject inside the feature layer
 * and are authoritative; this route only translates the feature layer's
 * typed errors to the documented HTTP shape.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return missingObjectResponse();
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

  const filename =
    typeof body === 'object' &&
    body !== null &&
    'filename' in body &&
    typeof body.filename === 'string'
      ? body.filename
      : '';
  if (!filename.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'filename is required.' } },
      { status: 400 },
    );
  }

  try {
    const document = await completeKnowledgeDocumentUpload(
      session.clinicId,
      session.staffId,
      id,
      filename,
    );
    return NextResponse.json({ data: document }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadObjectMissingError) {
      return missingObjectResponse();
    }
    if (
      err instanceof UploadObjectTooLargeError ||
      err instanceof UploadObjectContentTypeMismatchError
    ) {
      return NextResponse.json(
        { error: { code: 'unprocessable', message: err.message } },
        { status: 422 },
      );
    }
    if (err instanceof DuplicateKnowledgeDocumentError) {
      return NextResponse.json(
        { error: { code: 'conflict', message: err.message } },
        { status: 409 },
      );
    }
    throw err;
  }
}
