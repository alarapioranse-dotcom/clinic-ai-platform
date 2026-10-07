'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';

interface UploadKnowledgeDocumentProps {
  allowedMimeType: string;
  maxSizeBytes: number;
}

type Phase = 'idle' | 'initiating' | 'uploading' | 'completing';

/**
 * What the user can do next after a failure:
 * - `restart`: start over from initiation (a fresh presigned URL).
 * - `complete`: the file may already be stored; retry only the completion.
 * - `choose`: pick a different file.
 */
interface UploadError {
  message: string;
  detail?: string;
  next: 'restart' | 'complete' | 'choose';
}

interface PendingCompletion {
  documentId: string;
  filename: string;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function readApiError(response: Response): Promise<ApiErrorBody['error']> {
  try {
    const body: ApiErrorBody = await response.json();
    return body.error;
  } catch {
    return undefined;
  }
}

/**
 * Roadmap P5 Slice 1C upload flow (ADR-0018, ADR-0021; docs/technical/03-api-contracts.md):
 *
 * 1. Preflight in the browser: PDF only, non-empty, within the size limit.
 *    A UX courtesy — the server's completion checks are authoritative.
 * 2. Initiate: POST /api/knowledge-documents → { documentId, uploadUrl }.
 * 3. Direct PUT of the file to object storage at `uploadUrl`, with exactly
 *    the Content-Type the URL was signed for and no credentials. The file
 *    never passes through this application.
 * 4. Complete: POST /api/knowledge-documents/:id/complete. The server checks
 *    size, type and the PDF signature, and only then records the document.
 * 5. Back to the list, where the new document shows as Processing.
 *
 * Nothing is added to the list until completion returns 201 (or 409
 * `conflict`, meaning an earlier attempt already recorded it), so a failure
 * at any stage leaves no partial document behind.
 */
export function UploadKnowledgeDocument({
  allowedMimeType,
  maxSizeBytes,
}: UploadKnowledgeDocumentProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<UploadError | null>(null);
  const [pending, setPending] = useState<PendingCompletion | null>(null);

  const maxSizeMiB = Math.round(maxSizeBytes / (1024 * 1024));
  const busy = phase !== 'idle';

  function preflight(candidate: File): string | null {
    const looksLikePdf =
      candidate.type === allowedMimeType ||
      (candidate.type === '' && candidate.name.toLowerCase().endsWith('.pdf'));
    if (!looksLikePdf) {
      return 'نوع الملف غير مدعوم — يُقبل ملف PDF فقط.';
    }
    if (candidate.size === 0) {
      return 'الملف فارغ.';
    }
    if (candidate.size > maxSizeBytes) {
      return `حجم الملف يتجاوز ${maxSizeMiB} ميغابايت.`;
    }
    return null;
  }

  function finish() {
    router.push('/dashboard/knowledge-base');
  }

  async function complete(target: PendingCompletion) {
    setPhase('completing');
    setError(null);
    try {
      const response = await fetch(`/api/knowledge-documents/${target.documentId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: target.filename }),
      });

      if (response.status === 201) {
        finish();
        return;
      }
      if (response.status === 401) {
        router.push('/login');
        return;
      }

      const apiError = await readApiError(response);
      setPhase('idle');

      if (response.status === 409 && apiError?.code === 'conflict') {
        // An earlier attempt already recorded this document.
        finish();
        return;
      }
      if (response.status === 409 && apiError?.code === 'object_changed') {
        setError({ message: 'تغيّر الملف أثناء التحقق منه. أعد التحقق.', next: 'complete' });
        return;
      }
      if (response.status === 422) {
        setPending(null);
        setError({
          message: 'رُفض الملف: ليس ملف PDF صالحًا أو يتجاوز الحد المسموح.',
          detail: apiError?.message,
          next: 'choose',
        });
        return;
      }
      if (response.status === 404) {
        setPending(null);
        setError({ message: 'لم يكتمل رفع الملف. أعد المحاولة.', next: 'restart' });
        return;
      }
      if (response.status === 403) {
        setPending(null);
        setError({ message: 'ليس لديك صلاحية لرفع المستندات.', next: 'choose' });
        return;
      }
      setError({ message: 'تعذر تأكيد الرفع.', next: 'complete' });
    } catch {
      setPhase('idle');
      setError({ message: 'تعذر تأكيد الرفع بسبب مشكلة في الاتصال.', next: 'complete' });
    }
  }

  async function upload(selected: File) {
    const preflightError = preflight(selected);
    if (preflightError) {
      setError({ message: preflightError, next: 'choose' });
      return;
    }

    setError(null);
    setPending(null);
    setPhase('initiating');

    let documentId: string;
    let uploadUrl: string;
    try {
      const response = await fetch('/api/knowledge-documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: selected.name,
          // Always the allowed type, never `selected.type`: the presigned URL
          // binds this exact value, and the PUT below must send it too.
          mimeType: allowedMimeType,
          sizeBytes: selected.size,
        }),
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status !== 201) {
        const apiError = await readApiError(response);
        setPhase('idle');
        if (response.status === 400) {
          setError({
            message: 'رُفض الملف قبل الرفع.',
            detail: apiError?.message,
            next: 'choose',
          });
        } else if (response.status === 403) {
          setError({ message: 'ليس لديك صلاحية لرفع المستندات.', next: 'choose' });
        } else {
          setError({ message: 'فشل الرفع.', next: 'restart' });
        }
        return;
      }
      const body: { data: { documentId: string; uploadUrl: string } } = await response.json();
      documentId = body.data.documentId;
      uploadUrl = body.data.uploadUrl;
    } catch {
      setPhase('idle');
      setError({ message: 'فشل الرفع بسبب مشكلة في الاتصال.', next: 'restart' });
      return;
    }

    setPhase('uploading');
    try {
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: selected,
        headers: { 'Content-Type': allowedMimeType },
        credentials: 'omit',
      });
      if (!putResponse.ok) {
        setPhase('idle');
        setError({ message: 'فشل رفع الملف إلى التخزين.', next: 'restart' });
        return;
      }
    } catch {
      setPhase('idle');
      setError({ message: 'فشل رفع الملف إلى التخزين.', next: 'restart' });
      return;
    }

    const target = { documentId, filename: selected.name };
    setPending(target);
    await complete(target);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file && !busy) {
      void upload(file);
    }
  }

  const phaseLabel: Record<Exclude<Phase, 'idle'>, string> = {
    initiating: 'جارٍ التحضير...',
    uploading: 'جارٍ رفع الملف...',
    completing: 'جارٍ التحقق من الملف...',
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="knowledge-document-file" className="text-sm font-medium">
          الملف
        </label>
        <input
          id="knowledge-document-file"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
            setPending(null);
          }}
          className="border-line bg-paper mt-2 block w-full rounded-lg border px-4 py-2 text-sm disabled:opacity-60"
        />
      </div>

      <Button type="submit" disabled={!file || busy}>
        رفع
      </Button>

      {busy && (
        <p role="status" className="text-muted text-sm">
          {phaseLabel[phase as Exclude<Phase, 'idle'>]}
        </p>
      )}

      {error && (
        <div role="alert" className="space-y-3">
          <p className="text-sm font-medium text-red-700">{error.message}</p>
          {error.detail && (
            <p className="text-muted text-xs" dir="ltr">
              {error.detail}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {error.next === 'complete' && pending && (
              <Button type="button" variant="secondary" onClick={() => void complete(pending)}>
                إعادة التحقق
              </Button>
            )}
            {(error.next === 'restart' || error.next === 'complete') && file && (
              <Button type="button" variant="secondary" onClick={() => void upload(file)}>
                إعادة الرفع من البداية
              </Button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
