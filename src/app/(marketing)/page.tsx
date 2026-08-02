import { CapabilitiesGrid } from '@/components/marketing/CapabilitiesGrid';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { LaunchStatus } from '@/components/marketing/LaunchStatus';

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <CapabilitiesGrid />
      <LaunchStatus />
    </>
  );
}
