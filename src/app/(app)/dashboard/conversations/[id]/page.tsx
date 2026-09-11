'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

interface MessageRow {
  id: string;
  senderType: string;
  content: string;
  sentAt: string;
}

interface ConversationDetail {
  conversation: {
    id: string;
    patientId: string;
    createdAt: string;
  };
  messages: MessageRow[];
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

type ReplyState = { status: 'idle' | 'sending' | 'error' };

/**
 * Same fetch/loading/error pattern as
 * src/app/(app)/dashboard/patients/PatientsList.tsx, plus a distinct
 * not-found state for the 404 GET /api/conversations/:id returns for a
 * nonexistent, cross-clinic, or malformed ID (docs/technical/03-api-contracts.md's
 * 404-vs-403 rule — those three cases are deliberately indistinguishable
 * here too). Roadmap P3-C adds the reply form below the message list, shown
 * only to the roles `POST /api/conversations/:id/messages` actually allows.
 */
export default function ConversationDetailPage() {
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
        ← رجوع إلى المحادثات
      </Link>

      {state.status === 'loading' && (
        <p role="status" className="text-muted mt-8 text-sm">
          جارٍ التحميل...
        </p>
      )}

      {state.status === 'error' && (
        <div className="mt-8">
          <p role="alert" className="text-sm font-medium text-red-700">
            تعذر تحميل المحادثة
          </p>
          <Button variant="secondary" onClick={handleRetry} className="mt-3">
            إعادة المحاولة
          </Button>
        </div>
      )}

      {state.status === 'not-found' && (
        <p className="text-muted mt-8 text-sm">لم يتم العثور على هذه المحادثة</p>
      )}

      {state.status === 'ready' && (
        <div className="mt-8">
          <h1 className="font-display text-2xl font-bold">محادثة</h1>
          <p className="text-muted mt-2 text-sm">
            بدأت في {new Date(state.detail.conversation.createdAt).toLocaleDateString('ar')}
          </p>

          <ul className="border-line mt-6 flex flex-col gap-4 border-t pt-6">
            {state.detail.messages.map((message) => (
              <li key={message.id} className="border-line rounded-lg border p-4">
                <p className="text-muted text-xs">
                  {message.senderType} · {new Date(message.sentAt).toLocaleString('ar')}
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
                placeholder="اكتب ردك هنا..."
                rows={3}
                className="border-line bg-paper text-ink placeholder:text-muted w-full rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />

              {reply.status === 'error' && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  Message failed to send
                </p>
              )}

              <div>
                <Button onClick={sendReply} disabled={reply.status === 'sending' || !draft.trim()}>
                  {reply.status === 'sending' ? 'جارٍ الإرسال...' : 'إرسال'}
                </Button>
                {reply.status === 'error' && (
                  <Button variant="secondary" onClick={sendReply} className="mr-3">
                    إعادة المحاولة
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
