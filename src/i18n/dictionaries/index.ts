import type { Locale } from '../config';

import { ar } from './ar';

/**
 * The dictionary contract (ADR-0027 decision 4). In slice 1 only Arabic
 * exists, so its shape is the contract; slice 2 adds `en.ts` and this line
 * becomes `typeof en`, with the namespaces and keys unchanged.
 */
export type Dictionary = typeof ar;

const DICTIONARIES: Readonly<Partial<Record<Locale, Dictionary>>> = { ar };

/**
 * Locales that have a dictionary, in the order they are offered. The locale
 * resolver only ever returns one of these (ADR-0027 slice 1: only `ar`).
 */
export const AVAILABLE_LOCALES: readonly Locale[] = (['ar', 'el', 'en'] as const).filter(
  (locale) => DICTIONARIES[locale] !== undefined,
);

export function getDictionary(locale: Locale): Dictionary {
  const dictionary = DICTIONARIES[locale];
  if (!dictionary) {
    throw new Error(`No dictionary for locale "${locale}"`);
  }
  return dictionary;
}
