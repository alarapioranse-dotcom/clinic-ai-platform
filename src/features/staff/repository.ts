import { DatabaseError, type PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`.
 *
 * Every function here runs inside `withTenantContext`, so RLS (FORCE ROW
 * LEVEL SECURITY on both tables) limits every read and write to the
 * session's own clinic. No query names a clinic in a WHERE clause for
 * isolation; `clinic_id` is only written on INSERT, where the RLS WITH CHECK
 * refuses any other clinic.
 *
 * Column lists are explicit. `staff_members.password_hash` is never selected,
 * and `invitations.token_hash` is not even readable by app_user (0017).
 */

export interface StaffMemberRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}

export interface PendingInvitationRow {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export async function listActiveStaff(client: PoolClient): Promise<StaffMemberRow[]> {
  const { rows } = await client.query<{
    id: string;
    email: string;
    role: string;
    created_at: Date;
  }>(
    `SELECT id, email, role, created_at
       FROM staff_members
      WHERE status = 'active'
      ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }));
}

/** Pending invitations whose 72 hours have not yet passed. */
export async function listOpenInvitations(client: PoolClient): Promise<PendingInvitationRow[]> {
  const { rows } = await client.query<{
    id: string;
    email: string;
    role: string;
    invited_by: string | null;
    expires_at: Date;
    created_at: Date;
  }>(
    `SELECT id, email, role, invited_by, expires_at, created_at
       FROM invitations
      WHERE status = 'pending' AND expires_at > now()
      ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/** Any staff member of this clinic (active or deactivated) with this email. */
export async function staffEmailExists(client: PoolClient, email: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM staff_members WHERE email = $1', [email]);
  return rows.length > 0;
}

/**
 * Marks this clinic's pending invitations for `email` whose 72 hours have
 * passed as `expired`, so the partial unique index
 * `invitations_one_pending_per_email` no longer blocks a fresh invitation.
 * The 0016 trigger allows only pending -> expired here.
 */
export async function retireTimedOutInvitations(client: PoolClient, email: string): Promise<void> {
  await client.query(
    `UPDATE invitations
        SET status = 'expired'
      WHERE email = $1 AND status = 'pending' AND expires_at <= now()`,
    [email],
  );
}

export async function openInvitationExists(client: PoolClient, email: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM invitations WHERE email = $1 AND status = 'pending' AND expires_at > now()`,
    [email],
  );
  return rows.length > 0;
}

/** A concurrent request created a pending invitation for the same email first. */
export class PendingInvitationConflictError extends Error {
  constructor() {
    super('A pending invitation for this email already exists.');
    this.name = 'PendingInvitationConflictError';
  }
}

/**
 * Inserts only the five columns 0017 grants; id, status, expires_at and
 * created_at come from the database. `tokenHash` is the SHA-256 hex digest —
 * never the raw token.
 */
export async function insertInvitation(
  client: PoolClient,
  params: { clinicId: string; email: string; role: string; tokenHash: string; invitedBy: string },
): Promise<{ id: string; expiresAt: Date }> {
  try {
    const { rows } = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at`,
      [params.clinicId, params.email, params.role, params.tokenHash, params.invitedBy],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Insert into invitations returned no row');
    }
    return { id: row.id, expiresAt: row.expires_at };
  } catch (err) {
    if (
      err instanceof DatabaseError &&
      err.code === '23505' &&
      err.constraint === 'invitations_one_pending_per_email'
    ) {
      throw new PendingInvitationConflictError();
    }
    throw err;
  }
}

/** This clinic's pending invitation `id`, locked for update, or null. */
export async function findPendingInvitationForUpdate(
  client: PoolClient,
  id: string,
): Promise<{ id: string; role: string } | null> {
  const { rows } = await client.query<{ id: string; role: string }>(
    `SELECT id, role FROM invitations WHERE id = $1 AND status = 'pending' FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** pending -> expired; the only change app_user can make (0016 trigger + 0017 grant). */
export async function expireInvitation(client: PoolClient, id: string): Promise<void> {
  await client.query(`UPDATE invitations SET status = 'expired' WHERE id = $1`, [id]);
}
