import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';
import { getI18n } from '@/i18n/server';

import { LoginForm } from './LoginForm';

/**
 * docs/product/06-acceptance-criteria.md's `/login`: reachable without a
 * session (outside the (app) guard), but a visitor who already has a valid
 * session is redirected to /dashboard without ever seeing the form.
 */
export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (session) {
    redirect('/dashboard');
  }

  const { t } = await getI18n();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-center text-2xl font-bold">{t.login.title}</h1>
        <p className="text-muted mt-2 text-center text-sm">{t.login.intro}</p>
        <LoginForm t={t.login} />
      </div>
    </div>
  );
}
