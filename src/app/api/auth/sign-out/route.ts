import { NextResponse, type NextRequest } from 'next/server';

import { signOut, validateSession, SESSION_COOKIE_NAME } from '@/features/auth';

/**
 * docs/technical/03-api-contracts.md: POST /api/auth/sign-out, signed-in
 * only. Invalidates the current session and clears the cookie.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  await signOut(token);

  const response = NextResponse.json({ data: { signedOut: true } });
  // Clear the cookie by expiring it immediately, mirroring the same flags
  // it was set with at sign-in.
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
