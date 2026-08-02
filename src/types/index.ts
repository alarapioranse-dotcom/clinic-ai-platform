export type AppEnvironment = 'development' | 'staging' | 'production';

export interface NavItem {
  label: string;
  href: string;
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
