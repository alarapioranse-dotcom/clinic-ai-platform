import type { AppEnvironment } from '@/types';

/**
 * The notice shown at the top of every page outside production
 * (docs/operations/2026-10-21-demo-environment-option-c.md, rule 3: external
 * demos require a visible "no real patient data" notice). Production returns
 * null, so the notice can never render there.
 */
export function environmentNotice(appEnv: AppEnvironment): string | null {
  switch (appEnv) {
    case 'production':
      return null;
    case 'staging':
      return 'بيئة تجريبية — لا تُدخل بيانات مرضى أو عيادات حقيقية.';
    case 'development':
      return 'بيئة تطوير — لا تُدخل بيانات مرضى أو عيادات حقيقية.';
  }
}
