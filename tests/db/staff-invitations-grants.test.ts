import { describe, it, expect, afterAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

import { closePool, withTenantContext } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { acceptInvitation } from '@/features/invitations';
import { createTestClinic, createTestInvitation, createTestStaffMember } from '../fixtures';

/**
 * db/migrations/0017_staff_invitations_grants.sql (item 3; ADR-0023 decision 7;
 * Owner decision S2): app_user may read every invitations column except
 * token_hash, insert the five columns a new invitation sets, and change only
 * `status` — which, with 0016's trigger and constraints, can only mean
 * pending -> expired. Everything stays inside the session's clinic (RLS).
 */

function newTokenHash(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

function email(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function statusOf(id: string): Promise<string> {
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

afterAll(async () => {
  await closePool();
});

describe('app_user privileges on invitations (0017)', () => {
  it('can SELECT every column except token_hash', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ column_name: string; can: boolean }>(
        `SELECT a.attname AS column_name,
                has_column_privilege('app_user', 'invitations', a.attname, 'SELECT') AS can
         FROM pg_attribute a
         WHERE a.attrelid = 'invitations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attname`,
      );
      expect(Object.fromEntries(rows.map((row) => [row.column_name, row.can]))).toEqual({
        accepted_at: true,
        clinic_id: true,
        created_at: true,
        email: true,
        expires_at: true,
        id: true,
        invited_by: true,
        role: true,
        status: true,
        token_hash: false,
      });
    } finally {
      await admin.end();
    }
  });

  it('can INSERT only clinic_id, email, role, token_hash, invited_by and UPDATE only status; no DELETE', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ privilege: string; column_name: string }>(
        `SELECT privilege_type AS privilege, column_name
         FROM information_schema.column_privileges
         WHERE grantee = 'app_user' AND table_name = 'invitations'
           AND privilege_type IN ('INSERT', 'UPDATE')
         ORDER BY privilege_type, column_name`,
      );
      expect(rows.map((row) => `${row.privilege}.${row.column_name}`)).toEqual([
        'INSERT.clinic_id',
        'INSERT.email',
        'INSERT.invited_by',
        'INSERT.role',
        'INSERT.token_hash',
        'UPDATE.status',
      ]);
      const del = await admin.query(
        `SELECT has_table_privilege('app_user', 'invitations', 'DELETE') AS can`,
      );
      expect(del.rows[0]).toEqual({ can: false });
    } finally {
      await admin.end();
    }
  });

  it('cannot read token_hash, even in its own clinic', async () => {
    const clinic = await createTestClinic('GrantNoHash');
    await createTestInvitation(clinic.id);
    await expect(
      withTenantContext(clinic.id, (client) => client.query('SELECT token_hash FROM invitations')),
    ).rejects.toThrow(/permission denied for table invitations/);
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("SELECT id FROM invitations WHERE token_hash = repeat('a', 64)"),
      ),
    ).rejects.toThrow(/permission denied for table invitations/);
  });

  it('inserts a staff invitation in its own clinic, with the database defaults', async () => {
    const clinic = await createTestClinic('GrantInsert');
    const inviter = await createTestStaffMember(clinic.id, 'grant-inviter', { role: 'owner' });
    const token = newTokenHash();
    const inviteeEmail = email('grant-invitee');

    const row = await withTenantContext(clinic.id, async (client) => {
      const { rows } = await client.query<{
        id: string;
        status: string;
        hours: string;
      }>(
        `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by)
         VALUES ($1, $2, 'receptionist', $3, $4)
         RETURNING id, status, (extract(epoch FROM expires_at - created_at) / 3600)::text AS hours`,
        [clinic.id, inviteeEmail, token.hash, inviter.id],
      );
      return rows[0]!;
    });
    expect(row.status).toBe('pending');
    expect(Number(row.hours)).toBe(72);

    // The invitation it created is accepted through the normal path.
    expect(await acceptInvitation(token.raw, 'a long enough passphrase')).toEqual({
      outcome: 'accepted',
    });
  });

  it('cannot insert into another clinic (RLS WITH CHECK)', async () => {
    const own = await createTestClinic('GrantOwn');
    const other = await createTestClinic('GrantOther');
    // invited_by NULL with role owner satisfies every constraint, so the
    // tenant_isolation WITH CHECK is the only thing that can refuse this row.
    await expect(
      withTenantContext(own.id, (client) =>
        client.query(
          `INSERT INTO invitations (clinic_id, email, role, token_hash)
           VALUES ($1, $2, 'owner', $3)`,
          [other.id, email('cross'), newTokenHash().hash],
        ),
      ),
    ).rejects.toThrow(/new row violates row-level security policy for table "invitations"/);
  });

  it('cannot set columns outside the INSERT grant (status, expires_at, id)', async () => {
    const clinic = await createTestClinic('GrantInsertCols');
    const inviter = await createTestStaffMember(clinic.id, 'grant-cols', { role: 'owner' });
    for (const [column, value] of [
      ['status', "'accepted'"],
      ['expires_at', "now() + interval '30 days'"],
      ['id', 'gen_random_uuid()'],
    ] as const) {
      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query(
            `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by, ${column})
             VALUES ($1, $2, 'receptionist', $3, $4, ${value})`,
            [clinic.id, email('cols'), newTokenHash().hash, inviter.id],
          ),
        ),
      ).rejects.toThrow(/permission denied for table invitations/);
    }
  });

  it('sees only its own clinic’s invitations', async () => {
    const own = await createTestClinic('GrantSeeOwn');
    const other = await createTestClinic('GrantSeeOther');
    const mine = await createTestInvitation(own.id);
    await createTestInvitation(other.id);
    const ids = await withTenantContext(own.id, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM invitations');
      return rows.map((row) => row.id);
    });
    expect(ids).toEqual([mine.id]);
  });

  it('can cancel a pending invitation (pending -> expired), after which the link is invalid', async () => {
    const clinic = await createTestClinic('GrantCancel');
    const invitation = await createTestInvitation(clinic.id);
    await withTenantContext(clinic.id, (client) =>
      client.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [invitation.id]),
    );
    expect(await statusOf(invitation.id)).toBe('expired');
    expect(await acceptInvitation(invitation.rawToken, 'a long enough passphrase')).toEqual({
      outcome: 'invalid',
    });
  });

  it('cannot mark an invitation accepted (needs accepted_at, which it cannot write)', async () => {
    const clinic = await createTestClinic('GrantNoAccept');
    const invitation = await createTestInvitation(clinic.id);
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("UPDATE invitations SET status = 'accepted' WHERE id = $1", [invitation.id]),
      ),
    ).rejects.toThrow(/invitation_accepted_at_matches_status/);
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query(
          "UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = $1",
          [invitation.id],
        ),
      ),
    ).rejects.toThrow(/permission denied for table invitations/);
    expect(await statusOf(invitation.id)).toBe('pending');
  });

  it('cannot revive an expired or accepted invitation', async () => {
    const clinic = await createTestClinic('GrantNoRevive');
    const expired = await createTestInvitation(clinic.id);
    await withTenantContext(clinic.id, (client) =>
      client.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [expired.id]),
    );
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("UPDATE invitations SET status = 'pending' WHERE id = $1", [expired.id]),
      ),
    ).rejects.toThrow(/no longer pending/);

    const accepted = await createTestInvitation(clinic.id);
    await acceptInvitation(accepted.rawToken, 'a long enough passphrase');
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [accepted.id]),
      ),
    ).rejects.toThrow(/no longer pending/);
  });

  it('cannot update another clinic’s invitation (RLS hides it)', async () => {
    const own = await createTestClinic('GrantUpdOwn');
    const other = await createTestClinic('GrantUpdOther');
    const theirs = await createTestInvitation(other.id);
    const result = await withTenantContext(own.id, (client) =>
      client.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [theirs.id]),
    );
    expect(result.rowCount).toBe(0);
    expect(await statusOf(theirs.id)).toBe('pending');
  });

  it('cannot delete an invitation', async () => {
    const clinic = await createTestClinic('GrantNoDelete');
    const invitation = await createTestInvitation(clinic.id);
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query('DELETE FROM invitations WHERE id = $1', [invitation.id]),
      ),
    ).rejects.toThrow(/permission denied for table invitations/);
  });
});
