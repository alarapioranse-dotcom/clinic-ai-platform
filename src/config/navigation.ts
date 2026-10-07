import type { NavItem } from '@/types';

export const marketingNav: NavItem[] = [
  { label: 'كيف تعمل المنصة', href: '#how-it-works' },
  { label: 'الإمكانيات', href: '#capabilities' },
  { label: 'مراحل الإطلاق', href: '#launch-status' },
];

/**
 * Signed-in navigation. Role-restricted entries list their roles literally
 * rather than importing `KNOWLEDGE_BASE_MANAGER_ROLES` /
 * `CLINIC_SETTINGS_MANAGER_ROLES`: this module is also imported by marketing
 * components, and those features' entry points pull in server-only code.
 * Unit tests keep each list equal to its feature's.
 */
export const appNav: NavItem[] = [
  { label: 'لوحة التحكم', href: '/dashboard' },
  { label: 'قاعدة المعرفة', href: '/dashboard/knowledge-base', roles: ['owner', 'admin'] },
  { label: 'إعدادات العيادة', href: '/dashboard/settings/clinic', roles: ['owner', 'admin'] },
];

/**
 * The navigation items a role sees. Presentation only — hiding an item is
 * never what keeps a role out of a screen.
 */
export function visibleNavItems(items: NavItem[], role: string): NavItem[] {
  return items.filter((item) => !item.roles || (item.roles as readonly string[]).includes(role));
}
