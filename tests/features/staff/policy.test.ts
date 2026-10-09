import { describe, it, expect } from 'vitest';

import { appNav, visibleNavItems } from '@/config/navigation';
import { STAFF_MANAGER_ROLES, canManageInvitationFor, invitableRoles } from '@/features/staff';

/**
 * Owner decision T2 — who may invite whom. The full 4 × 4 matrix, so any
 * drift from the approved table fails a test.
 */
const ROLES = ['owner', 'admin', 'practitioner', 'receptionist'] as const;

const ALLOWED: Record<(typeof ROLES)[number], string[]> = {
  owner: ['admin', 'practitioner', 'receptionist'],
  admin: ['practitioner', 'receptionist'],
  practitioner: [],
  receptionist: [],
};

describe('staff invitation policy (T2)', () => {
  for (const inviter of ROLES) {
    it(`${inviter} may invite exactly: ${ALLOWED[inviter].join(', ') || 'nobody'}`, () => {
      expect(invitableRoles(inviter)).toEqual(ALLOWED[inviter]);
    });

    for (const target of ROLES) {
      const expected = ALLOWED[inviter].includes(target);
      it(`${inviter} → ${target}: ${expected ? 'allowed' : 'refused'}`, () => {
        expect(canManageInvitationFor(inviter, target)).toBe(expected);
      });
    }
  }

  it('nobody may invite an owner', () => {
    for (const inviter of ROLES) {
      expect(canManageInvitationFor(inviter, 'owner')).toBe(false);
    }
  });

  it('an unknown inviter role may invite nobody', () => {
    expect(invitableRoles('superuser')).toEqual([]);
    expect(canManageInvitationFor('superuser', 'receptionist')).toBe(false);
    expect(canManageInvitationFor('owner', 'superuser')).toBe(false);
  });

  it('staff managers are exactly owner and admin', () => {
    expect([...STAFF_MANAGER_ROLES].sort()).toEqual(['admin', 'owner']);
  });
});

describe('staff navigation link', () => {
  const HREF = '/dashboard/staff';

  it('lists exactly the staff manager roles', () => {
    const entry = appNav.find((item) => item.href === HREF);
    expect(entry).toBeDefined();
    expect([...(entry?.roles ?? [])].sort()).toEqual([...STAFF_MANAGER_ROLES].sort());
  });

  for (const role of ['owner', 'admin'] as const) {
    it(`shows to ${role}`, () => {
      expect(visibleNavItems(appNav, role).map((item) => item.href)).toContain(HREF);
    });
  }

  for (const role of ['practitioner', 'receptionist'] as const) {
    it(`hides from ${role}`, () => {
      expect(visibleNavItems(appNav, role).map((item) => item.href)).not.toContain(HREF);
    });
  }
});
