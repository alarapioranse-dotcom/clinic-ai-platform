import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShellNav } from '@/components/app/AppShellNav';
import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';

/**
 * Signed-in shell. Enforces the session check roadmap P2 requires ("The
 * (app) shell enforces a session check before rendering /dashboard") before
 * rendering anything under this route group. There is no dedicated sign-in
 * page in this slice (P2-A ships the API endpoints only, per its approved
 * scope) — an invalid or missing session redirects to the public marketing
 * page rather than a not-yet-built sign-in screen.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    redirect('/');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppShellNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
