'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * docs/product/06-acceptance-criteria.md's /login: a 401 shows a generic
 * "Invalid email or password" (never which field was wrong), a
 * network/backend failure shows a distinct retry message while keeping the
 * entered email, and success goes to /dashboard.
 */
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // The password field is uncontrolled (read via FormData, not React
    // state) so it is never a React-managed `value` — React reflects a
    // controlled input's value onto the DOM `value` attribute on every
    // render, which would otherwise put the typed password in the DOM.
    const password = new FormData(event.currentTarget).get('password');

    let response: Response;
    try {
      response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setError('تعذر تسجيل الدخول، حاول مرة أخرى');
      setIsSubmitting(false);
      return;
    }

    if (response.ok) {
      // Full navigation, not router.push: the (app) layout re-reads the
      // session cookie on the server, and this fetch (not a form
      // navigation) is what just set it.
      window.location.href = '/dashboard';
      return;
    }

    setError(
      response.status === 401
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        : 'تعذر تسجيل الدخول، حاول مرة أخرى',
    );
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          البريد الإلكتروني
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          كلمة المرور
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}
      </Button>
    </form>
  );
}
