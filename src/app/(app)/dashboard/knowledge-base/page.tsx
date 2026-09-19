import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { KnowledgeDocumentsList } from './KnowledgeDocumentsList';

export default function KnowledgeBasePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">قاعدة المعرفة</h1>
          <p className="text-muted mt-2 text-sm">
            المستندات التي يعتمد عليها المساعد الآلي للرد على المرضى.
          </p>
        </div>
        <Link href="/dashboard/knowledge-base/new">
          <Button>إضافة مستند</Button>
        </Link>
      </div>
      <KnowledgeDocumentsList />
    </div>
  );
}
