/**
 * The canonical text of a knowledge document (ADR-0026 section 5, Owner ruling F4: `canon-1`).
 *
 * The canonical text is the stored source of ADR-0011 E2: every quote is verified by exact match
 * against it. It is derived from PDF.js's text content deterministically, in this order:
 *
 *   1. Each page's text items are concatenated, and an item that ends a line (`hasEOL`) is
 *      followed by "\n" (done in ./pdf-worker.mjs, which returns one raw string per page). Pages
 *      are joined here with a blank line, so a page boundary is a paragraph boundary.
 *   2. "\r\n" and "\r" become "\n"; U+2028 becomes "\n" and U+2029 a blank line.
 *   3. Invisible characters are removed: control characters (Unicode Cc) other than "\n" and
 *      "\t", and the bidirectional and zero-width marks listed in INVISIBLE_MARKS. ZWJ and ZWNJ
 *      are kept: they change how Arabic and Persian text reads.
 *   4. Unicode NFKC (presentation forms and ligatures become ordinary characters).
 *   5. Every horizontal whitespace character ("\t" and Unicode Zs) becomes a space; runs of
 *      spaces collapse to one; every line is trimmed of spaces.
 *   6. Lines are grouped into paragraphs separated by one or more empty lines. Within a
 *      paragraph, lines are joined with a single space (PDF line breaks are layout, not
 *      meaning). Paragraphs are joined with PARAGRAPH_SEPARATOR; empty paragraphs disappear.
 *   7. NFKC again, because removing characters in step 3 can bring a base character and a
 *      combining mark together. The result is trimmed.
 *
 * The result is NFKC-normalised (the database checks this), contains no "\r", no control
 * character other than "\n", no two consecutive spaces, and no run of more than two "\n".
 *
 * Any change to these rules is a new CANONICALIZATION_VERSION and a data-contract change that
 * needs a compatibility review (ADR-0026); it must never silently change stored text.
 */

export const CANONICALIZATION_VERSION = 'canon-1';

/** The one canonical paragraph separator. */
export const PARAGRAPH_SEPARATOR = '\n\n';

/**
 * U+061C ARABIC LETTER MARK, U+200B ZERO WIDTH SPACE, U+200E/U+200F LRM/RLM, U+202A–U+202E
 * embeddings and overrides, U+2060 WORD JOINER, U+2066–U+2069 isolates, U+FEFF BOM.
 */
const INVISIBLE_MARKS = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
/** Unicode Cc except "\n" (U+000A) and "\t" (U+0009). */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const HORIZONTAL_WHITESPACE = /[\t\p{Zs}]+/gu;

/** Steps 1 (joining pages) to 7, over the raw text of each page. */
export function canonicalize(pages: readonly string[]): string {
  let text = pages.join('\n\n');

  // 2. Line endings.
  text = text
    .replace(/\r\n?/gu, '\n')
    .replace(/\u2028/gu, '\n')
    .replace(/\u2029/gu, '\n\n');

  // 3. Invisible characters.
  text = text.replace(CONTROL_CHARACTERS, '').replace(INVISIBLE_MARKS, '');

  // 4. NFKC.
  text = text.normalize('NFKC');

  // 5 and 6. Whitespace, lines and paragraphs.
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(HORIZONTAL_WHITESPACE, ' ').trim();
    if (line === '') {
      if (current.length > 0) paragraphs.push(current.join(' '));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '));

  // 7. NFKC again, then trim.
  return paragraphs.join(PARAGRAPH_SEPARATOR).normalize('NFKC').trim();
}

/** Number of Unicode code points (what PostgreSQL's `length()` counts on `text`). */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** At least one letter (Unicode L) — otherwise the document fails with `no_extractable_text`. */
export function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text);
}
