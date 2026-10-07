import Link from 'next/link';

import { appNav, visibleNavItems } from '@/config/navigation';
import { siteConfig } from '@/config/site';

/**
 * `role` comes from the session the (app) layout already validated. It only
 * filters which links render; every screen and API still enforces its own
 * access.
 */
export function AppShellNav({ role }: { role: string }) {
  return (
    <header className="border-line border-b py-4">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6">
        <Link href="/dashboard" className="font-display text-base font-bold">
          {siteConfig.name}
        </Link>
        <nav aria-label="التنقل داخل لوحة التحكم">
          <ul className="flex items-center gap-6">
            {visibleNavItems(appNav, role).map((item) => (
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
