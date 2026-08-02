import Link from 'next/link';

import { appNav } from '@/config/navigation';
import { siteConfig } from '@/config/site';

export function AppShellNav() {
  return (
    <header className="border-line border-b py-4">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6">
        <Link href="/dashboard" className="font-display text-base font-bold">
          {siteConfig.name}
        </Link>
        <nav aria-label="التنقل داخل لوحة التحكم">
          <ul className="flex items-center gap-6">
            {appNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted hover:text-ink text-sm font-medium">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
