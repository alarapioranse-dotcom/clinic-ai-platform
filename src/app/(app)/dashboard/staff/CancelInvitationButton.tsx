'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type CancelState = 'idle' | 'confirming' | 'cancelling' | 'error';

/**
 * Cancels one pending invitation (POST /api/staff/invitations/:id/cancel)
 * after an explicit confirmation, then reloads the list from the server.
 */
export function CancelInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<CancelState>('idle');

  async function cancel() {
    setState('cancelling');
    try {
      const response = await fetch(
        `/api/staff/invitations/${encodeURIComponent(invitationId)}/cancel`,
        { method: 'POST' },
      );
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      // 404: already accepted, expired or cancelled elsewhere — the refreshed
      // list shows the current state either way.
      if (!response.ok && response.status !== 404) {
        throw new Error(`cancel returned ${response.status}`);
      }
      setState('idle');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  if (state === 'confirming' || state === 'cancelling') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">إلغاء الدعوة؟ سيتوقف الرابط عن العمل.</span>
        <Button type="button" onClick={cancel} disabled={state === 'cancelling'}>
          {state === 'cancelling' ? 'جارٍ الإلغاء…' : 'نعم، ألغِ'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setState('idle')}
          disabled={state === 'cancelling'}
        >
          تراجع
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {state === 'error' ? (
        <span role="alert" className="text-sm text-red-700">
          تعذّر إلغاء الدعوة.
        </span>
      ) : null}
      <Button type="button" variant="secondary" onClick={() => setState('confirming')}>
        {state === 'error' ? 'إعادة المحاولة' : 'إلغاء الدعوة'}
      </Button>
    </div>
  );
}
