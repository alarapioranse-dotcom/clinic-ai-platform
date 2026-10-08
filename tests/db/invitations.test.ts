import { describe, it, expect, afterAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

import { closePool, withTenantContext } from '@/lib/db';
import { getAppDatabaseUrl, getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestStaffMember } from '../fixtures';

/**
 * Database coverage for db/migrations/0016_invitations.sql (ADR-0023,
 * Accepted; Owner Gate 1 decisions E1–E6). Runs against real PostgreSQL:
 * storage of the token hash only, the acceptance function's outcomes,
 * single use under concurrency, RLS + FORCE RLS, and the acceptance
 * function's privilege boundary.
 */

const ARGON2_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g';

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

function uniqueEmail(label: string): string {
  return `${label.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

async function withAppUser<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getAppDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface InvitationOptions {
  role?: 'owner' | 'admin' | 'practitioner' | 'receptionist';
  invitedBy?: string | null;
  email?: string;
  /** Hours before now the invitation was created (73 makes it already expired). */
  createdHoursAgo?: number;
}

/** Inserts an invitation over the owner connection, under the clinic's own tenant context. */
async function insertInvitation(
  clinicId: string,
  tokenHash: string,
  options: InvitationOptions = {},
): Promise<{ id: string; email: string }> {
  const email = options.email ?? uniqueEmail('invitee');
  const createdHoursAgo = options.createdHoursAgo ?? 0;
  return withAdmin(async (admin) => {
    await admin.query('BEGIN');
    try {
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5,
                 now() - make_interval(hours => $6::int),
                 now() - make_interval(hours => $6::int) + interval '72 hours')
         RETURNING id`,
        [
          clinicId,
          email,
          options.role ?? 'owner',
          tokenHash,
          options.invitedBy ?? null,
          createdHoursAgo,
        ],
      );
      await admin.query('COMMIT');
      return { id: rows[0]!.id, email };
    } catch (err) {
      await admin.query('ROLLBACK');
      throw err;
    }
  });
}

interface InvitationRow {
  status: string;
  accepted_at: Date | null;
}

async function readInvitation(id: string): Promise<InvitationRow> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<InvitationRow>(
      'SELECT status, accepted_at FROM invitations WHERE id = $1',
      [id],
    );
    return rows[0]!;
  });
}

async function staffRowsForEmail(
  email: string,
): Promise<
  { id: string; clinic_id: string; role: string; status: string; password_hash: string }[]
> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query(
      'SELECT id, clinic_id, role, status, password_hash FROM staff_members WHERE email = $1',
      [email],
    );
    return rows;
  });
}

interface AcceptResult {
  outcome: string;
  staff_id: string | null;
  clinic_id: string | null;
  role: string | null;
}

