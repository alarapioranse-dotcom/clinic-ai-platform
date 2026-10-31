'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { Locale } from '@/i18n/config';

import { LanguageSwitcher, type LanguageOption } from './LanguageSwitcher';

interface SwitcherProps {
  current: Locale;
  options: readonly LanguageOption[];
  label: string;
}

const SwitcherContext = createContext<SwitcherProps | null>(null);

/**
 * Hands the language switcher's props to client components that cannot
 * render the server-side LanguageSwitcherSlot: the staff error page
 * (src/app/(staff)/error.tsx), which replaces the (app) and (auth) layouts
 * and with them their switcher. The staff root layout provides it; the
 * marketing root layout does not, so the marketing error page shows no
 * switcher (the marketing pages are Arabic-only).
 */
export function LanguageSwitcherProvider({
  value,
  children,
}: {
  value: SwitcherProps;
  children: ReactNode;
}) {
  return <SwitcherContext.Provider value={value}>{children}</SwitcherContext.Provider>;
}

/** The switcher from the nearest provider; nothing without one (or with one locale). */
export function ContextLanguageSwitcher() {
  const props = useContext(SwitcherContext);
  return props ? <LanguageSwitcher {...props} /> : null;
}
