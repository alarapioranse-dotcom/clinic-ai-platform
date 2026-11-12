import Link from 'next/link';

import { Container } from '@/components/ui/Container';
import type { MarketingDictionary } from '@/i18n/marketing';

export function Footer({ appName, t }: { appName: string; t: MarketingDictionary['footer'] }) {
  return (
    <footer className="border-line border-t py-8">
      <Container className="text-muted flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
        <p>
          © {new Date().getFullYear()} {appName}. {t.rights}
        </p>
        <Link href="/privacy" className="underline">
          {t.privacy}
        </Link>
      </Container>
    </footer>
  );
}
