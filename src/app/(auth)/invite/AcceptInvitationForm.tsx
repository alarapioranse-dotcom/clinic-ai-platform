'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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

const PASSWORD_LENGTH_MESSAGE = `كلمة المرور يجب أن تكون بين ${INVITE_PASSWORD_MIN_LENGTH} و${INVITE_PASSWORD_MAX_LENGTH} حرفًا.`;

const signInLink = (
  <Link
    href="/login"
    className="bg-pine hover:bg-pine-deep inline-flex w-full items-center justify-center rounded-full px-6 py-2 text-sm font-medium text-white transition-colors"
  >
    تسجيل الدخول
  </Link>
);

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
export function AcceptInvitationForm() {
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
    const confirmation = String(form.get('confirmPassword') ?? '');
    const token = tokenRef.current;

    if (!token) {
      setState({ status: 'missing' });
      return;
    }
    const length = codePointLength(password);
    if (length < INVITE_PASSWORD_MIN_LENGTH || length > INVITE_PASSWORD_MAX_LENGTH) {
      setState({ status: 'ready', message: PASSWORD_LENGTH_MESSAGE });
      return;
    }
    if (password !== confirmation) {
      setState({ status: 'ready', message: 'كلمتا المرور غير متطابقتين.' });
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
      setState({ status: 'ready', message: 'تعذر إكمال إنشاء حسابك، حاول مرة أخرى.' });
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
      setState({ status: 'ready', message: PASSWORD_LENGTH_MESSAGE });
    } else {
      setState({ status: 'ready', message: 'تعذر إكمال إنشاء حسابك، حاول مرة أخرى.' });
    }
  }

  if (state.status === 'reading') {
    return (
      <p role="status" className="text-muted mt-8 text-center text-sm">
        جارٍ التحميل...
      </p>
    );
  }

  if (state.status === 'missing' || state.status === 'invalid') {
    return (
      <div className="mt-8 space-y-2 text-center">
        <p role="alert" className="text-sm font-medium text-red-700">
          رابط الدعوة هذا لم يعد صالحًا.
        </p>
        <p className="text-muted text-sm">اطلب دعوة جديدة من مالك العيادة أو المسؤول.</p>
      </div>
    );
  }

  if (state.status === 'account_exists') {
    return (
      <div className="mt-8 space-y-4 text-center">
        <p role="alert" className="text-sm font-medium">
          يوجد حساب بهذا البريد الإلكتروني بالفعل. سجّل الدخول بدلًا من ذلك.
        </p>
        {signInLink}
      </div>
    );
  }

  if (state.status === 'accepted') {
    return (
      <div className="mt-8 space-y-4 text-center">
        <p role="status" className="text-pine text-sm font-medium">
          تم إنشاء حسابك. سجّل الدخول ببريدك الإلكتروني وكلمة المرور التي اخترتها.
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
          كلمة المرور
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
          من {INVITE_PASSWORD_MIN_LENGTH} إلى {INVITE_PASSWORD_MAX_LENGTH} حرفًا. لا شروط أخرى.
        </p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
          تأكيد كلمة المرور
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
        />
      </div>
      {message && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}
      </Button>
    </form>
  );
}
