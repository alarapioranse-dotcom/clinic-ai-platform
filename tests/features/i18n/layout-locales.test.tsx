import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderServer } from './render-server';

/**
 * The two root layouts once Greek and English dictionaries exist (slices 2
 * and 3). Slice 1 ships only Arabic, so this file stands in test-only `el`
 * and `en` dictionaries: the Arabic one with a marked app name, enough to
 * tell which dictionary a document used. It proves that the marketing
 * document stays `lang="ar" dir="rtl"` whatever the staff locale, and that
 * the staff documents follow it.
 */
const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  acceptLanguage: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'locale' && request.cookie !== undefined ? { value: request.cookie } : undefined,
    set: vi.fn(),
  }),
  headers: async () => ({
    get: (name: string) => (name === 'accept-language' ? request.acceptLanguage : null),
  }),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/i18n/dictionaries', async () => {
  const { ar } = await import('@/i18n/dictionaries/ar');
  const fake = (marker: string) => ({ ...ar, common: { ...ar.common, appName: marker } });
  const dictionaries = { ar, el: fake('TEST-EL'), en: fake('TEST-EN') } as const;
  return {
    AVAILABLE_LOCALES: ['ar', 'el', 'en'] as const,
    getDictionary: (locale: keyof typeof dictionaries) => dictionaries[locale],
  };
});

beforeEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
});

async function renderStaffRoot() {
  const { default: StaffRootLayout } = await import('@/app/(staff)/layout');
  return renderToStaticMarkup(await StaffRootLayout({ children: <p>page</p> }));
}

async function renderMarketingRoot() {
  const { default: MarketingRootLayout } = await import('@/app/(marketing)/layout');
  return renderToStaticMarkup(MarketingRootLayout({ children: <p>page</p> }));
}

const visitors: {
  name: string;
  cookie?: string;
  acceptLanguage?: string;
  staff: [lang: string, dir: string, appName: string];
}[] = [
  { name: 'locale cookie en', cookie: 'en', staff: ['en', 'ltr', 'TEST-EN'] },
  { name: 'locale cookie el', cookie: 'el', staff: ['el', 'ltr', 'TEST-EL'] },
  { name: 'locale cookie ar', cookie: 'ar', staff: ['ar', 'rtl', 'منصة العيادة الذكية'] },
  { name: 'Accept-Language en', acceptLanguage: 'en-US,en;q=0.9', staff: ['en', 'ltr', 'TEST-EN'] },
  { name: 'Accept-Language el', acceptLanguage: 'el-GR,el;q=0.9', staff: ['el', 'ltr', 'TEST-EL'] },
  {
    name: 'cookie en over Accept-Language el',
    cookie: 'en',
    acceptLanguage: 'el-GR,el;q=0.9',
    staff: ['en', 'ltr', 'TEST-EN'],
  },
  { name: 'no preference (default el)', staff: ['el', 'ltr', 'TEST-EL'] },
];

describe('marketing root layout with Greek and English available', () => {
  for (const visitor of visitors) {
    it(`stays lang="ar" dir="rtl" with Arabic fonts only (${visitor.name})`, async () => {
      request.cookie = visitor.cookie;
      request.acceptLanguage = visitor.acceptLanguage ?? null;
      const html = await renderMarketingRoot();
      expect(html).toMatch(/^<html lang="ar" dir="rtl">/);
      expect(html).not.toContain('Noto+Sans');
      expect(html).not.toContain('TEST-');
    });
  }
});

describe('staff root layout with Greek and English available', () => {
  for (const { name, cookie, acceptLanguage, staff } of visitors) {
    const [lang, dir, appName] = staff;
    it(`renders lang="${lang}" dir="${dir}" (${name})`, async () => {
      request.cookie = cookie;
      request.acceptLanguage = acceptLanguage ?? null;
      const html = await renderStaffRoot();
      expect(html).toMatch(new RegExp(`^<html lang="${lang}" dir="${dir}">`));
      if (lang === 'ar') expect(html).not.toContain('Noto+Sans');
      else expect(html).toContain('family=Noto+Sans');

      const { generateMetadata } = await import('@/app/(staff)/layout');
      expect((await generateMetadata()).title).toBe(appName);
    });
  }
});

describe('language switcher with Greek and English available', () => {
  const error = Object.assign(new Error('x'), { digest: 'd1' });
  const offersAll = (html: string, current: string) => {
    expect(html).toContain('<select');
    for (const locale of ['ar', 'el', 'en']) {
      expect(html).toMatch(new RegExp(`<option value="${locale}" lang="${locale}"`));
    }
    expect(html).toMatch(new RegExp(`<option value="${current}" lang="${current}" selected=""`));
  };

  for (const current of ['el', 'en', 'ar']) {
    it(`appears on the 404 page, the sign-in pages and the app navigation (cookie ${current})`, async () => {
      request.cookie = current;
      const { default: NotFound } = await import('@/app/(staff)/not-found');
      const { default: AuthLayout } = await import('@/app/(staff)/(auth)/layout');
      const { AppShellNav } = await import('@/components/app/AppShellNav');
      offersAll(await renderServer(<NotFound />), current);
      offersAll(await renderServer(AuthLayout({ children: 'login' })), current);
      offersAll(await renderServer(<AppShellNav role="receptionist" />), current);
    });

    it(`appears on the staff error page, from the staff root layout (cookie ${current})`, async () => {
      request.cookie = current;
      const { default: StaffRootLayout } = await import('@/app/(staff)/layout');
      const { default: ErrorPage } = await import('@/app/(staff)/error');
      offersAll(
        await renderServer(
          StaffRootLayout({ children: <ErrorPage error={error} reset={() => {}} /> }),
        ),
        current,
      );
    });
  }

  it('does not appear on the marketing error page (the marketing pages are Arabic-only)', async () => {
    request.cookie = 'en';
    const { default: MarketingRootLayout } = await import('@/app/(marketing)/layout');
    const { default: MarketingError } = await import('@/app/(marketing)/error');
    const html = await renderServer(
      MarketingRootLayout({ children: <MarketingError error={error} reset={() => {}} /> }),
    );
    expect(html).toMatch(/^<html lang="ar" dir="rtl">/);
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('<select');
  });
});
