import { describe, it, expect } from 'vitest';

import { appNav, visibleNavItems } from '@/config/navigation';
import { KNOWLEDGE_BASE_MANAGER_ROLES } from '@/features/knowledge-base';

/**
 * Roadmap P5 Slice 1C, Owner decision D4: the knowledge-base link shows only
 * for owner/admin. This is presentation only — the page and the API enforce
 * access — but the link's role list must never drift from the roles the API
 * and pages actually allow.
 */
const KNOWLEDGE_BASE_HREF = '/dashboard/knowledge-base';

describe('knowledge-base manager roles', () => {
  it('are exactly owner and admin', () => {
    expect([...KNOWLEDGE_BASE_MANAGER_ROLES].sort()).toEqual(['admin', 'owner']);
  });

  it('match the roles on the knowledge-base navigation entry', () => {
    const entry = appNav.find((item) => item.href === KNOWLEDGE_BASE_HREF);
    expect(entry).toBeDefined();
    expect([...(entry?.roles ?? [])].sort()).toEqual([...KNOWLEDGE_BASE_MANAGER_ROLES].sort());
  });
});

describe('visibleNavItems', () => {
  for (const role of ['owner', 'admin'] as const) {
    it(`shows the knowledge-base link to ${role}`, () => {
      const hrefs = visibleNavItems(appNav, role).map((item) => item.href);
      expect(hrefs).toContain(KNOWLEDGE_BASE_HREF);
    });
  }

  for (const role of ['practitioner', 'receptionist'] as const) {
    it(`hides the knowledge-base link from ${role}`, () => {
      const hrefs = visibleNavItems(appNav, role).map((item) => item.href);
      expect(hrefs).not.toContain(KNOWLEDGE_BASE_HREF);
    });
  }

  it('keeps items without a role list visible to every role', () => {
    for (const role of ['owner', 'admin', 'practitioner', 'receptionist'] as const) {
      expect(visibleNavItems(appNav, role).map((item) => item.href)).toContain('/dashboard');
    }
  });
});
