'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type SubmitState = { status: 'idle' | 'submitting' | 'error' };

/**
 * Shared create/edit form (task-specified "create/edit" UI — see
 * `db/migrations/0013_knowledge_documents.sql` for why this slice edits
 * title/content in place rather than uploading a file). `endpoint` and
 * `method` select create (`POST /api/knowledge-documents`) vs. edit (`PATCH
 * /api/knowledge-documents/:id`); both redirect back to the list on success.
 */
export function KnowledgeDocumentForm({
  endpoint,
  method,
  initialTitle = '',
  initialContent = '',
}: {
  endpoint: string;
  method: 'POST' | 'PATCH';
  initialTitle?: string;
  initialContent?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSubmit({ status: 'submitting' });
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) {
        setSubmit({ status: 'error' });
        return;
      }
      router.push('/dashboard/knowledge-base');
    } catch {
      setSubmit({ status: 'error' });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        العنوان
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={submit.status === 'submitting'}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        المحتوى
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={submit.status === 'submitting'}
          rows={8}
          required
          className="border-line bg-paper text-ink placeholder:text-muted w-full rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      {submit.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          تعذر حفظ المستند
        </p>
      )}

      <div>
        <Button
          type="submit"
          disabled={submit.status === 'submitting' || !title.trim() || !content.trim()}
        >
          {submit.status === 'submitting' ? 'جارٍ الحفظ...' : 'حفظ'}
        </Button>
      </div>
    </form>
  );
}
