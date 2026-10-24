import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  failureMessage,
  GENERIC_FAILURE_MESSAGE,
} from '@/app/(app)/dashboard/knowledge-base/failure-messages';

/** PR D ruling G5: an Arabic message for every closed failure reason, never the raw code. */

/** The reason codes `mark_knowledge_document_failed` accepts, read from migration 0020 itself. */
function reasonCodesFromMigration(): string[] {
  const sql = readFileSync(
    new URL('../../../db/migrations/0020_knowledge_document_chunks.sql', import.meta.url),
    'utf8',
  );
  const list = sql.match(/p_reason NOT IN \(([^)]*)\)/u)?.[1];
  if (!list) throw new Error('reason list not found in 0020');
  return [...list.matchAll(/'([a-z_]+)'/gu)].map((m) => m[1]!);
}

describe('failureMessage', () => {
  it('has a distinct Arabic message for every reason code 0020 accepts', () => {
    const codes = reasonCodesFromMigration();
    expect(codes).toHaveLength(10);
    const messages = codes.map(failureMessage);
    for (const [i, message] of messages.entries()) {
      expect(message, codes[i]).not.toBe(GENERIC_FAILURE_MESSAGE);
      expect(message, codes[i]).toMatch(/\p{Script=Arabic}/u);
      expect(message, codes[i]).not.toContain(codes[i]!);
    }
    expect(new Set(messages).size).toBe(codes.length);
  });

  it('uses the approved wording', () => {
    expect(failureMessage('too_large')).toBe('الملف أكبر من 10 ميغابايت.');
    expect(failureMessage('encrypted')).toBe('الملف محمي أو مشفّر. ارفع نسخة غير محمية.');
    expect(failureMessage('no_extractable_text')).toBe(
      'لا يحتوي الملف على نص قابل للقراءة، وربما هو صورة ممسوحة ضوئياً.',
    );
  });

  it('shows the generic message for anything else, never the raw value', () => {
    for (const value of [
      null,
      undefined,
      '',
      'test failure',
      'toString',
      '__proto__',
      'Error: ENOENT',
    ]) {
      expect(failureMessage(value)).toBe(GENERIC_FAILURE_MESSAGE);
    }
  });
});
