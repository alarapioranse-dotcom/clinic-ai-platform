import Link from 'next/link';

import { appNav, visibleNavItems } from '@/config/navigation';
import { getI18n } from '@/i18n/server';

import { LanguageSwitcherSlot } from './LanguageSwitcherSlot';
import { SignOutButton } from './SignOutButton';

/**
 * `role` comes from the session the (app) layout already validated. It only
 * filters which links render; every screen and API still enforces its own
 * access.
 */
export async function AppShellNav({ role }: { role: string }) {
  const { t } = await getI18n();

  return (
    <header className="border-line border-b py-4">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6">
        <Link href="/dashboard" className="font-display text-base font-bold">
          {t.common.appName}
        </Link>
        <nav aria-label={t.nav.ariaLabel}>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {visibleNavItems(appNav, role).map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted hover:text-ink text-sm font-medium">
                  {t.nav[item.labelKey]}
                </Link>
              </li>
            ))}
            <li>
              <SignOutButton t={t.signOut} />
            </li>
          </ul>
        </nav>
        <LanguageSwitcherSlot />
      </div>
    </header>
  );
}
