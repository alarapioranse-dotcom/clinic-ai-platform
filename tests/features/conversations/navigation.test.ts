import { describe, it, expect } from 'vitest';

import { appNav, visibleNavItems } from '@/config/navigation';
import { en } from '@/i18n/dictionaries/en';
import { ar } from '@/i18n/dictionaries/ar';
import { el } from '@/i18n/dictionaries/el';

/**
 * The conversations screen and GET /api/conversations allow every signed-in
 * role, so the navigation link shows for every role, right after the
 * dashboard, labelled in every dictionary.
 */
const CONVERSATIONS_HREF = '/dashboard/conversations';

describe('conversations navigation link', () => {
  for (const role of ['owner', 'admin', 'practitioner', 'receptionist'] as const) {
    it(`shows to ${role}, right after the dashboard`, () => {
      const hrefs = visibleNavItems(appNav, role).map((item) => item.href);
      expect(hrefs.slice(0, 2)).toEqual(['/dashboard', CONVERSATIONS_HREF]);
    });
  }

  it('has a label in every dictionary', () => {
    expect(en.nav.conversations).toBe('Conversations');
    expect(ar.nav.conversations).toBe('المحادثات');
    expect(el.nav.conversations).toBe('Συνομιλίες');
  });
});
