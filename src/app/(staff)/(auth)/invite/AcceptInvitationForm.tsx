'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import {
  INVITE_PASSWORD_MAX_LENGTH,
  INVITE_PASSWORD_MIN_LENGTH,
  codePointLength,
  takeInvitationToken,
} from './invite-token';

type State =
  | { status: 'reading' }
  | { status: 'missing' }
  | { status: 'ready'; message: string | null }
  | { status: 'submitting' }
  | { status: 'accepted' }
  | { status: 'invalid' }
  | { status: 'account_exists' };

/**
 * docs/product/06-acceptance-criteria.md (invite acceptance) as constrained
 * by ADR-0023 and Owner decisions I1–I3:
 * - the token is read from the URL fragment once and kept only in a ref;
 * - success shows a confirmation and a sign-in button (no session is
 *   created by acceptance);
 * - unknown, used and expired links share one message;
 * - a backend failure keeps the form and the token, since nothing was
 *   consumed.
 * Password fields are uncontrolled, as in LoginForm, so the typed password is
 * never reflected into the DOM `value` attribute.
 */
export function AcceptInvitationForm({ t }: { t: Dictionary['acceptInvitation'] }) {
  const passwordLengthMessage = format(t.passwordLength, {
    min: INVITE_PASSWORD_MIN_LENGTH,
    max: INVITE_PASSWORD_MAX_LENGTH,
  });
  const signInLink = (
    <Link
      href="/login"
      className="bg-pine hover:bg-pine-deep inline-flex w-full items-center justify-center rounded-full px-6 py-2 text-sm font-medium text-white transition-colors"
    >
      {t.signIn}
    </Link>
  );
  const tokenRef = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<State>({ status: 'reading' });

  useEffect(() => {
    // Read once. The ref survives React Strict Mode's double effect run in
    // development, where the fragment has already been removed.
    if (tokenRef.current === undefined) {
      tokenRef.current = takeInvitationToken(window.location, window.history);
    }
    setState(tokenRef.current ? { status: 'ready', message: null } : { status: 'missing' });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const token = tokenRef.current;

    if (!token) {
      setState({ status: 'missing' });
      return;
    }
    const length = codePointLength(password);
    if (length < INVITE_PASSWORD_MIN_LENGTH || length > INVITE_PASSWORD_MAX_LENGTH) {
      setState({ status: 'ready', message: passwordLengthMessage });
      return;
    }

    setState({ status: 'submitting' });
    let response: Response;
    try {
      response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
    } catch {
      setState({ status: 'ready', message: t.failed });
      return;
    }

    if (response.ok) {
      tokenRef.current = null;
      setState({ status: 'accepted' });
      return;
    }

    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      code = undefined;
    }

    if (code === 'invitation_invalid') {
      tokenRef.current = null;
      setState({ status: 'invalid' });
    } else if (code === 'account_exists') {
      tokenRef.current = null;
      setState({ status: 'account_exists' });
    } else if (code === 'invalid_password') {
      setState({ status: 'ready', message: passwordLengthMessage });
    } else {
      setState({ status: 'ready', message: t.failed });
    }
  }

  if (state.status === 'reading') {
    return (
      <p role="status" className="text-muted mt-8 text-center text-sm">
        {t.loading}
      </p>
    );
  }

  if (state.status === 'missing' || state.status === 'invalid') {
    return (
      <div className="mt-8 space-y-2 text-center">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.invalidLink}
        </p>
        <p className="text-muted text-sm">{t.askForNew}</p>
      </div>
    );
  }

  if (state.status === 'account_exists') {
    return (
      <div className="mt-8 space-y-4 text-center">
        <p role="alert" className="text-sm font-medium">
          {t.accountExists}
        </p>
        {signInLink}
      </div>
    );
  }

  if (state.status === 'accepted') {
    return (
      <div className="mt-8 space-y-4 text-center">
        <p role="status" className="text-pine text-sm font-medium">
          {t.accepted}
        </p>
        {signInLink}
      </div>
    );
  }

  const submitting = state.status === 'submitting';
  const message = state.status === 'ready' ? state.message : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          {t.password}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
        />
        <p className="text-muted mt-1 text-xs">
          {format(t.passwordHint, {
            min: INVITE_PASSWORD_MIN_LENGTH,
            max: INVITE_PASSWORD_MAX_LENGTH,
          })}
        </p>
      </div>
      {message && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
