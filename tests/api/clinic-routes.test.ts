import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/clinic/route';

/**
 * HTTP-boundary coverage for GET/PATCH /api/clinic (ADR-0022; Owner decisions
 * S2–S4). `clinicId` comes only from the session, so a request can only ever
 * read or change its own clinic.
 */

type Role = 'owner' | 'admin' | 'practitioner' | 'receptionist';

async function signInAs(clinicId: string, label: string, role: Role): Promise<string> {
  const staff = await createTestStaffMember(clinicId, label, { role });
  const response = await signInRoute(
    new NextRequest('http://localhost/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email: staff.email, password: staff.password }),
      headers: { 'content-type': 'application/json' },
    }),
  );
  const token = response.cookies.get('session')?.value;
  if (!token) throw new Error('sign-in fixture did not return a session token');
  return token;
}

function get(cookie: string | undefined) {
  return getRoute(
    new NextRequest('http://localhost/api/clinic', {
      method: 'GET',
      headers: cookie ? { cookie: `session=${cookie}` } : {},
    }),
  );
}

function patch(cookie: string | undefined, body: unknown, raw?: string) {
  return patchRoute(
    new NextRequest('http://localhost/api/clinic', {
      method: 'PATCH',
      body: raw ?? JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie: `session=${cookie}` } : {}),
      },
    }),
  );
}

async function storedRow(id: string): Promise<{ working_hours: unknown; timezone: string }> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ working_hours: unknown; timezone: string }>(
      'SELECT working_hours, timezone FROM clinics WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new Error('missing clinic');
    return rows[0];
  } finally {
    await admin.end();
  }
}

const MONDAY = { monday: { start: '08:30', end: '16:00' } };

afterAll(async () => {
  await closePool();
});

describe('GET /api/clinic', () => {
  it('returns 401 without a session', async () => {
    expect((await get(undefined)).status).toBe(401);
  });

  it.each(['owner', 'admin', 'practitioner', 'receptionist'] as const)(
    'returns the caller’s own clinic settings to %s, and nothing personal',
    async (role) => {
      const clinic = await createTestClinic(`ApiGet${role}`, 'Africa/Cairo');
      const token = await signInAs(clinic.id, `get-${role}`, role);
      const response = await get(token);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Object.keys(body.data).sort()).toEqual(['id', 'name', 'timezone', 'workingHours']);
      expect(body.data).toMatchObject({ id: clinic.id, timezone: 'Africa/Cairo' });
    },
  );
});

describe('PATCH /api/clinic', () => {
  it('returns 401 without a session', async () => {
    expect((await patch(undefined, { timezone: 'UTC' })).status).toBe(401);
  });

  it.each(['practitioner', 'receptionist'] as const)(
    'returns 403 for %s and writes nothing',
    async (role) => {
      const clinic = await createTestClinic(`ApiDeny${role}`, 'UTC');
      const before = await storedRow(clinic.id);
      const token = await signInAs(clinic.id, `deny-${role}`, role);
      const response = await patch(token, { workingHours: MONDAY, timezone: 'Europe/Athens' });
      expect(response.status).toBe(403);
      expect(await storedRow(clinic.id)).toEqual(before);
    },
  );

  it.each(['owner', 'admin'] as const)(
    'lets %s update working hours and timezone',
    async (role) => {
      const clinic = await createTestClinic(`ApiOk${role}`, 'UTC');
      const token = await signInAs(clinic.id, `ok-${role}`, role);
      const response = await patch(token, { workingHours: MONDAY, timezone: 'Europe/Athens' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.timezone).toBe('Europe/Athens');
      expect(body.data.workingHours.monday).toEqual(MONDAY.monday);
      expect(body.data.workingHours.sunday).toBeNull();

      const stored = await storedRow(clinic.id);
      expect(stored.timezone).toBe('Europe/Athens');
      expect((stored.working_hours as Record<string, unknown>).monday).toEqual(MONDAY.monday);
    },
  );

  it('only ever changes the session’s own clinic', async () => {
    const own = await createTestClinic('ApiOwn', 'UTC');
    const other = await createTestClinic('ApiOther', 'UTC');
    const otherBefore = await storedRow(other.id);
    const token = await signInAs(own.id, 'own-owner', 'owner');

    // There is no way to name a clinic in the request; a stray id field is rejected outright.
    const withId = await patch(token, { id: other.id, timezone: 'Europe/Athens' });
    expect(withId.status).toBe(400);

    const response = await patch(token, { timezone: 'Europe/Athens' });
    expect(response.status).toBe(200);
    expect((await storedRow(own.id)).timezone).toBe('Europe/Athens');
    expect(await storedRow(other.id)).toEqual(otherBefore);
  });

  it.each([
    ['invalid JSON', undefined, '{not json'],
    ['a non-object body', [1, 2], undefined],
    ['an empty object', {}, undefined],
    ['services (out of scope, ADR-0022 decision 4)', { services: [] }, undefined],
    ['a clinic name', { name: 'Renamed' }, undefined],
    ['a fixed-offset timezone', { timezone: '+02:00' }, undefined],
    ['an unknown timezone', { timezone: 'Mars/Olympus_Mons' }, undefined],
    [
      'malformed working hours',
      { workingHours: { monday: { start: '9', end: '17:00' } } },
      undefined,
    ],
    ['a midnight span', { workingHours: { friday: { start: '22:00', end: '02:00' } } }, undefined],
    ['an unknown weekday', { workingHours: { funday: null } }, undefined],
  ])('returns 400 for %s and writes nothing', async (_label, body, raw) => {
    const clinic = await createTestClinic('ApiBad', 'UTC');
    const before = await storedRow(clinic.id);
    const token = await signInAs(clinic.id, 'bad-owner', 'owner');
    const response = await patch(token, body, raw);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(await storedRow(clinic.id)).toEqual(before);
  });
});
