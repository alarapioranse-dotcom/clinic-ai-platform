import type { Metadata } from 'next';

import { Footer } from '@/components/marketing/Footer';
import { Header } from '@/components/marketing/Header';
import { RootDocument } from '@/app/RootDocument';
import { siteConfig } from '@/config/site';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
};

/**
 * Root layout of the marketing pages, which are Arabic-only (ADR-0027 "What
 * this ADR does not decide"). It never reads the staff locale cookie or
 * Accept-Language: the document is `lang="ar" dir="rtl"` for every visitor,
 * with Arabic metadata, environment notice and error text.
 */
export default function MarketingRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument locale="ar" dir="rtl" t={getDictionary('ar')}>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </RootDocument>
  );
}
