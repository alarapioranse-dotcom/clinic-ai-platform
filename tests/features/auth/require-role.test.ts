import { describe, it, expect } from 'vitest';
import {
  requireRole,
  ForbiddenRoleError,
  type AuthenticatedSession,
  type Role,
} from '@/features/auth';

function sessionWithRole(role: Role): AuthenticatedSession {
  return { staffId: 'staff-1', clinicId: 'clinic-1', role };
}

/**
 * Unit-level coverage of the role-check mechanism itself, independent of any
 * HTTP route — GET /api/patients (the only route wired to it so far) allows
 * all four roles, so it has no case that actually rejects a caller. This is
 * the "construct that case directly against the helper" case named in the
 * P2b slice.
 */
describe('requireRole', () => {
  it('allows a session whose role is in the allowed list', () => {
    expect(() => requireRole(sessionWithRole('owner'), ['owner', 'admin'])).not.toThrow();
  });

  it('rejects a session whose role is not in the allowed list', () => {
    expect(() => requireRole(sessionWithRole('practitioner'), ['owner', 'admin'])).toThrow(
      ForbiddenRoleError,
    );
  });

  it('never includes the actual role, or the allowed list, in the error message', () => {
    try {
      requireRole(sessionWithRole('receptionist'), ['owner', 'admin']);
      throw new Error('expected requireRole to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenRoleError);
      const message = (err as Error).message;
      expect(message).not.toMatch(/receptionist/i);
      expect(message).not.toMatch(/owner/i);
      expect(message).not.toMatch(/admin/i);
    }
  });
});
