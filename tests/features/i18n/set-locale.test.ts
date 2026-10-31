import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from '@/i18n/config';
import { localeCookieFor } from '@/i18n/locale-cookie';

const cookieSet = vi.fn();
const cookieDelete = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, delete: cookieDelete, get: vi.fn() }),
}));

/** ADR-0027 decision 3(a) and the architect's conditions on the setLocale server action. */
describe('localeCookieFor', () => {
  it('builds a preference-only cookie for an available locale', () => {
    expect(localeCookieFor('ar', ['ar'])).toEqual({
      name: LOCALE_COOKIE_NAME,
      value: 'ar',
      options: {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: true,
        maxAge: LOCALE_COOKIE_MAX_AGE,
      },
    });
    expect(LOCALE_COOKIE_NAME).toBe('locale');
    expect(LOCALE_COOKIE_MAX_AGE).toBe(31_536_000);
  });

  it('refuses a valid locale that has no dictionary yet', () => {
    expect(localeCookieFor('el', ['ar'])).toBeNull();
    expect(localeCookieFor('en', ['ar'])).toBeNull();
  });

  it('refuses anything that is not exactly ar, el or en', () => {
    for (const value of ['fr', 'AR', 'ar ', '', 'ar;secure', null, undefined, 0, {}, ['ar']]) {
      expect(localeCookieFor(value, ['ar', 'el', 'en'])).toBeNull();
    }
  });
});

describe('setLocale', () => {
  beforeEach(() => {
    cookieSet.mockReset();
    cookieDelete.mockReset();
  });

  it('writes only the locale cookie for an available locale', async () => {
    const { setLocale } = await import('@/i18n/actions');
    await expect(setLocale('ar')).resolves.toEqual({ ok: true });
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet.mock.calls[0]![0]).toBe('locale');
    expect(cookieSet.mock.calls[0]![1]).toBe('ar');
    expect(cookieDelete).not.toHaveBeenCalled();
  });

  it('writes nothing for a locale without a dictionary or an unknown value', async () => {
    const { setLocale } = await import('@/i18n/actions');
    for (const value of ['el', 'en', 'fr', '', null, { locale: 'ar' }]) {
      await expect(setLocale(value)).resolves.toEqual({ ok: false });
    }
    expect(cookieSet).not.toHaveBeenCalled();
    expect(cookieDelete).not.toHaveBeenCalled();
  });
});
