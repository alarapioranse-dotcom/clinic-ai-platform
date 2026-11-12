'use client';

import { format } from '@/i18n/format';
import { useErrorsMessages } from '@/i18n/ErrorsProvider';

export interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** The error message and retry button shared by the staff and marketing error pages. */
export function ErrorPageBody({ error, reset }: ErrorPageProps) {
  const t = useErrorsMessages();
  return (
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
  );
}
