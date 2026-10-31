import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from './config';

export interface LocaleCookie {
  name: typeof LOCALE_COOKIE_NAME;
  value: Locale;
  options: {
    path: '/';
    sameSite: 'lax';
    httpOnly: true;
    secure: true;
    maxAge: number;
  };
}

/**
 * The cookie `setLocale` writes, or null when the value must be refused: not
 * one of ar/el/en, or a locale that has no dictionary yet (so the app could
 * not show it). `Secure` is always set, like the session cookie
 * (src/app/api/auth/sign-in/route.ts). The cookie holds only the language
 * preference: no identifier, role, session or clinic.
 */
export function localeCookieFor(value: unknown, available: readonly Locale[]): LocaleCookie | null {
  if (!isLocale(value) || !available.includes(value)) return null;
  return {
    name: LOCALE_COOKIE_NAME,
    value,
    options: {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
      maxAge: LOCALE_COOKIE_MAX_AGE,
    },
  };
}
