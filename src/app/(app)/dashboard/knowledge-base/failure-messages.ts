/**
 * Arabic text for each knowledge-document failure reason (ADR-0026 Owner ruling D9; PR D
 * ruling G5). The stored `failed_reason` is always one of the closed codes of
 * `mark_knowledge_document_failed` (db/migrations/0020); the raw code is never shown. Anything
 * else — including rows written before 0020 existed — gets the generic message.
 */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  too_large: 'الملف أكبر من 10 ميغابايت.',
  too_many_pages: 'الملف يتجاوز 100 صفحة.',
  too_much_text: 'نص الملف أطول من الحد المسموح.',
  extraction_timeout: 'استغرقت قراءة الملف وقتاً أطول من المسموح.',
  extraction_error: 'تعذّرت قراءة الملف، وقد يكون تالفاً.',
  no_extractable_text: 'لا يحتوي الملف على نص قابل للقراءة، وربما هو صورة ممسوحة ضوئياً.',
  encrypted: 'الملف محمي أو مشفّر. ارفع نسخة غير محمية.',
  object_missing: 'لم يُعثر على الملف المرفوع.',
  object_changed: 'تغيّر الملف أثناء المعالجة. ارفعه مرة أخرى.',
  not_a_pdf: 'الملف ليس PDF صالحاً.',
};

export const GENERIC_FAILURE_MESSAGE = 'فشلت المعالجة.';

export function failureMessage(reason: string | null | undefined): string {
  return (
    (reason && Object.hasOwn(FAILURE_MESSAGES, reason) && FAILURE_MESSAGES[reason]) ||
    GENERIC_FAILURE_MESSAGE
  );
}
