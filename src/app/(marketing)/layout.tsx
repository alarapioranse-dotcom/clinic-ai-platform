import type { Metadata } from 'next';

import { RootDocument } from '@/app/RootDocument';
import { LanguageSwitcherProvider } from '@/components/app/LanguageSwitcherContext';
import { Footer } from '@/components/marketing/Footer';
import { Header } from '@/components/marketing/Header';
import { siteConfig } from '@/config/site';
import { AVAILABLE_LOCALES } from '@/i18n/dictionaries';
import { languageOptions } from '@/i18n/language-options';
import { getMarketingDictionary } from '@/i18n/marketing';
import { getI18n } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.common.appName,
    description: t.common.appDescription,
    metadataBase: new URL(siteConfig.url),
  };
}

/**
 * Root layout of the public pages (`/` and `/privacy`). Since ADR-0029 they
 * follow the visitor's locale exactly as the staff UI does: the `locale`
 * cookie, then Accept-Language, then Greek. `lang` and `dir` follow it, and
 * the header carries the same language switcher. The provider lets the error
 * page, a client component, show the switcher too.
 */
export default async function MarketingRootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir, t } = await getI18n();
  const m = getMarketingDictionary(locale);
  return (
    <RootDocument locale={locale} dir={dir} t={t}>
      <LanguageSwitcherProvider
        value={{
          current: locale,
          options: languageOptions(AVAILABLE_LOCALES),
          label: t.common.languageSwitcherLabel,
        }}
      >
        <div className="flex min-h-screen flex-col">
          <Header appName={t.common.appName} t={m.nav} />
          <main className="flex-1">{children}</main>
          <Footer appName={t.common.appName} t={m.footer} />
        </div>
      </LanguageSwitcherProvider>
    </RootDocument>
  );
}
