import { getI18n } from '@/i18n/server';

import { ConversationDetail } from './ConversationDetail';

/**
 * Server shell of the conversation screen (ADR-0027 slice 1): resolves the
 * locale and passes the client component only the two namespaces it renders.
 * Fetching, roles and replies stay in ConversationDetail, unchanged.
 */
export default async function ConversationDetailPage() {
  const { locale, t } = await getI18n();
  return <ConversationDetail locale={locale} t={t.conversationDetail} bookingT={t.booking} />;
}
