import { LanguageSwitcherSlot } from '@/components/app/LanguageSwitcherSlot';

/**
 * The sign-in and invitation pages offer the language switcher too
 * (ADR-0027 decision 3a). It renders nothing while only one locale has a
 * dictionary, so these pages are unchanged in slice 1.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LanguageSwitcherSlot />
      {children}
    </>
  );
}
