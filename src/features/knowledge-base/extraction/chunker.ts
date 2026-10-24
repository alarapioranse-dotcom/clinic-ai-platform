import { CHUNK_MAX_CODE_POINTS, CHUNK_TARGET_CODE_POINTS } from './limits';
import { PARAGRAPH_SEPARATOR, codePointLength } from './canonicalize';

/**
 * Splits a canonical text into contiguous, non-overlapping chunks (ADR-0026 section 5):
 * concatenating the result in order reproduces the input exactly, every chunk is non-empty, and
 * none is longer than CHUNK_MAX_CODE_POINTS code points. Chunks break at paragraph boundaries,
 * then sentence boundaries, then spaces, and only as a last resort at a fixed code-point
 * position. Separators stay attached to the end of the piece before them, so nothing is added
 * or lost. Offsets are not computed here: the database derives them from the chunk contents
 * (`store_knowledge_document_chunks`, E2).
 */
export function chunkCanonicalText(
  text: string,
  target: number = CHUNK_TARGET_CODE_POINTS,
  max: number = CHUNK_MAX_CODE_POINTS,
): string[] {
  if (text === '') return [];
  if (!(target > 0 && max >= target)) throw new Error('invalid chunk sizes');

  const pieces = splitToFit(text, max, 0);
  const chunks: string[] = [];
  let current = '';
  let currentLength = 0;
  for (const piece of pieces) {
    const length = codePointLength(piece);
    if (currentLength > 0 && currentLength + length > target) {
      chunks.push(current);
      current = '';
      currentLength = 0;
    }
    current += piece;
    currentLength += length;
  }
  if (currentLength > 0) chunks.push(current);
  return chunks;
}

/**
 * Splitting levels, coarsest first. Each regular expression matches the END of a piece: the
 * separator is included in the piece it follows.
 */
const LEVELS: RegExp[] = [
  // Paragraphs: text up to and including the paragraph separator.
  new RegExp(`[^]*?${PARAGRAPH_SEPARATOR}`, 'gu'),
  // Sentences: up to and including terminal punctuation (Latin, Greek and Arabic marks after
  // NFKC: . ! ? ; … ؟ ۔) and the spaces after it.
  /[^]*?[.!?;…؟۔]+ +/gu,
  // Words: up to and including the next run of spaces.
  /[^]*? +/gu,
];

function splitToFit(text: string, max: number, level: number): string[] {
  if (codePointLength(text) <= max) return [text];
  if (level >= LEVELS.length) return hardSplit(text, max);

  const parts = splitKeepingSeparators(text, LEVELS[level]!);
  if (parts.length === 1) return splitToFit(text, max, level + 1);
  return parts.flatMap((part) => splitToFit(part, max, level + 1));
}

function splitKeepingSeparators(text: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') continue;
    parts.push(match[0]);
    end = (match.index ?? 0) + match[0].length;
  }
  if (end < text.length) parts.push(text.slice(end));
  return parts;
}

/** Last resort: fixed-size pieces of `max` code points (never splits a surrogate pair). */
function hardSplit(text: string, max: number): string[] {
  const codePoints = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < codePoints.length; i += max) {
    parts.push(codePoints.slice(i, i + max).join(''));
  }
  return parts;
}
