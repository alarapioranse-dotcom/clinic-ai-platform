'use client';

import { ContextLanguageSwitcher } from '@/components/app/LanguageSwitcherContext';
import { format } from '@/i18n/format';
import { useErrorsMessages } from '@/i18n/ErrorsProvider';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useErrorsMessages();

  // The language switcher (ADR-0027 decision 3a): this page replaces the
  // (app) and (auth) layouts and their switcher, so it takes the switcher's
  // props from the staff root layout. Under the marketing root layout, which
  // provides none, and while only one locale exists, it renders nothing.
  return (
    <>
      <ContextLanguageSwitcher />
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="text-muted font-mono text-sm">{t.label}</p>
          <h1 className="font-display mt-2 text-2xl font-bold">{t.title}</h1>
          <p className="text-muted mt-3 text-sm">{t.body}</p>
          {error.digest ? (
            <p className="text-muted mt-2 font-mono text-xs">
              {format(t.code, { digest: error.digest })}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="bg-pine mt-6 rounded-full px-6 py-2 text-sm font-medium text-white"
          >
            {t.retry}
          </button>
        </div>
      </div>
    </>
  );
}
