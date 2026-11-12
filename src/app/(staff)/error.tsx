'use client';

import { ErrorPageBody, type ErrorPageProps } from '@/components/app/ErrorPageBody';
import { ContextLanguageSwitcher } from '@/components/app/LanguageSwitcherContext';

export default function ErrorPage(props: ErrorPageProps) {
  // The language switcher (ADR-0027 decision 3a): this page replaces the
  // (app) and (auth) layouts and their switcher, so it takes the switcher's
  // props from the staff root layout's provider.
  return (
    <>
      <div className="px-6 pt-4 empty:hidden">
        <ContextLanguageSwitcher />
      </div>
      <ErrorPageBody {...props} />
    </>
  );
}
