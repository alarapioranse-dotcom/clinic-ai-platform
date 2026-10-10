import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestInvitation, createTestStaffMember } from '../fixtures';
import { POST as signInRoute } from '@/app/api/auth/sign-in/route';
import { GET as listRoute } from '@/app/api/staff/route';
import { POST as inviteRoute } from '@/app/api/staff/invitations/route';
import { POST as cancelRoute } from '@/app/api/staff/invitations/[id]/cancel/route';

/**
 * HTTP-boundary coverage for the staff API (item 3 PR B; Owner decisions
 * T1–T2): GET /api/staff, POST /api/staff/invitations,
 * POST /api/staff/invitations/:id/cancel. `clinicId` and the inviter always
 * come from the session; the role rule is enforced here, not only in the UI.
 */

type Role = 'owner' | 'admin' | 'practitioner' | 'receptionist';

let counter = 0;
function email(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}@example.test`;
}

async function signInAs(
  clinicId: string,
  label: string,
  role: Role,
): Promise<{ token: string; staffId: string }> {
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
  return { token, staffId: staff.id };
}

function cookieHeader(token: string | undefined): Record<string, string> {
  return token ? { cookie: `session=${token}` } : {};
}

function list(token: string | undefined) {
  return listRoute(
    new NextRequest('http://localhost/api/staff', { method: 'GET', headers: cookieHeader(token) }),
  );
}

function invite(token: string | undefined, body: unknown, raw?: string) {
  return inviteRoute(
    new NextRequest('http://localhost/api/staff/invitations', {
      method: 'POST',
      body: raw ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...cookieHeader(token) },
    }),
  );
}

function cancel(token: string | undefined, id: string) {
  return cancelRoute(
    new NextRequest(`http://localhost/api/staff/invitations/${id}/cancel`, {
      method: 'POST',
      headers: cookieHeader(token),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function invitationStatus(
  id: string,
): Promise<{ status: string; invited_by: string | null }> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ status: string; invited_by: string | null }>(
      'SELECT status, invited_by FROM invitations WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new Error('missing invitation');
    return rows[0];
  } finally {
    await admin.end();
  }
}

afterAll(async () => {
  await closePool();
});

describe('authentication and role gate (all three routes)', () => {
  it('returns 401 without a session', async () => {
    expect((await list(undefined)).status).toBe(401);
    expect((await invite(undefined, { email: email('x'), role: 'receptionist' })).status).toBe(401);
    expect((await cancel(undefined, '00000000-0000-4000-8000-000000000000')).status).toBe(401);
  });

  it.each(['practitioner', 'receptionist'] as const)('returns 403 to %s', async (role) => {
    const clinic = await createTestClinic(`ApiStaffDeny${role}`);
    const { token } = await signInAs(clinic.id, `deny-${role}`, role);
    const pending = await createTestInvitation(clinic.id, { role: 'owner' });

    const responses = [
      await list(token),
      await invite(token, { email: email('deny'), role: 'receptionist' }),
      await cancel(token, pending.id),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('forbidden');
    }
    expect((await invitationStatus(pending.id)).status).toBe('pending');
  });
});

