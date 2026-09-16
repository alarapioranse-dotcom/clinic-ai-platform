import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { listPractitionersForClinic } from '@/features/appointments';

/**
 * roadmap P4 Slice 1: GET /api/appointments/practitioners. All four roles
 * (practitioner included, read-only — ADR-0004), same matrix as GET
 * /api/conversations — this is the minimal read the booking UI's
 * practitioner picker needs, not a staff-management endpoint. `clinicId`
 * comes only from the validated session, never a request parameter.
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

  const practitioners = await listPractitionersForClinic(session.clinicId);
  return NextResponse.json({ data: practitioners });
}
