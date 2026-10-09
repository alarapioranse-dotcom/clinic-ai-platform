import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  STAFF_MANAGER_ROLES,
  AlreadyInvitedError,
  InvalidInvitationRequestError,
  RoleNotInvitableError,
  createStaffInvitation,
  parseInvitationRequest,
} from '@/features/staff';
import { env } from '@/lib/env';

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * POST /api/staff/invitations — owner, admin (docs/technical/03-api-contracts.md;
 * ADR-0023 decision 7; Owner decisions T1–T2). Body: `{ email, role }`.
 *
 * - 201 `{ data: { invitation, link } }` — the one-time link is in this
 *   response only (`Cache-Control: no-store`); it is never stored or logged.
 *   The caller delivers it personally (ADR-0023 decision 5).
 * - 400 `invalid_request` — malformed JSON, unknown field, bad email, unknown role.
 * - 401 / 403 `forbidden` — no session, or a role that manages no staff.
 * - 403 `role_not_permitted` — the caller may not invite that role
 *   (owner: admin/practitioner/receptionist; admin: practitioner/receptionist;
 *   nobody: owner).
 * - 409 `already_invited` — already a staff member of this clinic, or an
 *   open invitation exists for this email.
 *
 * `clinicId` and `invited_by` come only from the validated session.
 */
export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Request body must be valid JSON.');
  }

  try {
    const parsed = parseInvitationRequest(body);
    const created = await createStaffInvitation(
      { staffId: session.staffId, clinicId: session.clinicId, role: session.role },
      parsed,
      env.appUrl,
    );
    return NextResponse.json({ data: created }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof InvalidInvitationRequestError) {
      return errorResponse(400, 'invalid_request', err.message);
    }
    if (err instanceof RoleNotInvitableError) {
      return errorResponse(
        403,
        'role_not_permitted',
        'Your role does not permit inviting this role.',
      );
    }
    if (err instanceof AlreadyInvitedError) {
      return errorResponse(
        409,
        'already_invited',
        'This email is already a staff member or already has a pending invitation.',
      );
    }
    throw err;
  }
}
