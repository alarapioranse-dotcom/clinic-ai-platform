import type { AppEnvironment } from '@/types';

/** The two non-production notices, from the dictionary's `environmentNotice` namespace. */
export interface EnvironmentNoticeMessages {
  staging: string;
  development: string;
}

/**
 * The notice shown at the top of every page outside production
 * (docs/operations/2026-10-21-demo-environment-option-c.md, rule 3: external
 * demos require a visible "no real patient data" notice). Production returns
 * null, so the notice can never render there.
 */
export function environmentNotice(
  appEnv: AppEnvironment,
  messages: EnvironmentNoticeMessages,
): string | null {
  switch (appEnv) {
    case 'production':
      return null;
    case 'staging':
      return messages.staging;
    case 'development':
      return messages.development;
  }
}
