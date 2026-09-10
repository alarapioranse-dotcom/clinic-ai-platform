'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

interface ConversationRow {
  id: string;
  patientId: string;
  createdAt: string;
}

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; conversations: ConversationRow[] };

/**
 * Same shape as src/app/(app)/dashboard/patients/PatientsList.tsx: a
 * client-side fetch so the retry action can re-run without a full page
 * reload, covering loading/error/empty/ready states.
 */
export function ConversationsList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) {
        throw new Error(`GET /api/conversations returned ${response.status}`);
      }
      const body: { data: ConversationRow[] } = await response.json();
      setState({ status: 'ready', conversations: body.data });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleRetry() {
    setState({ status: 'loading' });
    load();
  }

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-muted mt-8 text-sm">
        جارٍ التحميل...
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-8">
        <p role="alert" className="text-sm font-medium text-red-700">
          تعذر تحميل المحادثات
        </p>
        <Button variant="secondary" onClick={handleRetry} className="mt-3">
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (state.conversations.length === 0) {
    return <p className="text-muted mt-8 text-sm">لا توجد محادثات بعد</p>;
  }

  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-line border-b">
            <th className="text-start px-3 py-2 font-medium">تاريخ البدء</th>
            <th className="text-start px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {state.conversations.map((conversation) => (
            <tr key={conversation.id} className="border-line border-b">
              <td className="px-3 py-2">
                {new Date(conversation.createdAt).toLocaleDateString('ar')}
              </td>
              <td className="px-3 py-2 text-end">
                <Link
                  href={`/dashboard/conversations/${conversation.id}`}
                  className="text-pine hover:text-pine-deep font-medium"
                >
                  عرض
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
