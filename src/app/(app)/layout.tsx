import { AppShellNav } from '@/components/app/AppShellNav';

/**
 * Signed-in shell. Intentionally empty of auth logic — Phase 0 has no
 * authentication; this route group only exists to establish the layout
 * boundary that a later phase will wire real session checks into.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppShellNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
