import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, directionOf, isLocale, LOCALES, type Locale } from '@/i18n/config';
import { AVAILABLE_LOCALES } from '@/i18n/dictionaries';
import { matchAcceptLanguage, parseAcceptLanguage, resolveLocale } from '@/i18n/resolve';

/** ADR-0027 decision 3. */

describe('locale configuration', () => {
  it('has exactly the three ADR-0027 locales, defaulting to Greek', () => {
    expect([...LOCALES]).toEqual(['ar', 'el', 'en']);
    expect(DEFAULT_LOCALE).toBe('el');
  });

  it('maps Arabic to rtl and Greek and English to ltr', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('el')).toBe('ltr');
    expect(directionOf('en')).toBe('ltr');
  });

  it('accepts only the exact locale strings', () => {
    for (const value of ['ar', 'el', 'en']) expect(isLocale(value)).toBe(true);
    for (const value of ['AR', 'ar-SA', 'fr', '', ' ar', null, undefined, 1, {}, ['ar']]) {
      expect(isLocale(value)).toBe(false);
    }
  });
});

describe('parseAcceptLanguage', () => {
  it('orders by q, keeping header order between equal weights', () => {
    expect(parseAcceptLanguage('en;q=0.5, el-GR, ar;q=0.5, fr;q=0.9')).toEqual([
      { tag: 'el-gr', q: 1 },
      { tag: 'fr', q: 0.9 },
      { tag: 'en', q: 0.5 },
      { tag: 'ar', q: 0.5 },
    ]);
  });

  it('drops q=0 ("not acceptable") entries', () => {
    expect(parseAcceptLanguage('el;q=0, en;q=0.000, ar')).toEqual([{ tag: 'ar', q: 1 }]);
  });

  it('drops malformed entries instead of guessing', () => {
    expect(
      parseAcceptLanguage('el;q=2, en;q=abc, ;q=0.5, 1234, ar-, x y, de;foo=bar, ar;q=0.7'),
    ).toEqual([{ tag: 'ar', q: 0.7 }]);
  });

  it('keeps * and lower-cases tags', () => {
    expect(parseAcceptLanguage('EN-US, *;q=0.1')).toEqual([
      { tag: 'en-us', q: 1 },
      { tag: '*', q: 0.1 },
    ]);
  });

  it('treats an absent or empty header as no preference', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(' , ;q=1')).toEqual([]);
  });
});

describe('matchAcceptLanguage', () => {
  const all: readonly Locale[] = ['ar', 'el', 'en'];

  it('matches regional tags on the primary subtag', () => {
    expect(matchAcceptLanguage('el-GR', all)).toBe('el');
    expect(matchAcceptLanguage('en-US', all)).toBe('en');
    expect(matchAcceptLanguage('ar-SA', all)).toBe('ar');
  });

  it('takes the highest-q available language', () => {
    expect(matchAcceptLanguage('fr, en;q=0.4, el;q=0.8', all)).toBe('el');
  });

  it('skips languages without a dictionary', () => {
    expect(matchAcceptLanguage('el, en;q=0.9, ar;q=0.1', ['ar'])).toBe('ar');
  });

  it('does not treat * as a match of its own', () => {
    expect(matchAcceptLanguage('*', all)).toBeNull();
    expect(matchAcceptLanguage('fr, *;q=0.5, en;q=0.1', all)).toBe('en');
  });

  it('returns null when nothing matches', () => {
    expect(matchAcceptLanguage('fr-FR, de;q=0.9', all)).toBeNull();
    expect(matchAcceptLanguage('el;q=0', all)).toBeNull();
  });
});

