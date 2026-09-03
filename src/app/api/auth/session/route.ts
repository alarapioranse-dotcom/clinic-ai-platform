import { NextResponse, type NextRequest } from 'next/server';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';

/**
 * docs/technical/03-api-contracts.md: GET /api/auth/session, signed-in
 * only. Returns the caller's own { staffId, clinicId, role }, resolved
 * entirely from the validated session — never from any request input.
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

  return NextResponse.json({ data: session });
}
