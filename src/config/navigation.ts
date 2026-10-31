import type { StaffRole } from '@/types';

export interface AppNavItem {
  /** Key of the label in the dictionary's `nav` namespace (ADR-0027). */
  labelKey: 'dashboard' | 'knowledgeBase' | 'clinicSettings' | 'staff';
  href: string;
  /**
   * Staff roles that see this item. Omitted = every signed-in role. This only
   * decides what the navigation shows; it is never an authorization check —
   * the API and the page itself enforce access.
   */
  roles?: readonly StaffRole[];
}

/**
 * Signed-in navigation. Role-restricted entries list their roles literally
 * rather than importing `KNOWLEDGE_BASE_MANAGER_ROLES` /
 * `CLINIC_SETTINGS_MANAGER_ROLES` / `STAFF_MANAGER_ROLES`: those features' entry points pull in
 * server-only code.
 * Unit tests keep each list equal to its feature's.
 */
export const appNav: AppNavItem[] = [
  { labelKey: 'dashboard', href: '/dashboard' },
  { labelKey: 'knowledgeBase', href: '/dashboard/knowledge-base', roles: ['owner', 'admin'] },
  { labelKey: 'clinicSettings', href: '/dashboard/settings/clinic', roles: ['owner', 'admin'] },
  { labelKey: 'staff', href: '/dashboard/staff', roles: ['owner', 'admin'] },
];

/**
 * The navigation items a role sees. Presentation only — hiding an item is
 * never what keeps a role out of a screen.
 */
export function visibleNavItems<T extends { roles?: readonly StaffRole[] }>(
  items: T[],
  role: string,
): T[] {
  return items.filter((item) => !item.roles || (item.roles as readonly string[]).includes(role));
}
