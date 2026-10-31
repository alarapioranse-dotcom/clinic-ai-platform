import Link from 'next/link';

import { LanguageSwitcherSlot } from '@/components/app/LanguageSwitcherSlot';
import { getI18n } from '@/i18n/server';

export default async function NotFound() {
  const { t } = await getI18n();

  // The language switcher, as on every in-scope screen (ADR-0027 decision
  // 3a), in the same place as on the sign-in pages: before the page content.
  // It renders nothing while only one locale has a dictionary.
  return (
    <>
      <LanguageSwitcherSlot />
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="text-muted font-mono text-sm">404</p>
          <h1 className="font-display mt-2 text-2xl font-bold">{t.notFound.title}</h1>
          <p className="text-muted mt-3 text-sm">{t.notFound.body}</p>
          <Link
            href="/"
            className="bg-pine mt-6 inline-block rounded-full px-6 py-2 text-sm font-medium text-white"
          >
            {t.notFound.home}
          </Link>
        </div>
      </div>
    </>
  );
}
