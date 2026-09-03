import { NextResponse, type NextRequest } from 'next/server';

import {
  signIn,
  InvalidCredentialsError,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/features/auth';

/**
 * docs/technical/03-api-contracts.md: POST /api/auth/sign-in, any role.
 * `{ email, password }` -> 200 sets the session cookie; 401 on any
 * credential failure, same generic message whether the email is unknown,
 * the password is wrong, or the account is deactivated.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const email =
    typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string'
      ? body.email
      : '';
  const password =
    typeof body === 'object' &&
    body !== null &&
    'password' in body &&
    typeof body.password === 'string'
      ? body.password
      : '';

  if (!email || !password) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'email and password are required.' } },
      { status: 400 },
    );
  }

  try {
    const result = await signIn(email, password);

    const response = NextResponse.json({
      data: { staffId: result.staffId, clinicId: result.clinicId, role: result.role },
    });
    response.cookies.set(SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: 'Invalid email or password.' } },
        { status: 401 },
      );
    }
    throw err;
  }
}
