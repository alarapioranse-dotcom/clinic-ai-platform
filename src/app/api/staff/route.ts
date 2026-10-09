import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { STAFF_MANAGER_ROLES, getStaffOverview, invitableRoles } from '@/features/staff';

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * GET /api/staff — owner, admin (docs/technical/03-api-contracts.md).
 * The caller's own clinic's active staff and open invitations, plus the roles
 * the caller may invite (Owner decision T2). `clinicId` comes only from the
 * validated session. No password hash or token hash is ever returned.
 */
export async function GET(request: NextRequest) {
  const session = await validateSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return errorResponse(401, 'unauthorized', 'No valid session.');
  }

  try {
    requireRole(session, STAFF_MANAGER_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return errorResponse(403, 'forbidden', 'Your role does not permit this action.');
    }
    throw err;
  }

  const overview = await getStaffOverview(session.clinicId);
  return NextResponse.json(
    { data: { ...overview, invitableRoles: invitableRoles(session.role) } },
    { headers: NO_STORE },
  );
}
