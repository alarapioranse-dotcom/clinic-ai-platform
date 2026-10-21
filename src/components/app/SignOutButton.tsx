'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signOutOutcome } from './sign-out';

type SignOutState = 'idle' | 'signing_out' | 'error';

/**
 * Signs the current staff member out through the existing
 * POST /api/auth/sign-out (which revokes the session server-side and clears
 * the cookie), then sends them to /login.
 */
export function SignOutButton() {
  const router = useRouter();
  const [state, setState] = useState<SignOutState>('idle');

  async function signOut() {
    setState('signing_out');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (signOutOutcome(response.status) === 'error') {
        setState('error');
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <span className="flex items-center gap-2">
      {state === 'error' ? (
        <span role="alert" className="text-sm text-red-700">
          تعذّر تسجيل الخروج.
        </span>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        disabled={state === 'signing_out'}
        className="text-muted hover:text-ink text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === 'signing_out'
          ? 'جارٍ تسجيل الخروج…'
          : state === 'error'
            ? 'إعادة المحاولة'
            : 'تسجيل الخروج'}
      </button>
    </span>
  );
}
