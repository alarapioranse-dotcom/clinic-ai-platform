import Link from 'next/link';

import { KnowledgeDocumentForm } from '../KnowledgeDocumentForm';

export default function NewKnowledgeDocumentPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard/knowledge-base" className="text-pine hover:text-pine-deep text-sm">
        ← رجوع إلى قاعدة المعرفة
      </Link>
      <h1 className="font-display mt-4 text-2xl font-bold">إضافة مستند معرفة</h1>
      <KnowledgeDocumentForm endpoint="/api/knowledge-documents" method="POST" />
    </div>
  );
}
