/**
 * Public entry point for the `auth` feature (roadmap P2-A: "Staff
 * Authentication + Session + Tenant Context"). Only this module — never
 * `./repository`, `./password`, or `./token` — is a valid import target for
 * other features or for `src/app/**` route/page code.
 *
 * Implements the sign-in flow, session validation, and sign-out flow from
 * docs/technical/04-auth-implementation.md, using the ADR-0012
 * (human-approved) SECURITY DEFINER bootstrap for the two pre-tenant-context
 * lookups and `withTenantContext` for every ordinary write, exactly as that
 * ADR requires.
 */
import { withTenantContext } from '@/lib/db';
import { hashPassword, verifyPassword, verifyDummyPassword } from './password';
import { generateSessionToken, hashSessionToken } from './token';
import {
  findStaffByEmail,
  findValidSessionByTokenHash,
  insertSession,
  revokeSessionById,
} from './repository';

export { hashPassword };

/** Cookie name pinned per ADR-0012 (Decision 6, human-approved). */
export const SESSION_COOKIE_NAME = 'session';

/** 7 days, pinned per ADR-0012 (Decision 4/5, human-approved). */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface AuthenticatedSession {
  staffId: string;
  clinicId: string;
  role: string;
}

/** The four roles from ADR-0004 — mirrors `staff_members.role`'s CHECK constraint. */
export type Role = 'owner' | 'admin' | 'practitioner' | 'receptionist';

/**
 * Thrown by `requireRole` when the session's role isn't in the allowed list.
 * Same shape as `InvalidCredentialsError` below: one generic message for
 * every case, so a caller can't learn which role they actually hold (or
 * which roles an endpoint would have accepted) from the error itself.
 */
export class ForbiddenRoleError extends Error {
  constructor() {
    super('Your role does not permit this action');
    this.name = 'ForbiddenRoleError';
  }
}

/**
 * Per `docs/technical/03-api-contracts.md`'s "role checks happen before the
 * handler's own logic, uniformly": call this first in a route handler with
 * the roles `docs/technical/03-api-contracts.md` lists for that endpoint.
 * Reads `session.role` — already resolved by `validateSession` from the
 * session cookie — and never any request input. Throws `ForbiddenRoleError`
 * (callers should map that to a `403`) rather than returning a boolean, so a
 * route can't accidentally ignore the result.
 *
 * This is an API-layer check only, per ADR-0006: it does not, and currently
 * cannot without a further ADR, have a database-level backstop (no distinct
 * Postgres role per staff role exists — see ADR-0006's "forecloses building
 * the request/database layer around Postgres roles... without a further ADR
 * superseding this one").
 */
export function requireRole(session: AuthenticatedSession, allowed: Role[]): void {
  if (!(allowed as readonly string[]).includes(session.role)) {
    throw new ForbiddenRoleError();
  }
}

export interface SignInResult {
  staffId: string;
  clinicId: string;
  role: string;
  /** Raw token — the caller sets this as the session cookie's value. Never persisted raw. */
  token: string;
}

/**
 * Thrown for every sign-in failure case (unknown email, wrong password,
 * deactivated account) with the same generic message — callers must not
 * construct a more specific error message from this, per
 * docs/technical/03-api-contracts.md's "same message either way" rule.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * docs/technical/04-auth-implementation.md's sign-in flow. Password
 * verification always runs — against the real hash if a staff row was
 * found, against a fixed dummy hash otherwise (ADR-0012 Decision 8,
 * human-approved) — so an unknown email and a wrong password take
 * comparably long. Deactivated status is checked only after a successful
 * password verification, so it can never be distinguished from a wrong
 * password by response content or timing.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const staff = await findStaffByEmail(email);

  if (!staff) {
    await verifyDummyPassword(password);
    throw new InvalidCredentialsError();
  }

  const passwordOk = await verifyPassword(staff.passwordHash, password);
  if (!passwordOk) {
    throw new InvalidCredentialsError();
  }

  if (staff.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  // clinic_id here comes from the bootstrap lookup above, never from any
  // client input — this INSERT itself runs through the ordinary tenant-scoped
  // path (ADR-0012's "return to normal RLS + withTenantContext immediately
  // after clinic resolution").
  await withTenantContext(staff.clinicId, (client) =>
    insertSession(client, {
      staffId: staff.staffId,
      clinicId: staff.clinicId,
      tokenHash,
      expiresAt,
    }),
  );

  return { staffId: staff.staffId, clinicId: staff.clinicId, role: staff.role, token };
}

/**
 * Resolves a session cookie's raw token to the authenticated identity, or
 * `null` if it's missing, malformed, expired, revoked, or belongs to a
 * deactivated staff member — every one of those cases is indistinguishable
 * from the caller's point of view (the underlying bootstrap function
 * already collapses them, see db/migrations/0007_auth_bootstrap_functions.sql).
 * This is the ONLY place `clinic_id` is trusted from — never a request
 * parameter (docs/technical/03-api-contracts.md).
 */
export async function validateSession(
  rawToken: string | undefined | null,
): Promise<AuthenticatedSession | null> {
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const session = await findValidSessionByTokenHash(tokenHash);
  if (!session) return null;

  return { staffId: session.staffId, clinicId: session.clinicId, role: session.role };
}

/**
 * Revokes the session identified by `rawToken`, if it is currently valid.
 * Returns `false` (no-op) for a missing, invalid, expired, or
 * already-revoked token — sign-out never needs to distinguish those cases
 * to the caller either.
 */
export async function signOut(rawToken: string | undefined | null): Promise<boolean> {
  if (!rawToken) return false;

  const tokenHash = hashSessionToken(rawToken);
  const session = await findValidSessionByTokenHash(tokenHash);
  if (!session) return false;

  await withTenantContext(session.clinicId, (client) =>
    revokeSessionById(client, session.sessionId),
  );
  return true;
}
