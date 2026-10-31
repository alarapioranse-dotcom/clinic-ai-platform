'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Dictionary } from '@/i18n/dictionaries';
import { formatParts } from '@/i18n/format';

type FormState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'invalid'; message: string }
  | { status: 'already_invited' }
  | { status: 'forbidden' }
  | { status: 'error' };

interface CreatedInvitation {
  email: string;
  link: string;
}

/**
 * docs/product/06-acceptance-criteria.md's /dashboard/staff/invite:
 * "already invited" for a duplicate; "Couldn't send invite" with a retry on
 * failure, the entered values kept.
 *
 * The one-time link (ADR-0023 decision 5) is kept only in this component's
 * memory: it is shown once with a copy button and never written to
 * localStorage, sessionStorage, cookies, the URL, or any log.
 */
export function InviteStaffForm({
  roles,
  t,
}: {
  roles: { value: string; label: string }[];
  t: Dictionary['staffInvite'];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[roles.length - 1]?.value ?? '');
  const [state, setState] = useState<FormState>({ status: 'idle' });
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setState({ status: 'invalid', message: t.invalidEmail });
      return;
    }
    setState({ status: 'sending' });
    try {
      const response = await fetch('/api/staff/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 409) {
        setState({ status: 'already_invited' });
        return;
      }
      if (response.status === 403) {
        setState({ status: 'forbidden' });
        return;
      }
      if (response.status === 400) {
        setState({
          status: 'invalid',
          message: t.checkFields,
        });
        return;
      }
      if (response.status !== 201) {
        throw new Error(`POST /api/staff/invitations returned ${response.status}`);
      }
      const body: { data: { invitation: { email: string }; link: string } } = await response.json();
      setCreated({ email: body.data.invitation.email, link: body.data.link });
      setCopied(false);
      setState({ status: 'idle' });
    } catch {
      setState({ status: 'error' });
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function inviteAnother() {
    setCreated(null);
    setCopied(false);
    setEmail('');
    setState({ status: 'idle' });
  }

  if (created) {
    return (
      <div className="mt-8 space-y-4">
        <p role="status" className="text-sm font-medium">
          {formatParts(t.created, { email: <span dir="ltr">{created.email}</span> })}
        </p>
        <p className="text-sm text-red-700">{t.showOnce}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            readOnly
            value={created.link}
            dir="ltr"
            aria-label={t.linkLabel}
            className="flex-1"
          />
          <Button type="button" onClick={copyLink}>
            {copied ? t.copied : t.copy}
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={inviteAnother}>
            {t.another}
          </Button>
          <Link href="/dashboard/staff" className="text-pine self-center text-sm underline">
            {t.backToStaff}
          </Link>
        </div>
      </div>
    );
  }

  const sending = state.status === 'sending';

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
      <div>
        <label htmlFor="invite-email" className="block text-sm font-medium">
          {t.email}
        </label>
        <Input
          id="invite-email"
          type="email"
          dir="ltr"
          autoComplete="off"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setState({ status: 'idle' });
          }}
          className="mt-2"
          required
        />
      </div>

      <div>
        <label htmlFor="invite-role" className="block text-sm font-medium">
          {t.role}
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setState({ status: 'idle' });
          }}
          className="border-line bg-paper mt-2 w-full rounded-lg border px-4 py-2 text-sm"
        >
          {roles.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {state.status === 'invalid' ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
      {state.status === 'already_invited' ? (
        <p role="alert" className="text-sm text-red-700">
          {t.alreadyInvited}
        </p>
      ) : null}
      {state.status === 'forbidden' ? (
        <p role="alert" className="text-sm text-red-700">
          {t.forbidden}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {t.error}
        </p>
      ) : null}

      <Button type="submit" disabled={sending || roles.length === 0}>
        {sending ? t.creating : state.status === 'error' ? t.retry : t.create}
      </Button>
    </form>
  );
}
