import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { sendStaffReply, ConversationNotFoundError } from '@/features/conversations';

/**
 * Same pattern as `src/app/api/conversations/[id]/route.ts`'s
 * `UUID_PATTERN` — validated here, at the HTTP boundary, so a malformed ID
 * never reaches the feature layer and can instead return the same 404 shape
 * as a nonexistent or cross-clinic one (docs/technical/03-api-contracts.md's
 * 404-vs-403 rule).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFoundResponse() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Conversation not found.' } },
    { status: 404 },
  );
}

/**
 * roadmap P3-C: POST /api/conversations/:id/messages. Owner/admin/
 * receptionist only — practitioner stays read-only (ADR-0004), matching
 * `POST /api/patients`'s role matrix. `clinicId` and `staffId` come only
 * from the validated session (ADR-0003) — the request body is never
 * consulted for either, so it cannot be used to impersonate another staff
 * member or clinic. A malformed, nonexistent, or cross-clinic conversation
 * ID all produce the identical 404 shape `GET
 * /api/conversations/:id` already uses: the first is rejected here before
 * any query runs, and the latter two are indistinguishable Postgres
 * foreign-key violations the feature layer translates into
 * `ConversationNotFoundError` (`src/features/conversations/repository.ts`).
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
    requireRole(session, ['owner', 'admin', 'receptionist']);
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

  const content =
    typeof body === 'object' &&
    body !== null &&
    'content' in body &&
    typeof body.content === 'string'
      ? body.content
      : '';

  if (!content.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'content is required.' } },
      { status: 400 },
    );
  }

  try {
    const message = await sendStaffReply(session.clinicId, id, session.staffId, content);
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return notFoundResponse();
    }
    throw err;
  }
}
