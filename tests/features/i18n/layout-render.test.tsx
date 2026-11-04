import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderServer } from './render-server';

/**
 * ADR-0027 slice 2 at the rendered level, with the request's cookie and
 * Accept-Language header mocked and the real dictionaries (Arabic and
 * English; Greek has none yet): each root layout's document lang/dir and
 * fonts, the Arabic-only marketing document, metadata, error text, the error
 * and 404 routes, and the language switcher on every staff screen.
 * layout-locales.test.tsx covers the same layouts with all three locales.
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

beforeEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
});

async function renderStaffRoot(child: React.ReactNode = <p>page</p>) {
  const { default: StaffRootLayout } = await import('@/app/(staff)/layout');
  return renderToStaticMarkup(await StaffRootLayout({ children: child }));
}

async function renderMarketingRoot(child: React.ReactNode = <p>page</p>) {
  const { default: MarketingRootLayout } = await import('@/app/(marketing)/layout');
  return renderToStaticMarkup(MarketingRootLayout({ children: child }));
}

const visitors: [string, string | undefined, string | null][] = [
  ['no preference', undefined, null],
  ['Accept-Language el only', undefined, 'el-GR,el;q=0.9'],
  ['Accept-Language el, then en', undefined, 'el-GR,el;q=0.9,en;q=0.8'],
  ['Accept-Language en', undefined, 'en-US,en;q=0.9'],
  ['Accept-Language fr', undefined, 'fr-FR,fr;q=0.9'],
  ['Accept-Language ar', undefined, 'ar-SA,ar;q=0.9'],
  ['cookie el (no dictionary yet)', 'el', null],
  ['cookie en', 'en', 'ar'],
  ['cookie ar', 'ar', 'en-US,en;q=0.9'],
];

/** What the staff UI resolves each visitor to in slice 2 (the architect's D1 fallback). */
const staffLocaleOf: Record<string, 'ar' | 'en'> = {
  'no preference': 'en',
  'Accept-Language el only': 'en',
  'Accept-Language el, then en': 'en',
  'Accept-Language en': 'en',
  'Accept-Language fr': 'en',
  'Accept-Language ar': 'ar',
  'cookie el (no dictionary yet)': 'en',
  'cookie en': 'en',
  'cookie ar': 'ar',
};

describe('staff root layout in slice 2', () => {
  for (const [name, cookie, acceptLanguage] of visitors) {
    const locale = staffLocaleOf[name]!;
    it(`renders ${locale} (${name})`, async () => {
      request.cookie = cookie;
      request.acceptLanguage = acceptLanguage;
      const html = await renderStaffRoot();
      if (locale === 'ar') {
        expect(html).toMatch(/^<html lang="ar" dir="rtl">/);
        expect(html).not.toContain('Noto+Sans');
      } else {
        expect(html).toMatch(/^<html lang="en" dir="ltr">/);
        expect(html).toContain('family=Noto+Sans');
      }
      expect(html).toContain('family=IBM+Plex+Sans+Arabic');
      expect(html).not.toMatch(/lang="el"/);
    });
  }

  it('gives English metadata to an English visitor and Arabic metadata to an Arabic one', async () => {
    const { generateMetadata } = await import('@/app/(staff)/layout');
    request.acceptLanguage = 'en';
    expect(await generateMetadata()).toMatchObject({
      title: 'Clinic AI Platform',
      description: expect.stringMatching(/^A multi-clinic AI platform/),
    });
    request.cookie = 'ar';
    const arabic = await generateMetadata();
    expect(arabic.title).toBe('منصة العيادة الذكية');
    expect(arabic.description).toMatch(/\p{Script=Arabic}/u);
  });

  it('renders the environment notice in the staff locale', async () => {
    const { en } = await import('@/i18n/dictionaries/en');
    request.cookie = 'en';
    expect(await renderStaffRoot()).toContain(en.environmentNotice.development);
  });
});

