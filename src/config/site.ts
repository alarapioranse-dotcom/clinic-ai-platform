import { env } from '@/lib/env';

/** Site-wide settings that do not depend on the visitor's language. */
export const siteConfig = {
  url: env.appUrl,
} as const;
