import { describe, expect, it } from 'vitest';
import {
  CANONICALIZATION_VERSION,
  PARAGRAPH_SEPARATOR,
  canonicalize,
  codePointLength,
  hasLetter,
} from '@/features/knowledge-base/extraction/canonicalize';

/** The canon-1 rules of ADR-0026 section 5 / Owner ruling F4. Synthetic text only. */
describe('canonicalize (canon-1)', () => {
  it('is versioned', () => {
    expect(CANONICALIZATION_VERSION).toBe('canon-1');
    expect(PARAGRAPH_SEPARATOR).toBe('\n\n');
  });

  it('joins lines inside a paragraph with one space, and keeps paragraph boundaries', () => {
    expect(
      canonicalize([
        'Opening hours: Monday to Friday,\n09:00 to 17:00.\n\nA cleaning costs 40 EUR.\n',
      ]),
    ).toBe('Opening hours: Monday to Friday, 09:00 to 17:00.\n\nA cleaning costs 40 EUR.');
  });

  it('makes a page boundary a paragraph boundary', () => {
    expect(canonicalize(['First page.\n', 'Second page.'])).toBe('First page.\n\nSecond page.');
  });

  it('collapses many blank lines into one paragraph separator and drops empty paragraphs', () => {
    expect(canonicalize(['\n\n\nA\n\n\n\n\nB\n\n\n', '', '\n'])).toBe('A\n\nB');
  });

  it('normalises line endings, including U+2028 and U+2029', () => {
    expect(canonicalize(['a\r\nb\rc\u2028d\u2029e'])).toBe('a b c d\n\ne');
  });

  it('collapses horizontal whitespace and trims lines', () => {
    expect(canonicalize(['  a \t\u00A0 b\u2003c   \n   d  '])).toBe('a b c d');
  });

  it('removes control characters and bidirectional or zero-width marks, keeping ZWJ and ZWNJ', () => {
    expect(canonicalize(['a\u0001b\u007Fc\u0085d'])).toBe('abcd');
    expect(canonicalize(['\u200Fمرحبا\u200E \u202Bنص\u202C\u2066x\u2069\uFEFF\u200B\u061C'])).toBe(
      'مرحبا نصx',
    );
    expect(canonicalize(['می\u200Cخواهم \u200D'])).toBe('می\u200Cخواهم \u200D');
  });

  it('applies NFKC: Arabic presentation forms, ligatures and full-width characters', () => {
    expect(canonicalize(['ﺳﺎﻋﺎﺕ'])).toBe('ساعات');
    expect(canonicalize(['ﬁle ﬂow'])).toBe('file flow');
    expect(canonicalize(['ＡＢＣ'])).toBe('ABC');
    expect(canonicalize(['ﻻ'])).toBe('لا');
  });

  it('applies NFKC again after removing marks, so a base and a combining mark compose', () => {
    // "e" + RLM + COMBINING ACUTE: removing the mark makes "e\u0301", which NFKC composes.
    expect(canonicalize(['e\u200F\u0301'])).toBe('é');
  });

  it('produces NFKC-normalised, idempotent output', () => {
    const inputs = [
      'Ωράριο\u00A0λειτουργίας\n\nΚαθαρισμός',
      'ﬁ\u0301 x\u2028y',
      'ﺔﻌﻤﺠﻟﺍ ﻰﻟﺇ\n\n\n𝄞 music',
      '\t\t',
    ];
    for (const input of inputs) {
      const once = canonicalize([input]);
      expect(once.normalize('NFKC')).toBe(once);
      expect(canonicalize([once])).toBe(once);
      expect(once).not.toMatch(/\r| {2}|\n{3}/u);
      expect(once).not.toMatch(/^\s|\s$/u);
    }
  });

  it('counts code points, not UTF-16 units', () => {
    expect('𝄞'.length).toBe(2);
    expect(codePointLength('𝄞a')).toBe(2);
    expect(codePointLength('')).toBe(0);
  });

  it('detects whether any letter exists', () => {
    expect(hasLetter('123 - 456')).toBe(false);
    expect(hasLetter('')).toBe(false);
    expect(hasLetter('٤٠ يورو')).toBe(true);
    expect(hasLetter('Ω')).toBe(true);
  });
});
