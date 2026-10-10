/**
 * Public entry point for the `staff` feature. Only this module — never
 * `./repository` or `./policy` — is a valid import target for other features
 * or for `src/app/**` route/page code.
 *
 * Scope (item 3 PR B; ADR-0023 decision 7; Owner decisions T1–T3): an owner
 * or admin lists their clinic's active staff and open invitations, issues a
 * one-time staff invitation, and cancels a pending one. Accepting an
 * invitation is the `invitations` feature (`/invite`), unchanged here.
 * Deactivating staff or changing roles (`PATCH /api/staff/:id`) is out of
 * scope.
 *
 * Everything runs inside `withTenantContext(session.clinicId, …)`: RLS keeps
 * every read and write inside the caller's clinic, `invited_by` always comes
 * from the session, and the database's own constraints (0016, 0017) back the
 * role rule up. The raw invitation token exists only in memory: its SHA-256
 * is stored, and the link is returned once to the caller and never logged.
 */
import { withTenantContext } from '@/lib/db';
import {
  buildInvitationLink,
  generateInvitationToken,
  hashInvitationToken,
} from '@/features/invitations';
import {
  STAFF_MANAGER_ROLES,
  canManageInvitationFor,
  invitableRoles,
  isStaffRole,
  type StaffRole,
} from './policy';
import {
  PendingInvitationConflictError,
  expireInvitation,
  findPendingInvitationForUpdate,
  insertInvitation,
  listActiveStaff,
  listOpenInvitations,
  openInvitationExists,
  retireTimedOutInvitations,
  staffEmailExists,
} from './repository';

export { STAFF_MANAGER_ROLES, invitableRoles, canManageInvitationFor };
export type { StaffRole };

/** The caller, as resolved from a validated session — never from request input. */
export interface StaffManager {
  staffId: string;
  clinicId: string;
  role: string;
}

export interface StaffMemberSummary {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface StaffOverview {
  staff: StaffMemberSummary[];
  invitations: InvitationSummary[];
}

/** Request body did not describe a valid invitation (bad email or unknown role). */
export class InvalidInvitationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInvitationRequestError';
  }
}

/** The caller's role may not invite (or cancel an invitation for) that role. */
export class RoleNotInvitableError extends Error {
  constructor() {
    super('Your role does not permit inviting this role.');
    this.name = 'RoleNotInvitableError';
  }
}

/** The email is already a staff member of this clinic or has an open invitation. */
export class AlreadyInvitedError extends Error {
  constructor() {
    super('This email is already a staff member or already has a pending invitation.');
    this.name = 'AlreadyInvitedError';
  }
}

/** No pending invitation with that id in the caller's clinic. */
export class InvitationNotFoundError extends Error {
  constructor() {
    super('Invitation not found.');
    this.name = 'InvitationNotFoundError';
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** Trims and lowercases (Owner decision E1; required by `invitation_email_is_normalized`). */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface ParsedInvitationRequest {
  email: string;
  role: StaffRole;
}

/**
 * Validates a `POST /api/staff/invitations` body shape: `email` a plausible
 * address (normalized), `role` one of the four roles. Whether the caller may
 * invite that role is a separate check (`RoleNotInvitableError`).
 */
export function parseInvitationRequest(body: unknown): ParsedInvitationRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidInvitationRequestError('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'email' && key !== 'role') {
      throw new InvalidInvitationRequestError(`"${key}" is not allowed. Allowed: email, role.`);
    }
  }
  if (typeof record.email !== 'string' || typeof record.role !== 'string') {
    throw new InvalidInvitationRequestError('email and role are required strings.');
  }
  const email = normalizeEmail(record.email);
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvalidInvitationRequestError('email must be a valid email address.');
  }
  if (!isStaffRole(record.role)) {
    throw new InvalidInvitationRequestError(
      'role must be one of: owner, admin, practitioner, receptionist.',
    );
  }
  return { email, role: record.role };
}

function toIso(value: Date): string {
  return value.toISOString();
}

/** Active staff and open (pending, not yet timed-out) invitations of the caller's clinic. */
export async function getStaffOverview(clinicId: string): Promise<StaffOverview> {
  return withTenantContext(clinicId, async (client) => {
    const staff = await listActiveStaff(client);
    const invitations = await listOpenInvitations(client);
    return {
      staff: staff.map((member) => ({
        id: member.id,
        email: member.email,
        role: member.role,
        createdAt: toIso(member.createdAt),
      })),
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        expiresAt: toIso(invitation.expiresAt),
        createdAt: toIso(invitation.createdAt),
      })),
    };
  });
}

export interface CreatedStaffInvitation {
  invitation: { id: string; email: string; role: StaffRole; expiresAt: string };
  /** `<app url>/invite#<raw token>` — shown to the caller once, never stored or logged. */
  link: string;
}

/**
 * Issues a one-time invitation in the caller's clinic, invited by the caller.
 *
 * Order, all in one transaction: role rule (T2) → email already a staff
 * member here → retire this email's timed-out pending invitations → open
 * invitation already exists → insert. A concurrent duplicate that slips past
 * the check is caught by the partial unique index and reported the same way.
 *
 * The duplicate check sees only the caller's own clinic (RLS). An email that
 * belongs to another clinic's staff is therefore invitable here; acceptance
 * then fails with `account_exists` (ADR-0023 decision 3), and nothing about
 * the other clinic is revealed.
 */
export async function createStaffInvitation(
  manager: StaffManager,
  request: ParsedInvitationRequest,
  appUrl: string,
): Promise<CreatedStaffInvitation> {
  if (!canManageInvitationFor(manager.role, request.role)) {
    throw new RoleNotInvitableError();
  }

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);

  try {
    const inserted = await withTenantContext(manager.clinicId, async (client) => {
      if (await staffEmailExists(client, request.email)) {
        throw new AlreadyInvitedError();
      }
      await retireTimedOutInvitations(client, request.email);
      if (await openInvitationExists(client, request.email)) {
        throw new AlreadyInvitedError();
      }
      return insertInvitation(client, {
        clinicId: manager.clinicId,
        email: request.email,
        role: request.role,
        tokenHash,
        invitedBy: manager.staffId,
      });
    });

    return {
      invitation: {
        id: inserted.id,
        email: request.email,
        role: request.role,
        expiresAt: toIso(inserted.expiresAt),
      },
      link: buildInvitationLink(appUrl, rawToken),
    };
  } catch (err) {
    if (err instanceof PendingInvitationConflictError) {
      throw new AlreadyInvitedError();
    }
    throw err;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cancels (pending -> expired) a pending invitation of the caller's clinic.
 * The caller must be allowed to invite that role (T2), so an admin cannot
 * cancel an admin invitation and nobody cancels an owner invitation here.
 * An unknown, malformed, already-used or other-clinic id is
 * `InvitationNotFoundError`, indistinguishably.
 */
export async function cancelStaffInvitation(
  manager: StaffManager,
  invitationId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(invitationId)) {
    throw new InvitationNotFoundError();
  }
  await withTenantContext(manager.clinicId, async (client) => {
    const invitation = await findPendingInvitationForUpdate(client, invitationId);
    if (!invitation) {
      throw new InvitationNotFoundError();
    }
    if (!canManageInvitationFor(manager.role, invitation.role)) {
      throw new RoleNotInvitableError();
    }
    await expireInvitation(client, invitation.id);
  });
}
