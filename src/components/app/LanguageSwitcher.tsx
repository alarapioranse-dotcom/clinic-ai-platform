'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { setLocale } from '@/i18n/actions';
import type { Locale } from '@/i18n/config';

export interface LanguageOption {
  locale: Locale;
  name: string;
}

/**
 * ADR-0027 decision 3(a): the staff member's explicit language choice.
 * Renders nothing while fewer than two locales have a dictionary (slice 1:
 * Arabic only), so the screens look exactly as before until a second
 * language exists.
 */
export function LanguageSwitcher({
  current,
  options,
  label,
}: {
  current: Locale;
  options: readonly LanguageOption[];
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (options.length < 2) return null;

  return (
    <label className="text-muted flex items-center gap-2 text-sm">
      <span>{label}</span>
      <select
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            const result = await setLocale(next);
            if (result.ok) router.refresh();
          });
        }}
        className="border-line bg-paper rounded-lg border px-2 py-1 text-sm"
      >
        {options.map((option) => (
          <option key={option.locale} value={option.locale} lang={option.locale}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
