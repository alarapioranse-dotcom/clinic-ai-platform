import { describe, it, expect } from 'vitest';

import { appNav, visibleNavItems } from '@/config/navigation';
import { CLINIC_SETTINGS_MANAGER_ROLES } from '@/features/clinic';

/**
 * Owner decision S4: the clinic-settings link shows only for owner/admin.
 * Presentation only — the page and the API enforce access — but the link's
 * role list must never drift from the roles the API and page allow.
 */
const CLINIC_SETTINGS_HREF = '/dashboard/settings/clinic';

describe('clinic settings manager roles', () => {
  it('are exactly owner and admin', () => {
    expect([...CLINIC_SETTINGS_MANAGER_ROLES].sort()).toEqual(['admin', 'owner']);
  });

  it('match the roles on the clinic-settings navigation entry', () => {
    const entry = appNav.find((item) => item.href === CLINIC_SETTINGS_HREF);
    expect(entry).toBeDefined();
    expect([...(entry?.roles ?? [])].sort()).toEqual([...CLINIC_SETTINGS_MANAGER_ROLES].sort());
  });
});

describe('visibleNavItems — clinic settings', () => {
  for (const role of ['owner', 'admin'] as const) {
    it(`shows the clinic-settings link to ${role}`, () => {
      expect(visibleNavItems(appNav, role).map((item) => item.href)).toContain(
        CLINIC_SETTINGS_HREF,
      );
    });
  }

  for (const role of ['practitioner', 'receptionist'] as const) {
    it(`hides the clinic-settings link from ${role}`, () => {
      expect(visibleNavItems(appNav, role).map((item) => item.href)).not.toContain(
        CLINIC_SETTINGS_HREF,
      );
    });
  }
});
