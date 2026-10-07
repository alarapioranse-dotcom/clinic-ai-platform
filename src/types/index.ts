export type AppEnvironment = 'development' | 'staging' | 'production';

export type StaffRole = 'owner' | 'admin' | 'practitioner' | 'receptionist';

export interface NavItem {
  label: string;
  href: string;
  /**
   * Staff roles that see this item. Omitted = every signed-in role. This only
   * decides what the navigation shows; it is never an authorization check —
   * the API and the page itself enforce access.
   */
  roles?: readonly StaffRole[];
}

export interface SiteConfig {
  name: string;
  description: string;
  locale: 'ar';
  direction: 'rtl';
  url: string;
}

export type LaunchPhaseStatus = 'done' | 'in-progress' | 'planned';

export interface LaunchPhase {
  id: string;
  title: string;
  description: string;
  status: LaunchPhaseStatus;
}
