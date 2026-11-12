import type { Locale } from '../config';

import { ar } from './ar';
import { el } from './el';
import { en, type MarketingDictionary } from './en';

export type { MarketingDictionary };

const MARKETING: Readonly<Record<Locale, MarketingDictionary>> = { ar, el, en };

/** The public pages' text for a locale (ADR-0029 decision 4). */
export function getMarketingDictionary(locale: Locale): MarketingDictionary {
  return MARKETING[locale];
}

/**
 * Status of each roadmap phase shown on the home page. Not translated: it is
 * a fact about the project and must follow the "Status" list in README.md.
 */
export const LAUNCH_PHASES = [
  { id: 'p0', status: 'done' },
  { id: 'p1', status: 'done' },
  { id: 'p2', status: 'done' },
  { id: 'p3', status: 'done' },
  { id: 'p4', status: 'done' },
  { id: 'p5', status: 'in-progress' },
] as const;
