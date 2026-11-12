import { CapabilitiesGrid } from '@/components/marketing/CapabilitiesGrid';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { LaunchStatus } from '@/components/marketing/LaunchStatus';
import { getMarketingDictionary } from '@/i18n/marketing';
import { getLocale } from '@/i18n/server';

/** The public home page, in the visitor's language (ADR-0029). */
export default async function MarketingHomePage() {
  const m = getMarketingDictionary(await getLocale());
  return (
    <>
      <Hero t={m.hero} />
      <HowItWorks t={m.how} />
      <CapabilitiesGrid t={m.capabilities} />
      <LaunchStatus t={m.launch} />
    </>
  );
}
