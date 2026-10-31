'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import { BookAppointment } from './BookAppointment';

interface MessageRow {
  id: string;
  senderType: string;
  content: string;
  sentAt: string;
}

interface AppointmentRow {
  id: string;
  practitionerId: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

interface ConversationDetail {
  conversation: {
    id: string;
    patientId: string;
    createdAt: string;
  };
  messages: MessageRow[];
  appointments: AppointmentRow[];
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; detail: ConversationDetail };

/** Roles allowed to reply (docs/technical/03-api-contracts.md, P3-C: same
 * matrix as `POST /api/patients` — practitioner stays read-only, ADR-0004).
 * The UI check below is a convenience only: `POST
 * /api/conversations/:id/messages` enforces this independently and is the
 * actual authorization boundary. */
const REPLY_ROLES = new Set(['owner', 'admin', 'receptionist']);

/** Same matrix as `POST /api/appointments` (roadmap P4 Slice 1) — booking is
 * a receptionist/staff action, not a practitioner one (ADR-0004). Same
 * "convenience only" caveat as REPLY_ROLES above. */
const BOOK_ROLES = new Set(['owner', 'admin', 'receptionist']);

type ReplyState = { status: 'idle' | 'sending' | 'error' };

/**
 * Same fetch/loading/error pattern as
 * src/app/(staff)/(app)/dashboard/patients/PatientsList.tsx, plus a distinct
 * not-found state for the 404 GET /api/conversations/:id returns for a
 * nonexistent, cross-clinic, or malformed ID (docs/technical/03-api-contracts.md's
 * 404-vs-403 rule — those three cases are deliberately indistinguishable
 * here too). Roadmap P3-C adds the reply form below the message list, shown
 * only to the roles `POST /api/conversations/:id/messages` actually allows.
 */
export function ConversationDetail({
  locale,
  t,
  bookingT,
}: {
  locale: Locale;
  t: Dictionary['conversationDetail'];
  bookingT: Dictionary['booking'];
}) {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [role, setRole] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ReplyState>({ status: 'idle' });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`);
      if (response.status === 404) {
        setState({ status: 'not-found' });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET /api/conversations/${conversationId} returned ${response.status}`);
      }
      const body: { data: ConversationDetail } = await response.json();
      setState({ status: 'ready', detail: body.data });
    } catch {
      setState({ status: 'error' });
    }
  }, [conversationId]);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session');
      if (!response.ok) return;
      const body: { data: { role: string } } = await response.json();
      setRole(body.data.role);
    } catch {
      // Reply controls just stay hidden — the API remains the real
      // authorization boundary regardless of this call's outcome.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadSession();
  }, [load, loadSession]);

  function handleRetry() {
    setState({ status: 'loading' });
    load();
  }

  async function sendReply() {
    if (!draft.trim()) return;
    setReply({ status: 'sending' });
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!response.ok) {
        setReply({ status: 'error' });
        return;
      }
      const body: { data: MessageRow } = await response.json();
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              detail: { ...current.detail, messages: [...current.detail.messages, body.data] },
            }
          : current,
      );
      setDraft('');
      setReply({ status: 'idle' });
    } catch {
      setReply({ status: 'error' });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/dashboard/conversations" className="text-pine hover:text-pine-deep text-sm">
        {t.back}
      </Link>

      {state.status === 'loading' && (
        <p role="status" className="text-muted mt-8 text-sm">
          {t.loading}
        </p>
      )}

      {state.status === 'error' && (
        <div className="mt-8">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.loadError}
          </p>
          <Button variant="secondary" onClick={handleRetry} className="mt-3">
            {t.retry}
          </Button>
        </div>
      )}

      {state.status === 'not-found' && <p className="text-muted mt-8 text-sm">{t.notFound}</p>}

      {state.status === 'ready' && (
        <div className="mt-8">
          <h1 className="font-display text-2xl font-bold">{t.title}</h1>
          <p className="text-muted mt-2 text-sm">
            {format(t.startedOn, {
              date: new Date(state.detail.conversation.createdAt).toLocaleDateString(locale),
            })}
          </p>

          <ul className="border-line mt-6 flex flex-col gap-4 border-t pt-6">
            {state.detail.messages.map((message) => (
              <li key={message.id} className="border-line rounded-lg border p-4">
                <p className="text-muted text-xs">
                  {message.senderType} · {new Date(message.sentAt).toLocaleString(locale)}
                </p>
                <p className="mt-1 text-sm">{message.content}</p>
              </li>
            ))}
          </ul>

          {role !== null && REPLY_ROLES.has(role) && (
            <div className="border-line mt-6 flex flex-col gap-3 border-t pt-6">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={reply.status === 'sending'}
                placeholder={t.replyPlaceholder}
                rows={3}
                className="border-line bg-paper text-ink placeholder:text-muted w-full rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />

              {reply.status === 'error' && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {t.replyFailed}
                </p>
              )}

              <div>
                <Button onClick={sendReply} disabled={reply.status === 'sending' || !draft.trim()}>
                  {reply.status === 'sending' ? t.sending : t.send}
                </Button>
                {reply.status === 'error' && (
                  <Button variant="secondary" onClick={sendReply} className="ms-3">
                    {t.retry}
                  </Button>
                )}
              </div>
            </div>
          )}

          {state.detail.appointments.length > 0 && (
            <div className="border-line mt-6 flex flex-col gap-3 border-t pt-6">
              <h2 className="font-display text-lg font-bold">{t.appointments}</h2>
              <ul className="flex flex-col gap-3">
                {state.detail.appointments.map((appointment) => (
                  <li key={appointment.id} className="border-line rounded-lg border p-4 text-sm">
                    {new Date(appointment.startsAt).toLocaleString(locale)} —{' '}
                    {new Date(appointment.endsAt).toLocaleString(locale)}
                    <span className="text-muted ms-2">({appointment.status})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {role !== null && BOOK_ROLES.has(role) && (
            <BookAppointment
              conversationId={state.detail.conversation.id}
              patientId={state.detail.conversation.patientId}
              onBooked={load}
              locale={locale}
              t={bookingT}
            />
          )}
        </div>
      )}
    </div>
  );
}
