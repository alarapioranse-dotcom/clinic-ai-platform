import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { getConversation } from '@/features/conversations';

/**
 * Same pattern as src/lib/db.ts's `CLINIC_ID_PATTERN` — validated here, at
 * the HTTP boundary, rather than in the repository: docs/technical/03-api-contracts.md's
 * 404-vs-403 rule requires a malformed ID to be indistinguishable from a
 * nonexistent or cross-clinic one, so this must reject before the feature
 * layer ever runs a query that could throw a Postgres "invalid input syntax
 * for type uuid" error instead of returning 404.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * docs/technical/03-api-contracts.md: GET /api/conversations/:id, all four
 * roles (practitioner included, read-only — ADR-0004). `clinicId` comes only
 * from the validated session, never a request parameter. Mirrors
 * src/app/api/patients/route.ts's GET handler for the session/role checks;
 * "404 vs. 403 for cross-tenant access" (same doc) is why a nonexistent ID,
 * another clinic's ID, and a malformed ID all return 404 here rather than
 * being distinguished.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  try {
    requireRole(session, ['owner', 'admin', 'practitioner', 'receptionist']);
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
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Conversation not found.' } },
      { status: 404 },
    );
  }

  const result = await getConversation(session.clinicId, id);
  if (!result) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Conversation not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
