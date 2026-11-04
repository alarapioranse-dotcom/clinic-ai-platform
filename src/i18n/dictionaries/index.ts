import type { Locale } from '../config';

import { ar } from './ar';
import { en } from './en';

/**
 * The dictionary contract (ADR-0027 decision 4): the English dictionary's
 * shape. Every other dictionary is typed against it, so a missing or
 * misspelled key fails `npm run typecheck`.
 */
export type Dictionary = typeof en;

const DICTIONARIES: Readonly<Partial<Record<Locale, Dictionary>>> = { ar, en };

/**
 * Locales that have a dictionary, in the order they are offered. The locale
 * resolver only ever returns one of these (ADR-0027 slice 2: `ar` and `en`;
 * Greek arrives in slice 3).
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