/** Calls the function as app_user, the way the application will, in its own transaction. */
async function accept(tokenHash: string | null, passwordHash = ARGON2_HASH): Promise<AcceptResult> {
  return withAppUser(async (client) => {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query<AcceptResult>('SELECT * FROM accept_invitation($1, $2)', [
        tokenHash,
        passwordHash,
      ]);
      await client.query('COMMIT');
      return rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

afterAll(async () => {
  await closePool();
});

describe('invitations table (0016)', () => {
  it('has no column that could hold a raw token; token_hash is the only secret-derived column', async () => {
    const columns = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'invitations' ORDER BY column_name`,
      );
      return rows.map((row) => row.column_name);
    });
    expect(columns).toEqual([
      'accepted_at',
      'clinic_id',
      'created_at',
      'email',
      'expires_at',
      'id',
      'invited_by',
      'role',
      'status',
      'token_hash',
    ]);
  });

  it('stores exactly the SHA-256 hex digest of the token, never the token', async () => {
    const clinic = await createTestClinic('InvHashOnly');
    const token = newToken();
    const { id } = await insertInvitation(clinic.id, token.hash);
    const stored = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ token_hash: string; row_text: string }>(
        'SELECT token_hash, i::text AS row_text FROM invitations i WHERE id = $1',
        [id],
      );
      return rows[0]!;
    });
    expect(stored.token_hash).toBe(token.hash);
    expect(stored.row_text).not.toContain(token.raw);
  });

  it.each([
    ['the raw base64url token', randomBytes(32).toString('base64url')],
    ['uppercase hex', 'A'.repeat(64)],
    ['63 hex chars', 'a'.repeat(63)],
    ['65 hex chars', 'a'.repeat(65)],
  ])('rejects %s as token_hash', async (_label, value) => {
    const clinic = await createTestClinic('InvBadHash');
    await expect(insertInvitation(clinic.id, value)).rejects.toThrow(
      /invitation_token_hash_is_sha256_hex/,
    );
  });

  it('rejects a duplicate token_hash', async () => {
    const clinic = await createTestClinic('InvDupHash');
    const token = newToken();
    await insertInvitation(clinic.id, token.hash);
    await expect(insertInvitation(clinic.id, token.hash)).rejects.toThrow(
      /invitations_token_hash_key/,
    );
  });

  it.each([
    ['uppercase letters', 'Owner@Clinic.test'],
    ['leading whitespace', ' owner@clinic.test'],
    ['trailing whitespace', 'owner@clinic.test '],
  ])('rejects an email with %s (E1)', async (_label, email) => {
    const clinic = await createTestClinic('InvEmailNorm');
    await expect(insertInvitation(clinic.id, newToken().hash, { email })).rejects.toThrow(
      /invitation_email_is_normalized/,
    );
  });

  it('defaults expires_at to exactly 72 hours after created_at and rejects any other window', async () => {
    const clinic = await createTestClinic('InvExpiry');
    const window = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      const { rows } = await admin.query<{ hours: number }>(
        `INSERT INTO invitations (clinic_id, email, role, token_hash)
         VALUES ($1, $2, 'owner', $3)
         RETURNING extract(epoch FROM expires_at - created_at) / 3600 AS hours`,
        [clinic.id, uniqueEmail('expiry'), newToken().hash],
      );
      await admin.query('COMMIT');
      return Number(rows[0]!.hours);
    });
    expect(window).toBe(72);

    await expect(
      withAdmin(async (admin) => {
        await admin.query('BEGIN');
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
        try {
          await admin.query(
            `INSERT INTO invitations (clinic_id, email, role, token_hash, expires_at)
             VALUES ($1, $2, 'owner', $3, now() + interval '30 days')`,
            [clinic.id, uniqueEmail('expiry'), newToken().hash],
          );
        } finally {
          await admin.query('ROLLBACK');
        }
      }),
    ).rejects.toThrow(/invitation_expires_72h_after_creation/);
  });

  it('allows at most one pending invitation per clinic and email', async () => {
    const clinic = await createTestClinic('InvOnePending');
    const email = uniqueEmail('pending');
    await insertInvitation(clinic.id, newToken().hash, { email });
    await expect(insertInvitation(clinic.id, newToken().hash, { email })).rejects.toThrow(
      /invitations_one_pending_per_email/,
    );
  });

  it('rejects a role outside the four staff roles', async () => {
    const clinic = await createTestClinic('InvBadRole');
    // A valid inviter, so the role check is the only constraint this row violates.
    const inviter = await createTestStaffMember(clinic.id, 'role-inviter', { role: 'owner' });
    await expect(
      insertInvitation(clinic.id, newToken().hash, {
        role: 'superadmin' as unknown as 'owner',
        invitedBy: inviter.id,
      }),
    ).rejects.toThrow(/invitations_role_check/);
  });

  it('requires an inviter for every role except owner', async () => {
    const clinic = await createTestClinic('InvInviter');
    for (const role of ['admin', 'practitioner', 'receptionist'] as const) {
      await expect(
        insertInvitation(clinic.id, newToken().hash, { role, invitedBy: null }),
      ).rejects.toThrow(/invitation_inviter_required_unless_owner/);
    }
    const inviter = await createTestStaffMember(clinic.id, 'inviter', { role: 'owner' });
    await expect(
      insertInvitation(clinic.id, newToken().hash, { role: 'receptionist', invitedBy: inviter.id }),
    ).resolves.toBeDefined();
  });

  it('rejects an inviter from a different clinic', async () => {
    const clinicA = await createTestClinic('InvInviterA');
    const clinicB = await createTestClinic('InvInviterB');
    const foreignInviter = await createTestStaffMember(clinicB.id, 'foreign', { role: 'owner' });
    await expect(
      insertInvitation(clinicA.id, newToken().hash, {
        role: 'admin',
        invitedBy: foreignInviter.id,
      }),
    ).rejects.toThrow(/invitations_invited_by_same_clinic_fkey/);
  });

  it('requires accepted_at exactly when status is accepted', async () => {
    const clinic = await createTestClinic('InvAcceptedAt');
    const { id } = await insertInvitation(clinic.id, newToken().hash);
    await expect(
      withAdmin((admin) =>
        admin.query("UPDATE invitations SET status = 'accepted' WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/invitation_accepted_at_matches_status/);
    await expect(
      withAdmin((admin) =>
        admin.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [id]),
      ),
    ).rejects.toThrow(/invitation_accepted_at_matches_status/);
  });

  it('never lets an accepted or expired invitation change again, even for the table owner', async () => {
    const clinic = await createTestClinic('InvGuard');
    const token = newToken();
    const { id } = await insertInvitation(clinic.id, token.hash);
    expect((await accept(token.hash)).outcome).toBe('accepted');

    await expect(
      withAdmin((admin) =>
        admin.query("UPDATE invitations SET status = 'pending', accepted_at = NULL WHERE id = $1", [
          id,
        ]),
      ),
    ).rejects.toThrow(/no longer pending/);

    const expired = newToken();
    const { id: expiredId } = await insertInvitation(clinic.id, expired.hash, {
      email: uniqueEmail('guard-expired'),
    });
    await withAdmin((admin) =>
      admin.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [expiredId]),
    );
    await expect(
      withAdmin((admin) =>
        admin.query("UPDATE invitations SET status = 'pending' WHERE id = $1", [expiredId]),
      ),
    ).rejects.toThrow(/no longer pending/);
  });

  it('never lets the identity fields of a pending invitation change', async () => {
    const clinic = await createTestClinic('InvImmutable');
    const { id } = await insertInvitation(clinic.id, newToken().hash);
    for (const assignment of [
      `email = 'other@example.test'`,
      `role = 'admin'`,
      `token_hash = '${'b'.repeat(64)}'`,
      `expires_at = expires_at + interval '1 day', created_at = created_at + interval '1 day'`,
    ]) {
      await expect(
        withAdmin((admin) =>
          admin.query(`UPDATE invitations SET ${assignment} WHERE id = $1`, [id]),
        ),
      ).rejects.toThrow(/immutable/);
    }
  });

  it('has RLS enabled and forced, with tenant_isolation and the two acceptor-only policies', async () => {
    await withAdmin(async (admin) => {
      const flags = await admin.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'invitations'`,
      );
      expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

      const { rows } = await admin.query<{
        policyname: string;
        cmd: string;
        roles: string;
        qual: string;
        with_check: string | null;
      }>(
        `SELECT policyname, cmd, roles::text AS roles, qual, with_check
         FROM pg_policies WHERE tablename = 'invitations' ORDER BY policyname`,
      );
      expect(rows.map((row) => [row.policyname, row.cmd, row.roles])).toEqual([
        ['invitation_acceptor_select', 'SELECT', '{invitation_acceptor}'],
        ['invitation_acceptor_update', 'UPDATE', '{invitation_acceptor}'],
        ['tenant_isolation', 'ALL', '{public}'],
      ]);
      const tenant = rows.find((row) => row.policyname === 'tenant_isolation')!;
      expect(tenant.qual).toContain("current_setting('app.current_clinic_id'::text, true)");
      expect(tenant.with_check).toContain("current_setting('app.current_clinic_id'::text, true)");
    });
  });

  it('rejects writing another clinic’s invitation under a tenant context (FORCE RLS, non-bypass role)', async () => {
    const clinicA = await createTestClinic('InvRlsA');
    const clinicB = await createTestClinic('InvRlsB');
    const scratchRole = `test_inv_writer_${randomUUID().replace(/-/g, '_')}`;
    await withAdmin(async (admin) => {
      await admin.query(`CREATE ROLE ${scratchRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await admin.query(`GRANT SELECT, INSERT ON invitations TO ${scratchRole}`);
      try {
        await admin.query('BEGIN');
        await admin.query(`SET LOCAL ROLE ${scratchRole}`);
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicA.id]);
        await expect(
          admin.query(
            `INSERT INTO invitations (clinic_id, email, role, token_hash) VALUES ($1, $2, 'owner', $3)`,
            [clinicB.id, uniqueEmail('rls'), newToken().hash],
          ),
        ).rejects.toThrow(/row-level security/);
        await admin.query('ROLLBACK');
      } finally {
        await admin.query(`REVOKE ALL ON invitations FROM ${scratchRole}`);
        await admin.query(`DROP ROLE ${scratchRole}`);
      }
    });
  });
});

describe('app_user and invitations (E3)', () => {
  it('holds no privilege on the invitations table at all', async () => {
    await withAppUser(async (client) => {
      const { rows } = await client.query(
        `SELECT has_table_privilege('invitations', 'SELECT') AS sel,
                has_table_privilege('invitations', 'INSERT') AS ins,
                has_table_privilege('invitations', 'UPDATE') AS upd,
                has_table_privilege('invitations', 'DELETE') AS del,
                has_any_column_privilege('invitations', 'SELECT') AS col_sel,
                has_any_column_privilege('invitations', 'UPDATE') AS col_upd`,
      );
      expect(rows[0]).toEqual({
        sel: false,
        ins: false,
        upd: false,
        del: false,
        col_sel: false,
        col_upd: false,
      });
    });
  });

  it('cannot read any invitation, with or without a tenant context', async () => {
    const clinic = await createTestClinic('InvAppRead');
    await insertInvitation(clinic.id, newToken().hash);
    await expect(
      withTenantContext(clinic.id, (client) => client.query('SELECT * FROM invitations')),
    ).rejects.toThrow(/permission denied for table invitations/);
    // A fresh connection, so no emptied context from an earlier pooled
    // transaction is present: the failure is the missing privilege itself.
    await expect(
      withAppUser((client) => client.query('SELECT * FROM invitations')),
    ).rejects.toThrow(/permission denied for table invitations/);
  });
});

describe('accept_invitation (ADR-0023)', () => {
  it('creates exactly one active staff member with the invitation’s clinic, email and role', async () => {
    const clinic = await createTestClinic('AccOk');
    const token = newToken();
    const { id, email } = await insertInvitation(clinic.id, token.hash);

    const result = await accept(token.hash);
    expect(result.outcome).toBe('accepted');
    expect(result.clinic_id).toBe(clinic.id);
    expect(result.role).toBe('owner');
    expect(Object.keys(result).sort()).toEqual(['clinic_id', 'outcome', 'role', 'staff_id']);

    const staff = await staffRowsForEmail(email);
    expect(staff).toEqual([
      {
        id: result.staff_id,
        clinic_id: clinic.id,
        role: 'owner',
        status: 'active',
        password_hash: ARGON2_HASH,
      },
    ]);

    const invitation = await readInvitation(id);
    expect(invitation.status).toBe('accepted');
    expect(invitation.accepted_at).toBeInstanceOf(Date);
  });

  it('accepts a staff invitation with its own role', async () => {
    const clinic = await createTestClinic('AccStaff');
    const inviter = await createTestStaffMember(clinic.id, 'acc-inviter', { role: 'owner' });
    const token = newToken();
    const { email } = await insertInvitation(clinic.id, token.hash, {
      role: 'receptionist',
      invitedBy: inviter.id,
    });
    const result = await accept(token.hash);
    expect(result).toMatchObject({ outcome: 'accepted', role: 'receptionist' });
    expect((await staffRowsForEmail(email))[0]?.role).toBe('receptionist');
  });

  it('is single use: a second acceptance is invalid and creates nothing', async () => {
    const clinic = await createTestClinic('AccTwice');
    const token = newToken();
    const { email } = await insertInvitation(clinic.id, token.hash);
    expect((await accept(token.hash)).outcome).toBe('accepted');
    expect(await accept(token.hash)).toEqual({
      outcome: 'invalid',
      staff_id: null,
      clinic_id: null,
      role: null,
    });
    expect(await staffRowsForEmail(email)).toHaveLength(1);
  });

  it('rejects an expired invitation as invalid, marks it expired, and creates nothing', async () => {
    const clinic = await createTestClinic('AccExpired');
    const token = newToken();
    const { id, email } = await insertInvitation(clinic.id, token.hash, { createdHoursAgo: 73 });
    expect((await accept(token.hash)).outcome).toBe('invalid');
    expect((await readInvitation(id)).status).toBe('expired');
    expect(await staffRowsForEmail(email)).toHaveLength(0);
    expect((await accept(token.hash)).outcome).toBe('invalid');
  });

  it.each([
    ['an unknown well-formed hash', () => newToken().hash],
    ['the raw token instead of its hash', () => randomBytes(32).toString('base64url')],
    ['uppercase hex', () => newToken().hash.toUpperCase()],
    ['an empty string', () => ''],
    ['NULL', () => null],
    ['a SQL-looking string', () => "' OR '1'='1"],
  ])('returns the same invalid outcome for %s', async (_label, makeHash) => {
    expect(await accept(makeHash())).toEqual({
      outcome: 'invalid',
      staff_id: null,
      clinic_id: null,
      role: null,
    });
  });

  it('cannot be accepted with the raw token even when the invitation exists', async () => {
    const clinic = await createTestClinic('AccRawToken');
    const token = newToken();
    const { id } = await insertInvitation(clinic.id, token.hash);
    expect((await accept(token.raw)).outcome).toBe('invalid');
    expect((await readInvitation(id)).status).toBe('pending');
  });

  it('returns email_taken when the email already belongs to a staff member, and leaves the invitation pending', async () => {
    const clinicA = await createTestClinic('AccTakenA');
    const clinicB = await createTestClinic('AccTakenB');
    const existing = await createTestStaffMember(clinicB.id, 'taken', {
      email: uniqueEmail('taken'),
    });
    const token = newToken();
    const { id } = await insertInvitation(clinicA.id, token.hash, { email: existing.email });

    expect(await accept(token.hash)).toEqual({
      outcome: 'email_taken',
      staff_id: null,
      clinic_id: null,
      role: null,
    });
    expect((await readInvitation(id)).status).toBe('pending');
    const staff = await staffRowsForEmail(existing.email);
    expect(staff).toHaveLength(1);
    expect(staff[0]?.clinic_id).toBe(clinicB.id);
  });

  it.each([
    ['a plaintext password', 'Correct-Horse-Battery-Staple-1!'],
    ['a bcrypt hash', '$2b$12$abcdefghijklmnopqrstuuK5bCzIu0lmJmQ6Gq9QxW2X6u5nV7e8a'],
    ['an argon2i hash', '$argon2i$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA'],
    ['an empty string', ''],
  ])('refuses %s as the password hash and changes nothing (E2)', async (_label, passwordHash) => {
    const clinic = await createTestClinic('AccPwHash');
    const token = newToken();
    const { id, email } = await insertInvitation(clinic.id, token.hash);
    await expect(accept(token.hash, passwordHash)).rejects.toThrow(/Argon2id/);
    expect((await readInvitation(id)).status).toBe('pending');
    expect(await staffRowsForEmail(email)).toHaveLength(0);
  });

  it('creates the staff member in the invitation’s clinic even when the caller set another clinic’s context', async () => {
    const own = await createTestClinic('AccCtxOwn');
    const other = await createTestClinic('AccCtxOther');
    const token = newToken();
    const { email } = await insertInvitation(own.id, token.hash);

    const result = await withTenantContext(other.id, async (client) => {
      const { rows } = await client.query<AcceptResult>('SELECT * FROM accept_invitation($1, $2)', [
        token.hash,
        ARGON2_HASH,
      ]);
      const after = await client.query<{ ctx: string }>(
        "SELECT current_setting('app.current_clinic_id', true) AS ctx",
      );
      return { row: rows[0]!, ctx: after.rows[0]!.ctx };
    });

    expect(result.row).toMatchObject({ outcome: 'accepted', clinic_id: own.id });
    expect(result.ctx).toBe('');
    expect((await staffRowsForEmail(email))[0]?.clinic_id).toBe(own.id);
  });

  it('works on a pooled connection whose clinic context was previously set and reset', async () => {
    const clinic = await createTestClinic('AccPooled');
    const token = newToken();
    await insertInvitation(clinic.id, token.hash);
    const result = await withAppUser(async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      await client.query('COMMIT');
      const { rows } = await client.query<AcceptResult>('SELECT * FROM accept_invitation($1, $2)', [
        token.hash,
        ARGON2_HASH,
      ]);
      return rows[0]!;
    });
    expect(result.outcome).toBe('accepted');
  });

  it('two concurrent acceptances of one token create exactly one staff member', async () => {
    const clinic = await createTestClinic('AccRace');
    const token = newToken();
    const { email } = await insertInvitation(clinic.id, token.hash);

    const first = new Client({ connectionString: getAppDatabaseUrl() });
    const second = new Client({ connectionString: getAppDatabaseUrl() });
    await first.connect();
    await second.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      const firstResult = await first.query<AcceptResult>(
        'SELECT * FROM accept_invitation($1, $2)',
        [token.hash, ARGON2_HASH],
      );

      let secondSettled = false;
      const secondPromise = second
        .query<AcceptResult>('SELECT * FROM accept_invitation($1, $2)', [token.hash, ARGON2_HASH])
        .finally(() => {
          secondSettled = true;
        });

      // The second call must be blocked on the first one's row lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondSettled).toBe(false);

      await first.query('COMMIT');
      const secondResult = await secondPromise;
      await second.query('COMMIT');

      expect(firstResult.rows[0]?.outcome).toBe('accepted');
      expect(secondResult.rows[0]?.outcome).toBe('invalid');
      expect(await staffRowsForEmail(email)).toHaveLength(1);
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('two concurrent acceptances for the same email at different clinics create one staff member', async () => {
    const clinicA = await createTestClinic('AccRaceEmailA');
    const clinicB = await createTestClinic('AccRaceEmailB');
    const email = uniqueEmail('race-email');
    const tokenA = newToken();
    const tokenB = newToken();
    await insertInvitation(clinicA.id, tokenA.hash, { email });
    await insertInvitation(clinicB.id, tokenB.hash, { email });

    const outcomes = (await Promise.all([accept(tokenA.hash), accept(tokenB.hash)]))
      .map((result) => result.outcome)
      .sort();
    expect(outcomes).toEqual(['accepted', 'email_taken']);
    expect(await staffRowsForEmail(email)).toHaveLength(1);
  });
});

describe('accept_invitation privilege boundary', () => {
  it('only app_user can execute it; PUBLIC cannot', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('public', 'accept_invitation(text,text)', 'EXECUTE') AS public_exec,
                has_function_privilege('app_user', 'accept_invitation(text,text)', 'EXECUTE') AS app_exec`,
      );
      expect(rows[0]).toEqual({ public_exec: false, app_exec: true });
    });
  });

  it('is SECURITY DEFINER, plpgsql, with a pinned search_path, owned by invitation_acceptor, and takes exactly (text, text)', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT p.oid::regprocedure::text AS signature, p.prosecdef, l.lanname AS lang,
                p.proconfig, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.proname = 'accept_invitation'`,
      );
      expect(rows).toEqual([
        {
          signature: 'accept_invitation(text,text)',
          prosecdef: true,
          lang: 'plpgsql',
          proconfig: ['search_path=public, pg_catalog'],
          owner: 'invitation_acceptor',
        },
      ]);
    });
  });

  it('contains no dynamic SQL', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ src: string }>(
        `SELECT prosrc AS src FROM pg_proc WHERE proname = 'accept_invitation'`,
      );
      const body = rows[0]!.src.replace(/--[^\n]*/g, '');
      expect(body).not.toMatch(/\bEXECUTE\b/i);
      expect(body).not.toMatch(/\bformat\s*\(/i);
    });
  });

  it('its owner role is NOLOGIN, not SUPERUSER and not BYPASSRLS', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'invitation_acceptor'`,
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcanlogin: false }]);
    });
  });

  it('its owner role holds only the column privileges the function needs', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query<{
        table_name: string;
        privilege: string;
        column_name: string;
      }>(
        `SELECT table_name, privilege_type AS privilege, column_name
         FROM information_schema.column_privileges
         WHERE grantee = 'invitation_acceptor'
         ORDER BY table_name, privilege_type, column_name`,
      );
      expect(rows.map((row) => `${row.table_name}.${row.privilege}.${row.column_name}`)).toEqual([
        'invitations.SELECT.clinic_id',
        'invitations.SELECT.email',
        'invitations.SELECT.expires_at',
        'invitations.SELECT.id',
        'invitations.SELECT.role',
        'invitations.SELECT.status',
        'invitations.SELECT.token_hash',
        'invitations.UPDATE.accepted_at',
        'invitations.UPDATE.status',
        'staff_members.INSERT.clinic_id',
        'staff_members.INSERT.email',
        'staff_members.INSERT.id',
        'staff_members.INSERT.password_hash',
        'staff_members.INSERT.role',
        'staff_members.INSERT.status',
      ]);

      const tableWide = await admin.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.table_privileges
         WHERE grantee = 'invitation_acceptor'`,
      );
      expect(tableWide.rows).toEqual([]);
    });
  });

  it('its owner role has row-level policies on invitations only', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ tablename: string }>(
        `SELECT DISTINCT tablename FROM pg_policies
         WHERE 'invitation_acceptor' = ANY (roles)`,
      );
      expect(rows.map((row) => row.tablename)).toEqual(['invitations']);
    });
  });

  it('leaves the ADR-0012 bootstrap functions exactly as they were', async () => {
    await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
         FROM pg_proc p
         WHERE p.proname IN ('auth_lookup_staff_by_email', 'auth_lookup_session_by_token_hash')
         ORDER BY p.proname`,
      );
      expect(rows).toEqual([
        { proname: 'auth_lookup_session_by_token_hash', owner: 'auth_bootstrap', prosecdef: true },
        { proname: 'auth_lookup_staff_by_email', owner: 'auth_bootstrap', prosecdef: true },
      ]);
      const policies = await admin.query<{ tablename: string }>(
        `SELECT tablename FROM pg_policies WHERE 'auth_bootstrap' = ANY (roles) ORDER BY tablename`,
      );
      expect(policies.rows.map((row) => row.tablename)).toEqual([
        'staff_members',
        'staff_sessions',
      ]);
    });
  });
});
