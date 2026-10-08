import { NextResponse, type NextRequest } from 'next/server';

import { InvalidNewPasswordError } from '@/features/auth';
import { acceptInvitation } from '@/features/invitations';

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/invitations/accept — public (ADR-0023; docs/technical/03-api-contracts.md).
 * Body: `{ token, password }`. The token comes from the `/invite#<token>`
 * link; only its SHA-256 and the Argon2id hash of the password reach the
 * database.
 *
 * - 200 `{ data: { accepted: true } }` — the staff member exists. **No
 *   cookie and no session** (ADR-0023 decision 3, Owner decision I1): the
 *   invitee signs in through `/login`. This route never reads or sets the
 *   session cookie.
 * - 400 `invalid_request` — malformed JSON or a missing / non-string field.
 * - 400 `invalid_password` — not 12–128 characters.
 * - 409 `invitation_invalid` — unknown, used, expired or malformed token,
 *   indistinguishable by design.
 * - 409 `account_exists` — the invitation's email already belongs to a staff
 *   account (Owner decision E5); the invitation stays pending.
 * - 500 `internal_error` — anything unexpected. No internal detail is
 *   returned, and nothing from the request is logged.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Request body must be valid JSON.');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'invalid_request', 'Request body must be a JSON object.');
  }
  const { token, password } = body as Record<string, unknown>;
  if (typeof token !== 'string' || typeof password !== 'string') {
    return errorResponse(400, 'invalid_request', 'token and password are required.');
  }

  try {
    const result = await acceptInvitation(token, password);
    switch (result.outcome) {
      case 'accepted':
        return NextResponse.json({ data: { accepted: true } });
      case 'email_taken':
        return errorResponse(
          409,
          'account_exists',
          'An account with this email already exists. Sign in instead.',
        );
      default:
        return errorResponse(409, 'invitation_invalid', 'This invitation is no longer valid.');
    }
  } catch (err) {
    if (err instanceof InvalidNewPasswordError) {
      return errorResponse(400, 'invalid_password', err.message);
    }
    return errorResponse(500, 'internal_error', 'Something went wrong. Try again.');
  }
}