describe('marketing root layout', () => {
  for (const [name, cookie, acceptLanguage] of visitors) {
    it(`renders an Arabic, right-to-left document with no Greek/Latin font (${name})`, async () => {
      request.cookie = cookie;
      request.acceptLanguage = acceptLanguage;
      const html = await renderMarketingRoot();
      expect(html).toMatch(/^<html lang="ar" dir="rtl">/);
      expect(html).toContain('family=IBM+Plex+Sans+Arabic');
      expect(html).not.toContain('Noto+Sans');
    });
  }

  it('keeps the page markup it had before ADR-0027, with no wrapper of its own', async () => {
    const html = await renderMarketingRoot(<p>content</p>);
    expect(html).toContain('<div class="flex min-h-screen flex-col"><header');
    expect(html).not.toMatch(/<div lang=/);
  });

  it('declares Arabic metadata of its own', async () => {
    const { metadata } = await import('@/app/(marketing)/layout');
    const { siteConfig } = await import('@/config/site');
    expect(metadata.title).toBe(siteConfig.name);
    expect(metadata.description).toBe(siteConfig.description);
    expect(metadata.metadataBase).toEqual(new URL(siteConfig.url));
    expect(siteConfig.locale).toBe('ar');
    expect(siteConfig.direction).toBe('rtl');
  });

  it('shows no language switcher, even to an English visitor', async () => {
    request.cookie = 'en';
    request.acceptLanguage = 'en';
    expect(await renderMarketingRoot()).not.toContain('<select');
  });
});

describe('language switcher in slice 2', () => {
  it('offers Arabic and English, each in its own language, with the current one selected', async () => {
    const { LanguageSwitcherSlot } = await import('@/components/app/LanguageSwitcherSlot');
    request.cookie = 'ar';
    const html = renderToStaticMarkup(await LanguageSwitcherSlot());
    expect(html).toContain('<span>اللغة</span>');
    expect(html).toContain('<option value="ar" lang="ar" selected="">العربية</option>');
    expect(html).toContain('<option value="en" lang="en">English</option>');
    expect(html).not.toContain('value="el"');

    request.cookie = 'en';
    const english = renderToStaticMarkup(await LanguageSwitcherSlot());
    expect(english).toContain('<span>Language</span>');
    expect(english).toContain('<option value="en" lang="en" selected="">English</option>');
  });

  it('renders nothing when only one locale is offered', async () => {
    const { LanguageSwitcher } = await import('@/components/app/LanguageSwitcher');
    const html = renderToStaticMarkup(
      <LanguageSwitcher current="ar" label="Language" options={[{ locale: 'ar', name: 'ع' }]} />,
    );
    expect(html).toBe('');
  });
});

