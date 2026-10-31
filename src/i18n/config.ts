/**
 * Staff UI locales (ADR-0027 decision 1). This module holds no UI text and no
 * dictionary, so it is safe to import from client components.
 */
export const LOCALES = ['ar', 'el', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = 'rtl' | 'ltr';

/** ADR-0027 decision 3(c): the fallback when neither the cookie nor Accept-Language decides. */
export const DEFAULT_LOCALE: Locale = 'el';

/** ADR-0027 decision 3(a). Holds only the language preference, never an identifier. */
export const LOCALE_COOKIE_NAME = 'locale';

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language's own name for itself, shown by the language switcher in every locale. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  ar: 'العربية',
  el: 'Ελληνικά',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** ADR-0027 decision 5: Arabic is right-to-left, Greek and English left-to-right. */
export function directionOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
