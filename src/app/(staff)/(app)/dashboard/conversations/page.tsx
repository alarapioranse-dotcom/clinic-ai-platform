import { getI18n } from '@/i18n/server';

import { ConversationsList } from './ConversationsList';

export default async function ConversationsPage() {
  const { locale, t } = await getI18n();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{t.conversations.title}</h1>
      <p className="text-muted mt-2 text-sm">{t.conversations.intro}</p>
      <ConversationsList locale={locale} t={t.conversations} />
    </div>
  );
}
