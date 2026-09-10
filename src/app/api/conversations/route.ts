import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { listConversationsForClinic } from '@/features/conversations';

/**
 * docs/technical/03-api-contracts.md: GET /api/conversations, all four roles
 * (practitioner included, read-only — ADR-0004). `clinicId` comes only from
 * the validated session, never a request parameter. Mirrors
 * src/app/api/patients/route.ts's GET handler exactly.
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

  const conversations = await listConversationsForClinic(session.clinicId);
  return NextResponse.json({ data: conversations });
}
