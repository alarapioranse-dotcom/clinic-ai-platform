import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  STAFF_MANAGER_ROLES,
  InvitationNotFoundError,
  RoleNotInvitableError,
  cancelStaffInvitation,
} from '@/features/staff';

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * POST /api/staff/invitations/:id/cancel — owner, admin (item 3; Owner
 * decision S5). Moves a pending invitation of the caller's clinic to
 * `expired`, so its link stops working. Takes no body.
 *
 * - 200 `{ data: { cancelled: true } }`
 * - 403 `role_not_permitted` — the caller may not invite that invitation's
 *   role, so may not cancel it either (Owner decision T2).
 * - 404 `not_found` — unknown, malformed, already accepted/expired, or
 *   another clinic's id; indistinguishable by design.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  try {
    await cancelStaffInvitation(
      { staffId: session.staffId, clinicId: session.clinicId, role: session.role },
      id,
    );
    return NextResponse.json({ data: { cancelled: true } }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof InvitationNotFoundError) {
      return errorResponse(404, 'not_found', 'Invitation not found.');
    }
    if (err instanceof RoleNotInvitableError) {
      return errorResponse(
        403,
        'role_not_permitted',
        'Your role does not permit cancelling this invitation.',
      );
    }
    throw err;
  }
}
