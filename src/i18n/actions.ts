'use server';

import { cookies } from 'next/headers';

import { AVAILABLE_LOCALES } from './dictionaries';
import { localeCookieFor } from './locale-cookie';

export type SetLocaleResult = { ok: true } | { ok: false };

/**
 * Stores the staff member's explicit language choice (ADR-0027 decision 3a).
 * Writes only the `locale` cookie and only for an allowed locale that has a
 * dictionary; it never reads or changes the session cookie, the role or the
 * clinic, and never redirects. The caller refreshes the page itself.
 */
export async function setLocale(value: unknown): Promise<SetLocaleResult> {
  const cookie = localeCookieFor(value, AVAILABLE_LOCALES);
  if (!cookie) return { ok: false };
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
  return { ok: true };
}
