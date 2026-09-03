import type { PoolClient } from 'pg';
import { lookupStaffByEmailForAuth, lookupSessionByTokenHashForAuth } from '@/lib/db';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing
 * outside `src/features/auth/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 */

export interface StaffAuthRecord {
  staffId: string;
  clinicId: string;
  role: string;
  status: string;
  passwordHash: string;
}

/**
 * The pre-tenant-context lookup sign-in needs — delegates entirely to the
 * ADR-0012 bootstrap function in src/lib/db.ts; this module adds no
 * additional database access of its own for this step.
 */
export async function findStaffByEmail(email: string): Promise<StaffAuthRecord | null> {
  const row = await lookupStaffByEmailForAuth(email);
  if (!row) return null;
  return {
    staffId: row.staff_id,
    clinicId: row.clinic_id,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
  };
}

export interface SessionAuthRecord {
  sessionId: string;
  staffId: string;
  clinicId: string;
  role: string;
}

/**
 * The pre-tenant-context lookup every authenticated request needs. The
 * underlying SECURITY DEFINER function already excludes expired, revoked,
 * and deactivated-staff sessions (db/migrations/0007_auth_bootstrap_functions.sql)
 * — a row coming back here is always currently valid.
 */
export async function findValidSessionByTokenHash(
  tokenHash: string,
): Promise<SessionAuthRecord | null> {
  const row = await lookupSessionByTokenHashForAuth(tokenHash);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    staffId: row.staff_id,
    clinicId: row.clinic_id,
    role: row.role,
  };
}

/**
 * Ordinary tenant-scoped write, run inside `withTenantContext(clinicId, ...)`
 * once `clinicId` is already known from `findStaffByEmail` above — not part
 * of the bootstrap bypass.
 */
export async function insertSession(
  client: PoolClient,
  params: { staffId: string; clinicId: string; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [params.staffId, params.clinicId, params.tokenHash, params.expiresAt],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Insert into staff_sessions returned no row');
  }
  return row.id;
}

/** Ordinary tenant-scoped write, run inside `withTenantContext(clinicId, ...)`. */
export async function revokeSessionById(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(`UPDATE staff_sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
}
