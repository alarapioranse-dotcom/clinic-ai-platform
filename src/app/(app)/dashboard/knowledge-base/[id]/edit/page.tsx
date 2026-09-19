'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { KnowledgeDocumentForm } from '../../KnowledgeDocumentForm';

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; document: KnowledgeDocument };

/**
 * Same fetch/loading/error/not-found pattern as
 * `src/app/(app)/dashboard/conversations/[id]/page.tsx`. Loads the existing
 * document, then hands its current title/content to the shared form as
 * initial values.
 */
export default function EditKnowledgeDocumentPage() {
  const params = useParams<{ id: string }>();
  const documentId = params.id;
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/knowledge-documents/${documentId}`);
      if (response.status === 404) {
        setState({ status: 'not-found' });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET /api/knowledge-documents/${documentId} returned ${response.status}`);
      }
      const body: { data: KnowledgeDocument } = await response.json();
      setState({ status: 'ready', document: body.data });
    } catch {
      setState({ status: 'error' });
    }
  }, [documentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard/knowledge-base" className="text-pine hover:text-pine-deep text-sm">
        ← رجوع إلى قاعدة المعرفة
      </Link>
      <h1 className="font-display mt-4 text-2xl font-bold">تعديل مستند المعرفة</h1>

      {state.status === 'loading' && (
        <p role="status" className="text-muted mt-8 text-sm">
          جارٍ التحميل...
        </p>
      )}

      {state.status === 'error' && (
        <div className="mt-8">
          <p role="alert" className="text-sm font-medium text-red-700">
            تعذر تحميل المستند
          </p>
          <Button variant="secondary" onClick={load} className="mt-3">
            إعادة المحاولة
          </Button>
        </div>
      )}

      {state.status === 'not-found' && (
        <p className="text-muted mt-8 text-sm">لم يتم العثور على هذا المستند</p>
      )}

      {state.status === 'ready' && (
        <KnowledgeDocumentForm
          endpoint={`/api/knowledge-documents/${documentId}`}
          method="PATCH"
          initialTitle={state.document.title}
          initialContent={state.document.content}
        />
      )}
    </div>
  );
}
