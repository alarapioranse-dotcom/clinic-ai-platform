import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { failureMessage } from '@/app/(staff)/(app)/dashboard/knowledge-base/failure-messages';
import { ar } from '@/i18n/dictionaries/ar';

/**
 * PR D ruling G5: a message for every closed failure reason, never the raw
 * code. Since ADR-0027 the text lives in the dictionary, so these tests read
 * it from there rather than repeating it.
 */
const messages = ar.knowledgeBase;

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
  it('has a distinct Arabic message for every reason code 0020 accepts, and no others', () => {
    const codes = reasonCodesFromMigration();
    expect(codes).toHaveLength(10);
    expect(Object.keys(messages.failures).sort()).toEqual([...codes].sort());
    const texts = codes.map((code) => failureMessage(code, messages));
    for (const [i, text] of texts.entries()) {
      expect(text, codes[i]).not.toBe(messages.genericFailure);
      expect(text, codes[i]).toMatch(/\p{Script=Arabic}/u);
      expect(text, codes[i]).not.toContain(codes[i]!);
    }
    expect(new Set(texts).size).toBe(codes.length);
  });

  it('returns the dictionary text for each code', () => {
    for (const [code, text] of Object.entries(messages.failures)) {
      expect(failureMessage(code, messages)).toBe(text);
    }
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
      expect(failureMessage(value, messages)).toBe(messages.genericFailure);
    }
  });
});
