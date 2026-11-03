import { LanguageSwitcherSlot } from '@/components/app/LanguageSwitcherSlot';

/**
 * The sign-in and invitation pages offer the language switcher too
 * (ADR-0027 decision 3a), spaced off the page edge with logical padding; the
 * wrapper hides itself when the switcher renders nothing (one locale only).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="px-6 pt-4 empty:hidden">
        <LanguageSwitcherSlot />
      </div>
      {children}
    </>
  );
}
