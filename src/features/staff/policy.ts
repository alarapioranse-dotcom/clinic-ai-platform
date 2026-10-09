/**
 * Internal to this feature — re-exported through `./index.ts`.
 *
 * Who may manage staff, and which roles each manager may invite (item 3,
 * Owner decision T2; ADR-0023 decision 7). Pure data and functions, with no
 * database or server-only imports, so it can be unit-tested directly.
 */

export type StaffRole = 'owner' | 'admin' | 'practitioner' | 'receptionist';

const STAFF_ROLES: readonly StaffRole[] = ['owner', 'admin', 'practitioner', 'receptionist'];

/**
 * Roles that may open `/dashboard/staff` and `/dashboard/staff/invite` and
 * call the staff API (docs/product/04-sitemap.md,
 * docs/technical/03-api-contracts.md). The API is the authorization
 * boundary; the pages and the navigation link repeat it.
 */
export const STAFF_MANAGER_ROLES: ('owner' | 'admin')[] = ['owner', 'admin'];

/**
 * Owner decision T2:
 * - owner may invite admin, practitioner and receptionist;
 * - admin may invite practitioner and receptionist only;
 * - nobody invites an owner (the operator provisioning script is the only
 *   source of owner invitations; migration 0017's
 *   `invitation_owner_never_invited_by_staff` enforces it in the database too).
 */
const INVITABLE_ROLES: Readonly<Record<StaffRole, readonly StaffRole[]>> = {
  owner: ['admin', 'practitioner', 'receptionist'],
  admin: ['practitioner', 'receptionist'],
  practitioner: [],
  receptionist: [],
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/** The roles a staff member with `inviterRole` may invite; empty for an unknown role. */
export function invitableRoles(inviterRole: string): StaffRole[] {
  return isStaffRole(inviterRole) ? [...INVITABLE_ROLES[inviterRole]] : [];
}

/**
 * Whether `inviterRole` may invite — or cancel a pending invitation for —
 * `targetRole`. The same rule governs both, so a manager can never cancel an
 * invitation for a role they could not have issued.
 */
export function canManageInvitationFor(inviterRole: string, targetRole: string): boolean {
  return invitableRoles(inviterRole).some((role) => role === targetRole);
}
