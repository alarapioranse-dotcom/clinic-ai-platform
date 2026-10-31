import type { Metadata } from 'next';

import { RootDocument } from '@/app/RootDocument';
import { LanguageSwitcherProvider } from '@/components/app/LanguageSwitcherContext';
import { siteConfig } from '@/config/site';
import { AVAILABLE_LOCALES } from '@/i18n/dictionaries';
import { languageOptions } from '@/i18n/language-options';
import { getI18n } from '@/i18n/server';

/**
 * Root layout of the staff UI: sign-in, invitation, the signed-in dashboard
 * and the 404 page. `lang`, `dir`, title and description follow the active
 * staff UI locale (ADR-0027 decisions 3 and 5). The marketing pages have
 * their own root layout, which is always Arabic (src/app/(marketing)/layout.tsx).
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.common.appName,
    description: t.common.appDescription,
    metadataBase: new URL(siteConfig.url),
  };
}

/**
 * The switcher's props are provided to the whole staff UI so that the error
 * page, a client component that replaces the (app) and (auth) layouts, can
 * still show the switcher (ADR-0027 decision 3a).
 */
export default async function StaffRootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir, t } = await getI18n();
  return (
    <RootDocument locale={locale} dir={dir} t={t}>
      <LanguageSwitcherProvider
        value={{
          current: locale,
          options: languageOptions(AVAILABLE_LOCALES),
          label: t.common.languageSwitcherLabel,
        }}
      >
        {children}
      </LanguageSwitcherProvider>
    </RootDocument>
  );
}
