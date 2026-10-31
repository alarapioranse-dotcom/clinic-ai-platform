import { EnvironmentNotice } from '@/components/EnvironmentNotice';
import type { Direction, Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { ErrorsProvider } from '@/i18n/ErrorsProvider';

import './globals.css';

/**
 * The `<html>` document both root layouts render (ADR-0027 decision 5):
 * src/app/(marketing)/layout.tsx always with Arabic, and
 * src/app/(staff)/layout.tsx with the staff UI locale. Each route group has
 * its own root layout so that a marketing page's `<html lang dir>` never
 * follows a staff locale preference; navigating between the two groups is a
 * full page load, so the attributes cannot go stale on client navigation.
 *
 * The Arabic fonts and JetBrains Mono load for every locale; the Greek and
 * Latin font (Noto Sans, decision 7) loads only for Greek and English.
 */
export function RootDocument({
  locale,
  dir,
  t,
  children,
}: {
  locale: Locale;
  dir: Direction;
  t: Pick<Dictionary, 'environmentNotice' | 'errors'>;
  children: React.ReactNode;
}) {
  return (
    <html lang={locale} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded via <link>, not next/font, so `next build` has no network dependency. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        {locale === 'ar' ? null : (
          // eslint-disable-next-line @next/next/no-page-custom-font
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700;800&display=swap"
          />
        )}
      </head>
      <body className="bg-paper text-ink font-body antialiased">
        <EnvironmentNotice notices={t.environmentNotice} />
        <ErrorsProvider messages={t.errors}>{children}</ErrorsProvider>
      </body>
    </html>
  );
}
