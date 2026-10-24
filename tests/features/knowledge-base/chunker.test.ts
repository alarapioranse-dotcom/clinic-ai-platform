import { describe, expect, it } from 'vitest';
import { chunkCanonicalText } from '@/features/knowledge-base/extraction/chunker';
import { codePointLength } from '@/features/knowledge-base/extraction/canonicalize';
import {
  CHUNK_MAX_CODE_POINTS,
  CHUNK_TARGET_CODE_POINTS,
} from '@/features/knowledge-base/extraction/limits';

/** ADR-0026 section 5: contiguous, non-overlapping chunks that rebuild the text exactly. */

function expectValidChunks(text: string, chunks: string[], max = CHUNK_MAX_CODE_POINTS) {
  expect(chunks.join('')).toBe(text);
  for (const chunk of chunks) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(codePointLength(chunk)).toBeLessThanOrEqual(max);
  }
}

/** Deterministic pseudo-random generator, so a failure is reproducible. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('chunkCanonicalText', () => {
  it('uses the ADR-0026 sizes', () => {
    expect(CHUNK_TARGET_CODE_POINTS).toBe(1500);
    expect(CHUNK_MAX_CODE_POINTS).toBe(2000);
  });

  it('returns no chunk for empty text and one chunk for short text', () => {
    expect(chunkCanonicalText('')).toEqual([]);
    expect(chunkCanonicalText('Short.')).toEqual(['Short.']);
  });

  it('breaks at paragraph boundaries, keeping the separator on the earlier chunk', () => {
    const a = 'A'.repeat(1000);
    const b = 'B'.repeat(1000);
    const chunks = chunkCanonicalText(`${a}\n\n${b}`);
    expect(chunks).toEqual([`${a}\n\n`, b]);
  });

  it('packs small paragraphs together up to the target', () => {
    const paragraph = 'x'.repeat(98);
    const text = Array.from({ length: 40 }, () => paragraph).join('\n\n');
    const chunks = chunkCanonicalText(text);
    expectValidChunks(text, chunks);
    expect(chunks.length).toBe(3);
    for (const chunk of chunks.slice(0, -1)) {
      expect(codePointLength(chunk)).toBeLessThanOrEqual(CHUNK_TARGET_CODE_POINTS);
      expect(codePointLength(chunk)).toBeGreaterThan(CHUNK_TARGET_CODE_POINTS - 100);
    }
  });

  it('splits an over-long paragraph at sentence boundaries, including Greek and Arabic marks', () => {
    const sentences = [
      'This is an English sentence that is reasonably long. ',
      'Αυτή είναι μια ελληνική πρόταση; ',
      'هل هذه جملة عربية؟ ',
      'An exclamation! ',
    ];
    const text = Array.from({ length: 80 }, (_, i) => sentences[i % sentences.length])
      .join('')
      .trim();
    expect(codePointLength(text)).toBeGreaterThan(CHUNK_MAX_CODE_POINTS);
    const chunks = chunkCanonicalText(text);
    expectValidChunks(text, chunks);
    for (const chunk of chunks.slice(0, -1)) expect(chunk).toMatch(/[.!?;؟] $/u);
  });

  it('falls back to spaces, then to a fixed code-point cut, never exceeding the maximum', () => {
    const words = Array.from({ length: 600 }, () => 'word').join(' ');
    expectValidChunks(words, chunkCanonicalText(words));
    for (const chunk of chunkCanonicalText(words).slice(0, -1))
      expect(chunk.endsWith(' ')).toBe(true);

    const unbroken = 'y'.repeat(4500);
    expect(chunkCanonicalText(unbroken).map(codePointLength)).toEqual([2000, 2000, 500]);
  });

  it('counts and cuts in code points: characters outside the BMP are never split', () => {
    const text = '𝄞'.repeat(4100);
    const chunks = chunkCanonicalText(text);
    expectValidChunks(text, chunks);
    expect(chunks.map(codePointLength)).toEqual([2000, 2000, 100]);
    for (const chunk of chunks) expect(chunk).toBe(Array.from(chunk).join(''));
    expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk))).toBe(true);
  });

  it('always rebuilds the text exactly and respects the maximum (randomised, seeded)', () => {
    const random = seeded(20261024);
    const alphabet = ['a', 'b', 'Ω', 'ع', '𝄞', ' ', ' ', '.', '؟', ';', '\n\n'];
    for (let round = 0; round < 200; round += 1) {
      const length = Math.floor(random() * 6000);
      let text = '';
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      const target = 50 + Math.floor(random() * 1500);
      const max = target + Math.floor(random() * 600);
      const chunks = chunkCanonicalText(text, target, max);
      expectValidChunks(text, chunks, max);
    }
  });

  it('rejects inconsistent sizes', () => {
    expect(() => chunkCanonicalText('abc', 0, 10)).toThrow();
    expect(() => chunkCanonicalText('abc', 20, 10)).toThrow();
  });
});
