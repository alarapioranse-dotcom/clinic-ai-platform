import Link from 'next/link';

import {
  ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE,
  MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES,
} from '@/features/knowledge-base';
import { getI18n } from '@/i18n/server';

import { KnowledgeBaseAccessDenied } from '../AccessDenied';
import { canManageKnowledgeBase } from '../access';
import { UploadKnowledgeDocument } from './UploadKnowledgeDocument';

/**
 * Roadmap P5 Slice 1C: /dashboard/knowledge-base/upload (Owner decision D2,
 * a separate page per docs/product/05-screen-inventory.md). Server-guarded
 * like the list. The limits are read here, on the server, and passed down:
 * the client component cannot import the feature entry point, which pulls in
 * server-only code.
 */
export default async function UploadKnowledgeDocumentPage() {
  const { t } = await getI18n();

  if (!(await canManageKnowledgeBase())) {
    return <KnowledgeBaseAccessDenied t={t.knowledgeBase} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard/knowledge-base" className="text-muted hover:text-ink text-sm">
        {t.knowledgeUpload.back}
      </Link>
      <h1 className="font-display mt-4 text-2xl font-bold">{t.knowledgeUpload.title}</h1>
      <p className="text-muted mt-2 text-sm">{t.knowledgeUpload.intro}</p>
      <UploadKnowledgeDocument
        t={t.knowledgeUpload}
        allowedMimeType={ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE}
        maxSizeBytes={MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES}
      />
    </div>
  );
}
