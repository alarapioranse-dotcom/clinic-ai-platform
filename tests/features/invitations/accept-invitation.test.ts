import { describe, it, expect, afterAll, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

import * as db from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { InvalidNewPasswordError, signIn, validateSession, verifyPasswordForTest } from './helpers';
import { acceptInvitation, hashInvitationToken } from '@/features/invitations';
import { createTestClinic, createTestInvitation, createTestStaffMember } from '../../fixtures';

/**
 * src/features/invitations against real PostgreSQL (ADR-0023; Owner
 * decisions I1–I3). The database helper is wrapped (not replaced) so each
 * test can assert exactly what reached the database.
 */
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, acceptInvitationInDatabase: vi.fn(actual.acceptInvitationInDatabase) };
});

const PASSWORD = 'correct horse battery staple';

async function staffFor(email: string) {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{
      id: string;
      clinic_id: string;
      role: string;
      password_hash: string;
    }>('SELECT id, clinic_id, role, password_hash FROM staff_members WHERE email = $1', [email]);
    return rows;
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

async function sessionCountFor(staffId: string): Promise<number> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM staff_sessions WHERE staff_member_id = $1',
      [staffId],
    );
    return Number(rows[0]!.n);
  } finally {
    await admin.end();
  }
}

const dbHelper = vi.mocked(db.acceptInvitationInDatabase);

beforeEach(() => {
  dbHelper.mockClear();
});

afterAll(async () => {
  await db.closePool();
});

