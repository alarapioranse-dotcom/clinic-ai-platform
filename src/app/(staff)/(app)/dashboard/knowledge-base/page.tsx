import { getI18n } from '@/i18n/server';

import { KnowledgeBaseAccessDenied } from './AccessDenied';
import { KnowledgeDocumentsList } from './KnowledgeDocumentsList';
import { canManageKnowledgeBase } from './access';

/**
 * Roadmap P5 Slice 1C: /dashboard/knowledge-base (docs/product/05-screen-inventory.md).
 * Owner and admin see the clinic's knowledge documents and their status;
 * every other role gets the access-denied screen from the server, never the
 * list.
 */
export default async function KnowledgeBasePage() {
  const { locale, t } = await getI18n();

  if (!(await canManageKnowledgeBase())) {
    return <KnowledgeBaseAccessDenied t={t.knowledgeBase} />;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{t.knowledgeBase.title}</h1>
      <p className="text-muted mt-2 text-sm">{t.knowledgeBase.intro}</p>
      <KnowledgeDocumentsList locale={locale} t={t.knowledgeBase} />
    </div>
  );
}
