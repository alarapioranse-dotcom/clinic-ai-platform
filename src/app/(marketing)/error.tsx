'use client';

import { ErrorPageBody, type ErrorPageProps } from '@/components/app/ErrorPageBody';

/**
 * The marketing pages have their own root layout, so they need their own
 * error boundary. It shows the same message as the staff error page, in the
 * visitor's language (ADR-0029), and no switcher of its own: the marketing
 * header, which stays on screen, already carries one.
 */
export default function MarketingErrorPage(props: ErrorPageProps) {
  return <ErrorPageBody {...props} />;
}
