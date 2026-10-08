import { describe, it, expect, afterAll, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from 'pg';

import * as db from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { POST as acceptRoute } from '@/app/api/invitations/accept/route';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { createTestClinic, createTestInvitation, createTestStaffMember } from '../fixtures';

/**
 * HTTP-boundary coverage for POST /api/invitations/accept (ADR-0023; Owner
 * decisions E5, I1–I3). Real PostgreSQL; the database helper is wrapped (not
 * replaced) so one test can force an unexpected failure.
 */
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, acceptInvitationInDatabase: vi.fn(actual.acceptInvitationInDatabase) };
});

const PASSWORD = 'a long enough passphrase';

function post(body: unknown, raw?: string, cookie?: string): Promise<Response> {
  return acceptRoute(
    new NextRequest('http://localhost/api/invitations/accept', {
      method: 'POST',
      body: raw ?? JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie: `session=${cookie}` } : {}),
      },
    }),
  );
}

async function totalSessions(): Promise<number> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM staff_sessions',
    );
    return Number(rows[0]!.n);
  } finally {
    await admin.end();
  }
}

async function invitationStatus(id: string): Promise<string> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ status: string }>(
      'SELECT status FROM invitations WHERE id = $1',
      [id],
    );
    return rows[0]!.status;
  } finally {
    await admin.end();
  }
}

/** Every response must be free of cookies and of the submitted secrets. */
async function expectNoLeak(response: Response, secrets: string[]): Promise<string> {
  expect(response.headers.get('set-cookie')).toBeNull();
  const text = await response.text();
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/\$argon2/);
  expect(text).not.toMatch(/[0-9a-f]{64}/);
  return text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.closePool();
});

describe('POST /api/invitations/accept', () => {
  it('200 on a valid invitation, with no cookie and no new session', async () => {
    const clinic = await createTestClinic('RouteAccept');
    const invitation = await createTestInvitation(clinic.id);
    const sessionsBefore = await totalSessions();

    const response = await post({ token: invitation.rawToken, password: PASSWORD });
    expect(response.status).toBe(200);
    const text = await expectNoLeak(response, [invitation.rawToken, PASSWORD, invitation.email]);
    expect(JSON.parse(text)).toEqual({ data: { accepted: true } });
    expect(await totalSessions()).toBe(sessionsBefore);

    // The account then signs in through the existing route.
    const signIn = await signInRoute(
      new NextRequest('http://localhost/api/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email: invitation.email, password: PASSWORD }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(signIn.status).toBe(200);
    expect((await signIn.json()).data.clinicId).toBe(clinic.id);
  });

  it('does not read or change an existing session cookie', async () => {
    const clinic = await createTestClinic('RouteExistingSession');
    const invitation = await createTestInvitation(clinic.id);
    const response = await post(
      { token: invitation.rawToken, password: PASSWORD },
      undefined,
      'some-existing-session-token',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('409 invitation_invalid for unknown, used, expired and malformed tokens — one identical body', async () => {
    const clinic = await createTestClinic('RouteInvalid');
    const used = await createTestInvitation(clinic.id);
    expect((await post({ token: used.rawToken, password: PASSWORD })).status).toBe(200);
    const expired = await createTestInvitation(clinic.id, { createdHoursAgo: 73 });

    const bodies = new Set<string>();
    for (const token of [
      'C'.repeat(43), // unknown
      used.rawToken, // already used
      expired.rawToken, // expired
      'not-a-token', // malformed
      '', // empty
    ]) {
      const response = await post({ token, password: PASSWORD });
      expect(response.status).toBe(409);
      bodies.add(await expectNoLeak(response, [token || 'unused-placeholder', PASSWORD]));
    }
    expect([...bodies]).toEqual([
      JSON.stringify({
        error: { code: 'invitation_invalid', message: 'This invitation is no longer valid.' },
      }),
    ]);
    expect(await invitationStatus(expired.id)).toBe('expired');
  });

  it('409 account_exists when the email already has an account; the invitation stays pending', async () => {
    const clinicA = await createTestClinic('RouteTakenA');
    const clinicB = await createTestClinic('RouteTakenB');
    const existing = await createTestStaffMember(clinicB.id, 'route-taken');
    const invitation = await createTestInvitation(clinicA.id, { email: existing.email });

    const response = await post({ token: invitation.rawToken, password: PASSWORD });
    expect(response.status).toBe(409);
    const text = await expectNoLeak(response, [invitation.rawToken, PASSWORD, existing.email]);
    expect(JSON.parse(text).error.code).toBe('account_exists');
    expect(await invitationStatus(invitation.id)).toBe('pending');
  });

  it.each([
    ['11 characters', 'a'.repeat(11)],
    ['129 characters', 'a'.repeat(129)],
    ['11 emoji', '🔒'.repeat(11)],
  ])('400 invalid_password for %s, and the invitation stays usable', async (_label, password) => {
    const clinic = await createTestClinic('RoutePw');
    const invitation = await createTestInvitation(clinic.id);
    const response = await post({ token: invitation.rawToken, password });
    expect(response.status).toBe(400);
    const text = await expectNoLeak(response, [invitation.rawToken, password]);
    expect(JSON.parse(text).error.code).toBe('invalid_password');
    expect(await invitationStatus(invitation.id)).toBe('pending');
  });

  it.each([
    ['malformed JSON', undefined, '{not json'],
    ['a JSON array', [1, 2], undefined],
    ['JSON null', null, undefined],
    ['a missing token', { password: PASSWORD }, undefined],
    ['a missing password', { token: 'D'.repeat(43) }, undefined],
    ['a numeric token', { token: 123, password: PASSWORD }, undefined],
    ['a non-string password', { token: 'D'.repeat(43), password: ['x'] }, undefined],
  ])('400 invalid_request for %s', async (_label, body, raw) => {
    const response = await post(body, raw);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('500 internal_error with no internal detail when the database fails, and logs nothing', async () => {
    const clinic = await createTestClinic('Route500');
    const invitation = await createTestInvitation(clinic.id);
    vi.mocked(db.acceptInvitationInDatabase).mockRejectedValueOnce(
      new Error('connection to server at "db.internal" failed: password authentication failed'),
    );
    const consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    const response = await post({ token: invitation.rawToken, password: PASSWORD });
    expect(response.status).toBe(500);
    const text = await expectNoLeak(response, [invitation.rawToken, PASSWORD]);
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong. Try again.' },
    });
    expect(text).not.toContain('db.internal');
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    // Nothing was consumed: the invitation can still be accepted.
    expect(await invitationStatus(invitation.id)).toBe('pending');
    expect((await post({ token: invitation.rawToken, password: PASSWORD })).status).toBe(200);
  });
});