describe('hashInvitationToken', () => {
  it('is SHA-256 lowercase hex of the raw token', () => {
    const raw = 'A'.repeat(43);
    expect(hashInvitationToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashInvitationToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('acceptInvitation', () => {
  it('creates the staff member in the invitation’s clinic with the invitation’s role, and no session', async () => {
    const clinic = await createTestClinic('FeatAccept');
    const invitation = await createTestInvitation(clinic.id);

    expect(await acceptInvitation(invitation.rawToken, PASSWORD)).toEqual({ outcome: 'accepted' });

    const staff = await staffFor(invitation.email);
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ clinic_id: clinic.id, role: 'owner' });
    expect(await invitationStatus(invitation.id)).toBe('accepted');
    expect(await sessionCountFor(staff[0]!.id)).toBe(0);
  });

  it('sends only SHA-256(token) and an Argon2id hash to the database — never the raw values', async () => {
    const clinic = await createTestClinic('FeatHashesOnly');
    const invitation = await createTestInvitation(clinic.id);
    await acceptInvitation(invitation.rawToken, PASSWORD);

    expect(dbHelper).toHaveBeenCalledTimes(1);
    const [tokenHash, passwordHash] = dbHelper.mock.calls[0]!;
    expect(tokenHash).toBe(hashInvitationToken(invitation.rawToken));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    const sent = JSON.stringify(dbHelper.mock.calls);
    expect(sent).not.toContain(invitation.rawToken);
    expect(sent).not.toContain(PASSWORD);
  });

  it('stores an Argon2id hash that verifies against the chosen password, never the password itself', async () => {
    const clinic = await createTestClinic('FeatStoredHash');
    const invitation = await createTestInvitation(clinic.id);
    await acceptInvitation(invitation.rawToken, PASSWORD);

    const [staff] = await staffFor(invitation.email);
    expect(staff!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(staff!.password_hash).not.toContain(PASSWORD);
    expect(await verifyPasswordForTest(staff!.password_hash, PASSWORD)).toBe(true);
  });

  it('lets the new account sign in through the existing flow, scoped to the invitation’s clinic only', async () => {
    const clinic = await createTestClinic('FeatSignIn');
    const otherClinic = await createTestClinic('FeatSignInOther');
    const invitation = await createTestInvitation(clinic.id, { role: 'owner' });
    await acceptInvitation(invitation.rawToken, PASSWORD);

    const result = await signIn(invitation.email, PASSWORD);
    expect(result.clinicId).toBe(clinic.id);
    expect(result.clinicId).not.toBe(otherClinic.id);
    expect(result.role).toBe('owner');
    const session = await validateSession(result.token);
    expect(session).toEqual({ staffId: result.staffId, clinicId: clinic.id, role: 'owner' });
  });

  it('is single use: the second acceptance is invalid and creates nothing', async () => {
    const clinic = await createTestClinic('FeatTwice');
    const invitation = await createTestInvitation(clinic.id);
    expect((await acceptInvitation(invitation.rawToken, PASSWORD)).outcome).toBe('accepted');
    expect(await acceptInvitation(invitation.rawToken, PASSWORD)).toEqual({ outcome: 'invalid' });
    expect(await staffFor(invitation.email)).toHaveLength(1);
  });

  it('treats an expired invitation as invalid and marks it expired', async () => {
    const clinic = await createTestClinic('FeatExpired');
    const invitation = await createTestInvitation(clinic.id, { createdHoursAgo: 73 });
    expect(await acceptInvitation(invitation.rawToken, PASSWORD)).toEqual({ outcome: 'invalid' });
    expect(await invitationStatus(invitation.id)).toBe('expired');
    expect(await staffFor(invitation.email)).toHaveLength(0);
  });

  it('treats an unknown well-formed token as invalid', async () => {
    expect(await acceptInvitation('B'.repeat(43), PASSWORD)).toEqual({ outcome: 'invalid' });
  });

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['non-base64url characters', `${'A'.repeat(42)}+`],
    ['padding', `${'A'.repeat(42)}=`],
    ['empty', ''],
    ['the SHA-256 hex of a token', 'a'.repeat(64)],
  ])(
    'treats a malformed token (%s) as invalid without hashing or a database call',
    async (_label, token) => {
      expect(await acceptInvitation(token, PASSWORD)).toEqual({ outcome: 'invalid' });
      expect(dbHelper).not.toHaveBeenCalled();
    },
  );

  it('returns email_taken when the email already has an account, leaving the invitation pending', async () => {
    const clinicA = await createTestClinic('FeatTakenA');
    const clinicB = await createTestClinic('FeatTakenB');
    const existing = await createTestStaffMember(clinicB.id, 'feat-taken');
    const invitation = await createTestInvitation(clinicA.id, { email: existing.email });

    expect(await acceptInvitation(invitation.rawToken, PASSWORD)).toEqual({
      outcome: 'email_taken',
    });
    expect(await invitationStatus(invitation.id)).toBe('pending');
    const staff = await staffFor(existing.email);
    expect(staff).toHaveLength(1);
    expect(staff[0]!.clinic_id).toBe(clinicB.id);
  });

  it('rejects a password outside 12–128 code points before any hashing or database call', async () => {
    const clinic = await createTestClinic('FeatPwPolicy');
    const invitation = await createTestInvitation(clinic.id);
    for (const password of ['a'.repeat(11), 'a'.repeat(129), '🔒'.repeat(11)]) {
      await expect(acceptInvitation(invitation.rawToken, password)).rejects.toThrow(
        InvalidNewPasswordError,
      );
    }
    expect(dbHelper).not.toHaveBeenCalled();
    expect(await invitationStatus(invitation.id)).toBe('pending');
  });

  it('accepts 12 and 128 code-point passwords, including astral-plane characters', async () => {
    const clinic = await createTestClinic('FeatPwBounds');
    for (const password of ['a'.repeat(12), 'b'.repeat(128), '🔒'.repeat(12)]) {
      const invitation = await createTestInvitation(clinic.id);
      expect((await acceptInvitation(invitation.rawToken, password)).outcome).toBe('accepted');
    }
  });

  it('accepts a staff invitation with its own role', async () => {
    const clinic = await createTestClinic('FeatStaffRole');
    const inviter = await createTestStaffMember(clinic.id, 'feat-inviter', { role: 'owner' });
    const invitation = await createTestInvitation(clinic.id, {
      role: 'receptionist',
      invitedBy: inviter.id,
    });
    expect((await acceptInvitation(invitation.rawToken, PASSWORD)).outcome).toBe('accepted');
    expect((await staffFor(invitation.email))[0]!.role).toBe('receptionist');
  });
});
