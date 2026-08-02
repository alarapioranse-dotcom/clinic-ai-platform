import Link from 'next/link';

import { Container } from '@/components/ui/Container';
import { marketingNav } from '@/config/navigation';
import { siteConfig } from '@/config/site';

export function Header() {
  return (
    <header className="border-line border-b py-5">
      <Container className="flex items-center justify-between">
        <Link href="/" className="font-display text-lg font-bold">
          {siteConfig.name}
        </Link>
        <nav aria-label="التنقل الرئيسي">
          <ul className="flex items-center gap-6">
            {marketingNav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="text-muted hover:text-ink text-sm font-medium">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
