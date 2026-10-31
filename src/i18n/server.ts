import { cookies, headers } from 'next/headers';

import { directionOf, LOCALE_COOKIE_NAME, type Direction, type Locale } from './config';
import { AVAILABLE_LOCALES, getDictionary, type Dictionary } from './dictionaries';
import { resolveLocale } from './resolve';

/**
 * Server-side entry point (ADR-0027 decisions 3 and 4): resolves the active
 * locale from this request and loads its dictionary. Server components call
 * this and pass client components only the namespace they render.
 */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
    available: AVAILABLE_LOCALES,
  });
}

export async function getI18n(): Promise<{ locale: Locale; dir: Direction; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, dir: directionOf(locale), t: getDictionary(locale) };
}