describe('GET /api/staff', () => {
  it('returns the caller’s clinic staff, open invitations and invitable roles, uncached', async () => {
    const clinic = await createTestClinic('ApiStaffList');
    const other = await createTestClinic('ApiStaffListOther');
    const { token } = await signInAs(clinic.id, 'list-admin', 'admin');
    const foreign = await createTestStaffMember(other.id, 'list-foreign');

    const response = await list(token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(['invitableRoles', 'invitations', 'staff']);
    expect(body.data.invitableRoles).toEqual(['practitioner', 'receptionist']);
    expect(body.data.staff.map((m: { email: string }) => m.email)).not.toContain(foreign.email);
    expect(JSON.stringify(body)).not.toMatch(/password|token_hash|argon2/i);
  });

  it('gives an owner the owner’s invitable roles', async () => {
    const clinic = await createTestClinic('ApiStaffListOwner');
    const { token } = await signInAs(clinic.id, 'list-owner', 'owner');
    const body = await (await list(token)).json();
    expect(body.data.invitableRoles).toEqual(['admin', 'practitioner', 'receptionist']);
  });
});

describe('POST /api/staff/invitations', () => {
  it('201: creates an invitation in the session’s clinic, invited by the caller, link once and uncached', async () => {
    const clinic = await createTestClinic('ApiInvite');
    const { token, staffId } = await signInAs(clinic.id, 'inv-owner', 'owner');
    const response = await invite(token, { email: '  Mixed.Case@Example.TEST ', role: 'admin' });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.cookies.getAll()).toEqual([]);
    const body = await response.json();
    expect(body.data.invitation).toMatchObject({ email: 'mixed.case@example.test', role: 'admin' });
    expect(body.data.link).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
    expect(await invitationStatus(body.data.invitation.id)).toEqual({
      status: 'pending',
      invited_by: staffId,
    });
  });

  it.each([
    ['admin', 'admin'],
    ['admin', 'owner'],
    ['owner', 'owner'],
  ] as const)('403 role_not_permitted: %s inviting %s', async (inviter, target) => {
    const clinic = await createTestClinic(`ApiInviteRule${inviter}${target}`);
    const { token } = await signInAs(clinic.id, `rule-${inviter}`, inviter);
    const response = await invite(token, { email: email('rule'), role: target });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('role_not_permitted');
  });

  it('ignores any clinic or inviter in the body: unknown fields are rejected', async () => {
    const clinic = await createTestClinic('ApiInviteSpoof');
    const other = await createTestClinic('ApiInviteSpoofOther');
    const { token } = await signInAs(clinic.id, 'spoof-owner', 'owner');
    for (const extra of [
      { clinicId: other.id },
      { invitedBy: clinic.id },
      { status: 'accepted' },
    ]) {
      const response = await invite(token, {
        email: email('spoof'),
        role: 'receptionist',
        ...extra,
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('invalid_request');
    }
  });

  it.each([
    ['not json', undefined, '{'],
    ['array', [], undefined],
    ['missing role', { email: 'a@b.co' }, undefined],
    ['bad email', { email: 'nope', role: 'receptionist' }, undefined],
    ['unknown role', { email: 'a@b.co', role: 'superuser' }, undefined],
  ])('400 invalid_request: %s', async (_label, body, raw) => {
    const clinic = await createTestClinic('ApiInviteBad');
    const { token } = await signInAs(clinic.id, 'bad-owner', 'owner');
    const response = await invite(token, body, raw);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
  });

  it('409 already_invited for an existing member or an open invitation; no duplicate row', async () => {
    const clinic = await createTestClinic('ApiInviteDup');
    const { token } = await signInAs(clinic.id, 'dup-owner', 'owner');
    const member = await createTestStaffMember(clinic.id, 'dup-member');
    const invitee = email('dup');
    expect((await invite(token, { email: invitee, role: 'receptionist' })).status).toBe(201);

    for (const target of [member.email, invitee, invitee.toUpperCase()]) {
      const response = await invite(token, { email: target, role: 'receptionist' });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('already_invited');
    }
    const listed = await (await list(token)).json();
    expect(
      listed.data.invitations.filter((i: { email: string }) => i.email === invitee),
    ).toHaveLength(1);
  });
});

describe('POST /api/staff/invitations/:id/cancel', () => {
  it('200 cancels a pending invitation; repeating it is 404', async () => {
    const clinic = await createTestClinic('ApiCancel');
    const { token } = await signInAs(clinic.id, 'cancel-admin', 'admin');
    const created = await (
      await invite(token, { email: email('cancel'), role: 'practitioner' })
    ).json();
    const id = created.data.invitation.id;

    const response = await cancel(token, id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { cancelled: true } });
    expect((await invitationStatus(id)).status).toBe('expired');
    expect((await cancel(token, id)).status).toBe(404);
  });

  it('403 when an admin cancels an admin invitation; 404 for malformed or other-clinic ids', async () => {
    const clinic = await createTestClinic('ApiCancelRule');
    const other = await createTestClinic('ApiCancelRuleOther');
    const { token: ownerToken } = await signInAs(clinic.id, 'cr-owner', 'owner');
    const { token: adminToken } = await signInAs(clinic.id, 'cr-admin', 'admin');
    const adminInvite = await (
      await invite(ownerToken, { email: email('cr-admin-invite'), role: 'admin' })
    ).json();
    const theirs = await createTestInvitation(other.id, { role: 'owner' });

    const forbidden = await cancel(adminToken, adminInvite.data.invitation.id);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('role_not_permitted');

    for (const id of ['not-a-uuid', theirs.id]) {
      const response = await cancel(ownerToken, id);
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('not_found');
    }
    expect((await invitationStatus(adminInvite.data.invitation.id)).status).toBe('pending');
    expect((await invitationStatus(theirs.id)).status).toBe('pending');
  });
});
