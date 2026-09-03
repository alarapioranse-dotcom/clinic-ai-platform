import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { closePool } from '@/lib/db';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { POST as signOutRoute } from '@/app/api/auth/sign-out/route';
import { GET as sessionRoute } from '@/app/api/auth/session/route';

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function requestWithCookie(
  url: string,
  cookieValue: string | undefined,
  method: 'GET' | 'POST',
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: cookieValue ? { cookie: `session=${cookieValue}` } : {},
  });
}

/**
 * HTTP-boundary coverage of docs/technical/03-api-contracts.md's auth
 * endpoints, on top of the feature-level tests in tests/features/auth/**.
 * Calls the exported route handlers directly with constructed NextRequest
 * objects — no server process needed.
 */
describe('auth API routes', () => {
  afterAll(async () => {
    await closePool();
  });

  it('POST /api/auth/sign-in sets a cookie with every required security flag', async () => {
    const clinic = await createTestClinic('RouteCookie');
    const staff = await createTestStaffMember(clinic.id, 'RouteCookie');

    const response = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staff.email,
        password: staff.password,
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=604800/i);
  });

  it('POST /api/auth/sign-in response body never contains password_hash or token_hash material', async () => {
    const clinic = await createTestClinic('RouteNoLeak');
    const staff = await createTestStaffMember(clinic.id, 'RouteNoLeak');

    const response = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staff.email,
        password: staff.password,
      }),
    );
    const body: { data: { staffId: string; clinicId: string; role: string } } =
      await response.json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/hash/i);
    expect(body.data).toEqual({ staffId: staff.id, clinicId: clinic.id, role: staff.role });
  });

  it('an attacker-supplied clinic_id in the sign-in request body cannot override the authenticated clinic', async () => {
    const clinicOwn = await createTestClinic('RouteInjectOwn');
    const clinicOther = await createTestClinic('RouteInjectOther');
    const staff = await createTestStaffMember(clinicOwn.id, 'RouteInjectOwn');

    const response = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staff.email,
        password: staff.password,
        clinicId: clinicOther.id,
        clinic_id: clinicOther.id,
      }),
    );
    const body: { data: { clinicId: string } } = await response.json();

    expect(body.data.clinicId).toBe(clinicOwn.id);
    expect(body.data.clinicId).not.toBe(clinicOther.id);
  });

  it('POST /api/auth/sign-in returns 401 with a generic message for wrong credentials', async () => {
    const response = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: 'nobody@example.test',
        password: 'x',
      }),
    );
    expect(response.status).toBe(401);
    const body: { error: { code: string } } = await response.json();
    expect(body.error.code).toBe('invalid_credentials');
  });

  it('GET /api/auth/session returns 401 with no cookie', async () => {
    const response = await sessionRoute(
      requestWithCookie('http://localhost/api/auth/session', undefined, 'GET'),
    );
    expect(response.status).toBe(401);
  });

  it('GET /api/auth/session returns the authenticated identity resolved only from the cookie, ignoring a spoofed query parameter', async () => {
    const clinic = await createTestClinic('RouteSession');
    const staff = await createTestStaffMember(clinic.id, 'RouteSession');
    const signInResponse = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staff.email,
        password: staff.password,
      }),
    );
    const token = signInResponse.cookies.get('session')?.value;
    expect(token).toBeTruthy();

    const response = await sessionRoute(
      requestWithCookie('http://localhost/api/auth/session?clinicId=not-my-clinic', token, 'GET'),
    );
    expect(response.status).toBe(200);
    const body: { data: { staffId: string; clinicId: string; role: string } } =
      await response.json();
    expect(body.data).toEqual({ staffId: staff.id, clinicId: clinic.id, role: staff.role });
  });

  it('POST /api/auth/sign-out revokes the session and clears the cookie', async () => {
    const clinic = await createTestClinic('RouteSignOut');
    const staff = await createTestStaffMember(clinic.id, 'RouteSignOut');
    const signInResponse = await signInRoute(
      jsonRequest('http://localhost/api/auth/sign-in', {
        email: staff.email,
        password: staff.password,
      }),
    );
    const token = signInResponse.cookies.get('session')?.value;

    const signOutResponse = await signOutRoute(
      requestWithCookie('http://localhost/api/auth/sign-out', token, 'POST'),
    );
    expect(signOutResponse.status).toBe(200);
    const setCookie = signOutResponse.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/Max-Age=0/i);

    const sessionAfter = await sessionRoute(
      requestWithCookie('http://localhost/api/auth/session', token, 'GET'),
    );
    expect(sessionAfter.status).toBe(401);
  });

  it('POST /api/auth/sign-out returns 401 with no valid session', async () => {
    const response = await signOutRoute(
      requestWithCookie('http://localhost/api/auth/sign-out', undefined, 'POST'),
    );
    expect(response.status).toBe(401);
  });
});
