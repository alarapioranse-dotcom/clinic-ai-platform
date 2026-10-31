import { LOCALE_NAMES, type Locale } from './config';

/** The switcher's choices: every locale with a dictionary, each named in its own language. */
export function languageOptions(available: readonly Locale[]): { locale: Locale; name: string }[] {
  return available.map((locale) => ({ locale, name: LOCALE_NAMES[locale] }));
}
