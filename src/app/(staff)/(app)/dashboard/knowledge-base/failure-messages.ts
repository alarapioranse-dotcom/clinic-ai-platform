import type { Dictionary } from '@/i18n/dictionaries';

type KnowledgeBaseMessages = Pick<Dictionary['knowledgeBase'], 'failures' | 'genericFailure'>;

/**
 * The message for a knowledge-document failure reason (ADR-0026 Owner ruling
 * D9; PR D ruling G5), from the dictionary's `knowledgeBase` namespace
 * (ADR-0027). The stored `failed_reason` is always one of the closed codes of
 * `mark_knowledge_document_failed` (db/migrations/0020); the raw code is never
 * shown. Anything else — including rows written before 0020 existed, and
 * names inherited from Object.prototype — gets the generic message.
 */
export function failureMessage(
  reason: string | null | undefined,
  messages: KnowledgeBaseMessages,
): string {
  const failures: Readonly<Record<string, string>> = messages.failures;
  return (reason && Object.hasOwn(failures, reason) && failures[reason]) || messages.genericFailure;
}
