import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderServer } from './render-server';

/**
 * ADR-0027 slice 1 at the rendered level, with the request's cookie and
 * Accept-Language header mocked: each root layout's document lang/dir, the
 * Arabic-only marketing document and metadata, the error and 404 routes, and
 * the hidden switcher. layout-locales.test.tsx covers the same layouts once
 * Greek and English dictionaries exist.
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
  ['Accept-Language el', undefined, 'el-GR,el;q=0.9'],
  ['Accept-Language en', undefined, 'en-US,en;q=0.9'],
  ['cookie el', 'el', null],
  ['cookie en', 'en', 'en'],
];

describe('staff root layout in slice 1', () => {
  for (const [name, cookie, acceptLanguage] of visitors) {
    it(`renders Arabic, right-to-left, with no Greek/Latin font (${name})`, async () => {
      request.cookie = cookie;
      request.acceptLanguage = acceptLanguage;
      const html = await renderStaffRoot();
      expect(html).toMatch(/^<html lang="ar" dir="rtl">/);
      expect(html).toContain('family=IBM+Plex+Sans+Arabic');
      expect(html).not.toContain('Noto+Sans');
    });
  }

  it('gives Arabic metadata', async () => {
    const { generateMetadata } = await import('@/app/(staff)/layout');
    const metadata = await generateMetadata();
    expect(metadata.title).toBe('منصة العيادة الذكية');
    expect(metadata.description).toMatch(/\p{Script=Arabic}/u);
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
});

describe('language switcher in slice 1', () => {
  it('renders nothing while only one locale has a dictionary', async () => {
    const { LanguageSwitcherSlot } = await import('@/components/app/LanguageSwitcherSlot');
    expect(renderToStaticMarkup(await LanguageSwitcherSlot())).toBe('');
  });

  it('renders a select once a second locale exists', async () => {
    const { LanguageSwitcher } = await import('@/components/app/LanguageSwitcher');
    const html = renderToStaticMarkup(
      <LanguageSwitcher
        current="ar"
        label="Language"
        options={[
          { locale: 'ar', name: 'العربية' },
          { locale: 'en', name: 'English' },
        ]}
      />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('<option value="en" lang="en">English</option>');
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

  it('still renders Arabic text if the provider is missing', async () => {
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    const { arErrors } = await import('@/i18n/dictionaries/ar-errors');
    const html = renderToStaticMarkup(<ErrorPage error={new Error('x')} reset={() => {}} />);
    expect(html).toContain(arErrors.title);
    expect(html).toContain(arErrors.retry);
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

describe('language switcher on every staff screen, hidden in slice 1', () => {
  const noError = Object.assign(new Error('x'), { digest: 'd1' });

  it('the 404 page renders its Arabic content and no switcher', async () => {
    const { default: NotFound } = await import('@/app/(staff)/not-found');
    const { ar } = await import('@/i18n/dictionaries/ar');
    const html = await renderServer(<NotFound />);
    expect(html).toContain(ar.notFound.title);
    expect(html).not.toContain('<select');
    expect(html).toMatch(/^<div class="flex min-h-screen items-center justify-center px-6">/);
  });

  it('the error page inside the staff root layout renders no switcher', async () => {
    const { default: StaffRootLayout } = await import('@/app/(staff)/layout');
    const { default: ErrorPage } = await import('@/app/(staff)/error');
    const html = await renderServer(
      StaffRootLayout({ children: <ErrorPage error={noError} reset={() => {}} /> }),
    );
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('<select');
  });

  it('the sign-in pages and the app navigation render no switcher', async () => {
    const { default: AuthLayout } = await import('@/app/(staff)/(auth)/layout');
    const { AppShellNav } = await import('@/components/app/AppShellNav');
    expect(await renderServer(AuthLayout({ children: 'login' }))).toBe('login');
    const nav = await renderServer(<AppShellNav role="owner" />);
    expect(nav).toContain('<nav');
    expect(nav).not.toContain('<select');
  });
});
