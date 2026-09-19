'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

interface KnowledgeDocumentRow {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; documents: KnowledgeDocumentRow[] };

/**
 * docs/product/06-acceptance-criteria.md's /dashboard/knowledge-base: an
 * empty clinic sees "No knowledge documents yet...", and a backend failure
 * shows "Couldn't load knowledge base" with a retry action — same
 * client-fetch pattern as `PatientsList`/`ConversationsList`.
 */
export function KnowledgeDocumentsList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/knowledge-documents');
      if (!response.ok) {
        throw new Error(`GET /api/knowledge-documents returned ${response.status}`);
      }
      const body: { data: KnowledgeDocumentRow[] } = await response.json();
      setState({ status: 'ready', documents: body.data });
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

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/knowledge-documents/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`DELETE /api/knowledge-documents/${id} returned ${response.status}`);
      }
      await load();
    } finally {
      setDeletingId(null);
    }
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
          تعذر تحميل قاعدة المعرفة
        </p>
        <Button variant="secondary" onClick={handleRetry} className="mt-3">
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (state.documents.length === 0) {
    return (
      <p className="text-muted mt-8 text-sm">
        لا توجد مستندات معرفة بعد — لن يتمكن المساعد من الإجابة حتى تضيف واحدًا
      </p>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {state.documents.map((document) => (
        <div
          key={document.id}
          className="border-line flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium">{document.title}</p>
            <p className="text-muted mt-1 text-xs">
              آخر تحديث: {new Date(document.updatedAt).toLocaleDateString('ar')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/dashboard/knowledge-base/${document.id}/edit`}>
              <Button variant="secondary">تعديل</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() => handleDelete(document.id)}
              disabled={deletingId === document.id}
            >
              {deletingId === document.id ? 'جارٍ الحذف...' : 'حذف'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
