'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

/** `GET /api/knowledge-documents`'s item shape (no storageKey, clinicId or uploadedBy). */
interface KnowledgeDocumentItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'failed';
  failedReason: string | null;
  createdAt: string;
  readyAt: string | null;
}

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'forbidden' }
  | { status: 'ready'; documents: KnowledgeDocumentItem[] };

/**
 * Owner decision D1: every completed upload starts as `processing`. Nothing
 * in Slice 1C moves a document to `ready` or `failed` — that is a later
 * processing slice — but both are shown correctly if they ever appear.
 */
const STATUS_LABELS: Record<KnowledgeDocumentItem['status'], string> = {
  processing: 'قيد المعالجة',
  ready: 'جاهز',
  failed: 'فشلت المعالجة',
};

const STATUS_CLASSES: Record<KnowledgeDocumentItem['status'], string> = {
  processing: 'border-line text-ink border bg-paper',
  ready: 'bg-mint text-pine-deep',
  failed: 'bg-red-50 text-red-800',
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString('ar', { maximumFractionDigits: 1 })} م.ب`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ar')} ك.ب`;
}

/**
 * docs/product/06-acceptance-criteria.md's /dashboard/knowledge-base: every
 * document for the caller's own clinic with its status, the empty-state
 * message, and "Couldn't load knowledge base" with a retry. Same client-fetch
 * pattern as PatientsList so the retry needs no full page reload.
 */
export function KnowledgeDocumentsList() {
  const router = useRouter();
  const [state, setState] = useState<ListState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/knowledge-documents');
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 403) {
        setState({ status: 'forbidden' });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET /api/knowledge-documents returned ${response.status}`);
      }
      const body: { data: KnowledgeDocumentItem[] } = await response.json();
      const newestFirst = [...body.data].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setState({ status: 'ready', documents: newestFirst });
    } catch {
      setState({ status: 'error' });
    }
  }, [router]);

  useEffect(() => {
    // Fetching from the API on mount is the "external data synchronization"
    // case the rule's own description carves out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleRetry() {
    setState({ status: 'loading' });
    load();
  }

  const uploadLink = (
    <Link
      href="/dashboard/knowledge-base/upload"
      className="bg-pine hover:bg-pine-deep inline-flex items-center justify-center rounded-full px-6 py-2 text-sm font-medium text-white transition-colors"
    >
      رفع مستند
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-muted mt-8 text-sm">
        جارٍ التحميل...
      </p>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <p role="alert" className="mt-8 text-sm font-medium text-red-700">
        ليس لديك صلاحية لعرض قاعدة المعرفة.
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
      <div className="mt-8">
        <p className="text-muted text-sm">
          لا توجد مستندات معرفة بعد — لا يستطيع المساعد الإجابة عن الأسئلة حتى تضيف مستندًا.
        </p>
        <div className="mt-4">{uploadLink}</div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div>{uploadLink}</div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-line border-b">
              <th className="text-start px-3 py-2 font-medium">اسم الملف</th>
              <th className="text-start px-3 py-2 font-medium">الحجم</th>
              <th className="text-start px-3 py-2 font-medium">تاريخ الرفع</th>
              <th className="text-start px-3 py-2 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {state.documents.map((document) => (
              <tr key={document.id} className="border-line border-b align-top">
                <td className="px-3 py-2 break-all" dir="auto">
                  {document.filename}
                </td>
                <td className="px-3 py-2">{formatSize(document.sizeBytes)}</td>
                <td className="px-3 py-2">
                  {new Date(document.createdAt).toLocaleDateString('ar')}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[document.status]}`}
                  >
                    {STATUS_LABELS[document.status]}
                  </span>
                  {document.status === 'failed' && document.failedReason && (
                    <p className="text-muted mt-1 text-xs" dir="auto">
                      {document.failedReason}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
