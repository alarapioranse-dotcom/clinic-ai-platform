import Link from 'next/link';

import { ContextLanguageSwitcher } from '@/components/app/LanguageSwitcherContext';
import { Container } from '@/components/ui/Container';
import type { MarketingDictionary } from '@/i18n/marketing';

/**
 * Header of the public pages. The in-page links point at the home page's
 * sections, so they also work from `/privacy`. The language switcher is the
 * staff UI's (ADR-0029 decision 2), fed by the root layout's provider.
 */
export function Header({ appName, t }: { appName: string; t: MarketingDictionary['nav'] }) {
  const items = [
    { href: '/#how-it-works', label: t.howItWorks },
    { href: '/#capabilities', label: t.capabilities },
    { href: '/#launch-status', label: t.launchStatus },
  ];
  return (
    <header className="border-line border-b py-5">
      <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link href="/" className="font-display text-lg font-bold">
          {appName}
        </Link>
        <nav aria-label={t.label}>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted hover:text-ink text-sm font-medium">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ContextLanguageSwitcher />
      </Container>
    </header>
  );
}