describe('error page', () => {
  it('renders the errors namespace from the provider', async () => {
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    const { ErrorsProvider } = await import('@/i18n/ErrorsProvider');
    const html = renderToStaticMarkup(
      <ErrorsProvider
        messages={{ label: 'L', title: 'T', body: 'B', code: 'C {digest}', retry: 'R' }}
      >
        <ErrorPage error={Object.assign(new Error('x'), { digest: 'd1' })} reset={() => {}} />
      </ErrorsProvider>,
    );
    for (const text of ['>L<', '>T<', '>B<', '>C d1<', '>R<']) expect(html).toContain(text);
  });

  it('falls back to English text if the provider is missing', async () => {
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    const { enErrors } = await import('@/i18n/dictionaries/en-errors');
    const html = renderToStaticMarkup(<ErrorPage error={new Error('x')} reset={() => {}} />);
    expect(html).toContain(enErrors.title);
    expect(html).toContain(enErrors.retry);
  });

  it('inside the staff root layout, follows the staff locale', async () => {
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    const { ar } = await import('@/i18n/dictionaries/ar');
    const { en } = await import('@/i18n/dictionaries/en');
    request.cookie = 'ar';
    const arabic = await renderServer(
      (await import('@/app/(staff)/layout')).default({
        children: <ErrorPage error={new Error('x')} reset={() => {}} />,
      }),
    );
    expect(arabic).toContain(ar.errors.title);
    request.cookie = 'en';
    const english = await renderServer(
      (await import('@/app/(staff)/layout')).default({
        children: <ErrorPage error={new Error('x')} reset={() => {}} />,
      }),
    );
    expect(english).toContain(en.errors.title);
  });

  it('inside the marketing root layout, stays Arabic for an English visitor', async () => {
    const { default: MarketingError } = await import('@/app/(marketing)/error');
    const { arErrors } = await import('@/i18n/dictionaries/ar-errors');
    const { enErrors } = await import('@/i18n/dictionaries/en-errors');
    request.cookie = 'en';
    request.acceptLanguage = 'en';
    const html = await renderMarketingRoot(
      <MarketingError error={new Error('x')} reset={() => {}} />,
    );
    expect(html).toContain(arErrors.title);
    expect(html).toContain(arErrors.retry);
    expect(html).not.toContain(enErrors.title);
    expect(html).not.toContain('<select');
    // The spacing wrapper is empty there, and `empty:hidden` hides it.
    expect(html).toContain('<div class="px-6 pt-4 empty:hidden"></div>');
  });
});

describe('routes outside the staff group', () => {
  it('the marketing error boundary is the same error page', async () => {
    const { default: MarketingError } = await import('@/app/(marketing)/error');
    const { default: StaffError } = await import('@/app/(staff)/error');
    expect(MarketingError).toBe(StaffError);
  });

  it('a URL that matches no route is sent to the staff 404 page', async () => {
    const { default: UnmatchedRoute } = await import('@/app/(staff)/[...unmatched]/page');
    expect(() => UnmatchedRoute()).toThrow(
      expect.objectContaining({ digest: expect.stringMatching(/;404$/) }),
    );
  });
});

describe('language switcher on every staff screen', () => {
  const noError = Object.assign(new Error('x'), { digest: 'd1' });

  for (const locale of ['ar', 'en'] as const) {
    it(`the 404 page renders its ${locale} content and the switcher`, async () => {
      const { default: NotFound } = await import('@/app/(staff)/not-found');
      const { getDictionary } = await import('@/i18n/dictionaries');
      request.cookie = locale;
      const html = await renderServer(<NotFound />);
      expect(html).toContain(getDictionary(locale).notFound.title);
      expect(html).toMatch(/^<div class="px-6 pt-4 empty:hidden"><label[^>]*>.*<select/);
      expect(html).toContain(`<option value="${locale}" lang="${locale}" selected="">`);
    });
  }

  it('the error page inside the staff root layout renders the switcher', async () => {
    const { default: StaffRootLayout } = await import('@/app/(staff)/layout');
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    request.cookie = 'en';
    const html = await renderServer(
      StaffRootLayout({ children: <ErrorPage error={noError} reset={() => {}} /> }),
    );
    expect(html).toContain('<button type="button"');
    expect(html).toMatch(/<div class="px-6 pt-4 empty:hidden"><label[^>]*>.*<select/);
    expect(html).toContain('<option value="en" lang="en" selected="">English</option>');
  });

  it('the sign-in pages and the app navigation render the switcher', async () => {
    const { default: AuthLayout } = await import('@/app/(staff)/(auth)/layout');
    const { AppShellNav } = await import('@/components/app/AppShellNav');
    request.cookie = 'en';
    const auth = await renderServer(AuthLayout({ children: 'login' }));
    expect(auth).toMatch(
      /^<div class="px-6 pt-4 empty:hidden"><label[^>]*><span>Language<\/span><select/,
    );
    expect(auth).toMatch(/login$/);
    const nav = await renderServer(<AppShellNav role="owner" />);
    expect(nav).toContain('<nav aria-label="Dashboard navigation"');
    expect(nav).toContain('<select');
  });
});