describe('resolveLocale with the real dictionaries (slice 3: Arabic, Greek, English)', () => {
  it('has all three locales available, in the order they are offered', () => {
    expect([...AVAILABLE_LOCALES]).toEqual(['ar', 'el', 'en']);
  });

  const cases: [string, { cookie?: string; acceptLanguage?: string }, Locale][] = [
    ['cookie ar', { cookie: 'ar', acceptLanguage: 'en' }, 'ar'],
    ['cookie en', { cookie: 'en', acceptLanguage: 'ar' }, 'en'],
    ['cookie el wins over Accept-Language', { cookie: 'el', acceptLanguage: 'ar' }, 'el'],
    ['cookie el with no header', { cookie: 'el' }, 'el'],
    ['invalid cookie', { cookie: 'fr' }, 'el'],
    ['malicious cookie', { cookie: '../../etc/passwd', acceptLanguage: 'ar' }, 'ar'],
    ['Accept-Language ar', { acceptLanguage: 'ar' }, 'ar'],
    ['Accept-Language ar-SA', { acceptLanguage: 'ar-SA,ar;q=0.9' }, 'ar'],
    ['Accept-Language en', { acceptLanguage: 'en' }, 'en'],
    ['Accept-Language en-US', { acceptLanguage: 'en-US,en;q=0.9' }, 'en'],
    ['Accept-Language el', { acceptLanguage: 'el-GR,el;q=0.9' }, 'el'],
    ['Accept-Language el, then ar', { acceptLanguage: 'el-GR,el;q=0.9,ar;q=0.5' }, 'el'],
    ['Accept-Language el, then en', { acceptLanguage: 'el-GR,el;q=0.9,en;q=0.8' }, 'el'],
    ['Accept-Language en, then el', { acceptLanguage: 'en-GB,en;q=0.9,el;q=0.8' }, 'en'],
    ['Accept-Language en preferred over ar by q', { acceptLanguage: 'ar;q=0.4, en;q=0.6' }, 'en'],
    ['Accept-Language ar;q=0 is refused', { acceptLanguage: 'ar;q=0' }, 'el'],
    ['Accept-Language fr', { acceptLanguage: 'fr-FR,fr;q=0.9' }, 'el'],
    ['Accept-Language *', { acceptLanguage: '*' }, 'el'],
    ['no preference', {}, 'el'],
  ];

  for (const [name, input, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(
        resolveLocale({
          cookie: input.cookie,
          acceptLanguage: input.acceptLanguage,
          available: AVAILABLE_LOCALES,
        }),
      ).toBe(expected);
    });
  }
});

describe('resolveLocale fallback when Greek has no dictionary (architect ruling D1)', () => {
  it('uses Greek when available, otherwise English, otherwise the first available locale', () => {
    const fallback = (available: readonly Locale[]) =>
      resolveLocale({ cookie: undefined, acceptLanguage: 'fr', available });
    expect(fallback(['ar', 'el', 'en'])).toBe('el');
    expect(fallback(['ar', 'en'])).toBe('en');
    expect(fallback(['en', 'ar'])).toBe('en');
    expect(fallback(['ar'])).toBe('ar');
  });
});

describe('resolveLocale with every locale available (the contract slices 2 and 3 rely on)', () => {
  const all: readonly Locale[] = ['ar', 'el', 'en'];
  const resolve = (cookie: string | undefined, acceptLanguage: string | undefined) =>
    resolveLocale({ cookie, acceptLanguage, available: all });

  it('prefers a valid cookie over Accept-Language', () => {
    expect(resolve('ar', 'el-GR')).toBe('ar');
    expect(resolve('en', 'el')).toBe('en');
  });

  it('ignores an invalid cookie and uses Accept-Language', () => {
    expect(resolve('fr', 'en-US')).toBe('en');
    expect(resolve('EL', 'ar')).toBe('ar');
  });

  it('falls back to Greek when nothing decides', () => {
    expect(resolve(undefined, undefined)).toBe('el');
    expect(resolve(undefined, 'fr, de;q=0.5')).toBe('el');
    expect(resolve(undefined, '*')).toBe('el');
  });

  it('never returns a locale outside the available list', () => {
    expect(resolveLocale({ cookie: 'el', acceptLanguage: 'el', available: ['ar', 'en'] })).toBe(
      'en',
    );
    expect(resolveLocale({ cookie: 'el', acceptLanguage: 'el', available: ['ar'] })).toBe('ar');
    expect(resolveLocale({ cookie: undefined, acceptLanguage: undefined, available: ['en'] })).toBe(
      'en',
    );
  });

  it('refuses to resolve when no locale has a dictionary', () => {
    expect(() => resolveLocale({ cookie: 'ar', acceptLanguage: 'ar', available: [] })).toThrow();
  });
});
