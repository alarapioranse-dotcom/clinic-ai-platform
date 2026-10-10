import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { acceptInvitation } from '@/features/invitations';
import {
  AlreadyInvitedError,
  InvalidInvitationRequestError,
  InvitationNotFoundError,
  RoleNotInvitableError,
  cancelStaffInvitation,
  createStaffInvitation,
  getStaffOverview,
  parseInvitationRequest,
  type StaffManager,
} from '@/features/staff';
import { createTestClinic, createTestInvitation, createTestStaffMember } from '../../fixtures';

/**
 * Item 3 PR B: issuing, listing and cancelling staff invitations
 * (ADR-0023 decision 7; Owner decisions S1–S5, T1–T2), against the real
 * database with migrations 0016 and 0017.
 */

const APP_URL = 'https://app.example.test';
const PASSWORD = 'a long enough passphrase';

type Role = 'owner' | 'admin' | 'practitioner' | 'receptionist';

let counter = 0;
function email(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}@example.test`;
}

async function manager(clinicId: string, role: Role): Promise<StaffManager> {
  const staff = await createTestStaffMember(clinicId, `mgr-${role}`, { role });
  return { staffId: staff.id, clinicId, role };
}

async function invitationRow(id: string) {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{
      clinic_id: string;
      email: string;
      role: string;
      status: string;
      invited_by: string | null;
      token_hash: string;
    }>(
      'SELECT clinic_id, email, role, status, invited_by, token_hash FROM invitations WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new Error('missing invitation');
    return rows[0];
  } finally {
    await admin.end();
  }
}

function tokenOf(link: string): string {
  const token = link.split('#')[1];
  if (!token) throw new Error('link has no fragment');
  return token;
}

afterAll(async () => {
  await closePool();
});

describe('parseInvitationRequest', () => {
  it('normalizes the email and accepts the four roles', () => {
    expect(parseInvitationRequest({ email: '  New.Person@Example.TEST ', role: 'admin' })).toEqual({
      email: 'new.person@example.test',
      role: 'admin',
    });
  });

  it.each([
    [null],
    [[]],
    ['text'],
    [{ role: 'admin' }],
    [{ email: 'a@b.co' }],
    [{ email: 42, role: 'admin' }],
    [{ email: 'not-an-email', role: 'admin' }],
    [{ email: `${'a'.repeat(250)}@b.co`, role: 'admin' }],
    [{ email: 'a@b.co', role: 'superuser' }],
    [{ email: 'a@b.co', role: 'admin', clinicId: 'x' }],
    [{ email: 'a@b.co', role: 'admin', invitedBy: 'x' }],
  ])('rejects %j', (body) => {
    expect(() => parseInvitationRequest(body)).toThrow(InvalidInvitationRequestError);
  });
});

describe('createStaffInvitation — role rule (T2), enforced on the server', () => {
  const MATRIX: [Role, Role, boolean][] = [
    ['owner', 'admin', true],
    ['owner', 'practitioner', true],
    ['owner', 'receptionist', true],
    ['owner', 'owner', false],
    ['admin', 'practitioner', true],
    ['admin', 'receptionist', true],
    ['admin', 'admin', false],
    ['admin', 'owner', false],
    ['practitioner', 'receptionist', false],
    ['receptionist', 'practitioner', false],
  ];

  it.each(MATRIX)('%s inviting %s → allowed: %s', async (inviterRole, target, allowed) => {
    const clinic = await createTestClinic(`StaffRule${inviterRole}${target}`);
    const inviter = await manager(clinic.id, inviterRole);
    const request = { email: email('rule'), role: target };
    if (allowed) {
      const created = await createStaffInvitation(inviter, request, APP_URL);
      const row = await invitationRow(created.invitation.id);
      expect(row).toMatchObject({
        clinic_id: clinic.id,
        email: request.email,
        role: target,
        status: 'pending',
        invited_by: inviter.staffId,
      });
    } else {
      await expect(createStaffInvitation(inviter, request, APP_URL)).rejects.toThrow(
        RoleNotInvitableError,
      );
    }
  });
});

describe('createStaffInvitation — token, link and acceptance', () => {
  it('stores only the SHA-256 of the token and returns a one-time /invite# link', async () => {
    const clinic = await createTestClinic('StaffLink');
    const owner = await manager(clinic.id, 'owner');
    const created = await createStaffInvitation(
      owner,
      { email: email('link'), role: 'receptionist' },
      `${APP_URL}/`,
    );
    expect(created.link).toMatch(/^https:\/\/app\.example\.test\/invite#[A-Za-z0-9_-]{43}$/);
    const raw = tokenOf(created.link);
    const row = await invitationRow(created.invitation.id);
    expect(row.token_hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(row.token_hash).not.toContain(raw);
    const expiresInHours =
      (new Date(created.invitation.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(expiresInHours).toBeGreaterThan(71.9);
    expect(expiresInHours).toBeLessThanOrEqual(72.01);
  });

  it('is accepted through the unchanged acceptance path with the invited role', async () => {
    const clinic = await createTestClinic('StaffAccept');
    const owner = await manager(clinic.id, 'owner');
    const invitee = email('accept');
    const created = await createStaffInvitation(owner, { email: invitee, role: 'admin' }, APP_URL);
    expect(await acceptInvitation(tokenOf(created.link), PASSWORD)).toEqual({
      outcome: 'accepted',
    });

    const overview = await getStaffOverview(clinic.id);
    expect(overview.staff.find((member) => member.email === invitee)?.role).toBe('admin');
    expect(overview.invitations.find((inv) => inv.id === created.invitation.id)).toBeUndefined();
  });
});

describe('createStaffInvitation — duplicates', () => {
  it('refuses an email that is already a staff member of this clinic (any status)', async () => {
    const clinic = await createTestClinic('StaffDupMember');
    const owner = await manager(clinic.id, 'owner');
    const active = await createTestStaffMember(clinic.id, 'dup-active');
    const gone = await createTestStaffMember(clinic.id, 'dup-gone', { status: 'deactivated' });
    for (const existing of [active.email, gone.email.toUpperCase()]) {
      await expect(
        createStaffInvitation(
          owner,
          parseInvitationRequest({ email: existing, role: 'admin' }),
          APP_URL,
        ),
      ).rejects.toThrow(AlreadyInvitedError);
    }
  });

  it('refuses a second open invitation for the same email', async () => {
    const clinic = await createTestClinic('StaffDupInvite');
    const owner = await manager(clinic.id, 'owner');
    const invitee = email('dup-invite');
    await createStaffInvitation(owner, { email: invitee, role: 'receptionist' }, APP_URL);
    await expect(
      createStaffInvitation(owner, { email: invitee, role: 'practitioner' }, APP_URL),
    ).rejects.toThrow(AlreadyInvitedError);
  });

  it('two concurrent invitations for one email produce exactly one', async () => {
    const clinic = await createTestClinic('StaffRace');
    const owner = await manager(clinic.id, 'owner');
    const invitee = email('race');
    const results = await Promise.allSettled([
      createStaffInvitation(owner, { email: invitee, role: 'receptionist' }, APP_URL),
      createStaffInvitation(owner, { email: invitee, role: 'receptionist' }, APP_URL),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AlreadyInvitedError);
  });

  it('retires a timed-out pending invitation and issues a new one', async () => {
    const clinic = await createTestClinic('StaffRetire');
    const owner = await manager(clinic.id, 'owner');
    const invitee = email('retire');
    const old = await createTestInvitation(clinic.id, {
      email: invitee,
      role: 'receptionist',
      invitedBy: owner.staffId,
      createdHoursAgo: 73,
    });
    const created = await createStaffInvitation(
      owner,
      { email: invitee, role: 'receptionist' },
      APP_URL,
    );
    expect((await invitationRow(old.id)).status).toBe('expired');
    expect((await invitationRow(created.invitation.id)).status).toBe('pending');
  });

  it('only sees its own clinic: another clinic’s staff email or invitation does not block, and nothing leaks', async () => {
    const own = await createTestClinic('StaffOwn');
    const other = await createTestClinic('StaffOther');
    const owner = await manager(own.id, 'owner');
    const elsewhere = await createTestStaffMember(other.id, 'elsewhere');
    const invitedElsewhere = email('invited-elsewhere');
    await createTestInvitation(other.id, { email: invitedElsewhere, role: 'owner' });

    const toStaff = await createStaffInvitation(
      owner,
      { email: elsewhere.email, role: 'receptionist' },
      APP_URL,
    );
    await createStaffInvitation(owner, { email: invitedElsewhere, role: 'receptionist' }, APP_URL);

    // Staff email is global (ADR-0012): acceptance refuses, the invitation stays pending.
    expect(await acceptInvitation(tokenOf(toStaff.link), PASSWORD)).toEqual({
      outcome: 'email_taken',
    });
    const overview = await getStaffOverview(own.id);
    expect(overview.staff.map((m) => m.email)).not.toContain(elsewhere.email);
  });
});

describe('getStaffOverview', () => {
  it('lists only this clinic’s active staff and open invitations, without secrets', async () => {
    const clinic = await createTestClinic('StaffList');
    const other = await createTestClinic('StaffListOther');
    const owner = await manager(clinic.id, 'owner');
    const active = await createTestStaffMember(clinic.id, 'list-active');
    const gone = await createTestStaffMember(clinic.id, 'list-gone', { status: 'deactivated' });
    const foreign = await createTestStaffMember(other.id, 'list-foreign');
    const open = await createStaffInvitation(
      owner,
      { email: email('list-open'), role: 'practitioner' },
      APP_URL,
    );
    const timedOut = await createTestInvitation(clinic.id, {
      role: 'receptionist',
      invitedBy: owner.staffId,
      createdHoursAgo: 80,
    });
    const foreignInvite = await createTestInvitation(other.id);

    const overview = await getStaffOverview(clinic.id);
    const staffEmails = overview.staff.map((m) => m.email);
    expect(staffEmails).toContain(active.email);
    expect(staffEmails).not.toContain(gone.email);
    expect(staffEmails).not.toContain(foreign.email);
    const invitationIds = overview.invitations.map((i) => i.id);
    expect(invitationIds).toEqual([open.invitation.id]);
    expect(invitationIds).not.toContain(timedOut.id);
    expect(invitationIds).not.toContain(foreignInvite.id);

    for (const member of overview.staff) {
      expect(Object.keys(member).sort()).toEqual(['createdAt', 'email', 'id', 'role']);
    }
    for (const invitation of overview.invitations) {
      expect(Object.keys(invitation).sort()).toEqual(
        ['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'role'].sort(),
      );
    }
    expect(JSON.stringify(overview)).not.toMatch(/argon2|password|token/i);
  });
});

describe('cancelStaffInvitation (S5)', () => {
  it('moves a pending invitation to expired, after which its link is invalid', async () => {
    const clinic = await createTestClinic('StaffCancel');
    const admin = await manager(clinic.id, 'admin');
    const created = await createStaffInvitation(
      admin,
      { email: email('cancel'), role: 'receptionist' },
      APP_URL,
    );
    await cancelStaffInvitation(admin, created.invitation.id);
    expect((await invitationRow(created.invitation.id)).status).toBe('expired');
    expect(await acceptInvitation(tokenOf(created.link), PASSWORD)).toEqual({ outcome: 'invalid' });
    // A cancelled invitation no longer blocks a new one for the same email.
    await expect(
      createStaffInvitation(
        admin,
        { email: created.invitation.email, role: 'receptionist' },
        APP_URL,
      ),
    ).resolves.toBeDefined();
  });

  it('an admin cannot cancel an admin invitation; nobody cancels an owner invitation', async () => {
    const clinic = await createTestClinic('StaffCancelRule');
    const owner = await manager(clinic.id, 'owner');
    const admin = await manager(clinic.id, 'admin');
    const adminInvite = await createStaffInvitation(
      owner,
      { email: email('cancel-admin'), role: 'admin' },
      APP_URL,
    );
    const ownerInvite = await createTestInvitation(clinic.id, { role: 'owner' });

    await expect(cancelStaffInvitation(admin, adminInvite.invitation.id)).rejects.toThrow(
      RoleNotInvitableError,
    );
    for (const caller of [owner, admin]) {
      await expect(cancelStaffInvitation(caller, ownerInvite.id)).rejects.toThrow(
        RoleNotInvitableError,
      );
    }
    expect((await invitationRow(adminInvite.invitation.id)).status).toBe('pending');
    expect((await invitationRow(ownerInvite.id)).status).toBe('pending');

    await cancelStaffInvitation(owner, adminInvite.invitation.id);
    expect((await invitationRow(adminInvite.invitation.id)).status).toBe('expired');
  });

  it('treats unknown, malformed, accepted, already-cancelled and other-clinic ids as not found', async () => {
    const clinic = await createTestClinic('StaffCancel404');
    const other = await createTestClinic('StaffCancel404Other');
    const owner = await manager(clinic.id, 'owner');
    const otherOwner = await manager(other.id, 'owner');
    const theirs = await createStaffInvitation(
      otherOwner,
      { email: email('theirs'), role: 'receptionist' },
      APP_URL,
    );
    const accepted = await createStaffInvitation(
      owner,
      { email: email('accepted'), role: 'receptionist' },
      APP_URL,
    );
    await acceptInvitation(tokenOf(accepted.link), PASSWORD);
    const cancelled = await createStaffInvitation(
      owner,
      { email: email('twice'), role: 'receptionist' },
      APP_URL,
    );
    await cancelStaffInvitation(owner, cancelled.invitation.id);

    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'not-a-uuid',
      "' OR 1=1 --",
      accepted.invitation.id,
      cancelled.invitation.id,
      theirs.invitation.id,
    ]) {
      await expect(cancelStaffInvitation(owner, id)).rejects.toThrow(InvitationNotFoundError);
    }
    expect((await invitationRow(theirs.invitation.id)).status).toBe('pending');
  });
});
