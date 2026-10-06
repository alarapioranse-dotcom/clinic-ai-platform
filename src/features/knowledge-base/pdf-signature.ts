/**
 * Pure PDF header check for upload completion (ADR-0021 — the bounded prefix
 * read exists solely to feed this function). It looks only at the first bytes
 * of the object it is given: no PDF parsing, no `%%EOF` check, no structure
 * validation, no extraction.
 *
 * Policy (human-approved): the object must begin, at byte offset 0 exactly,
 * with `%PDF-X.Y` — 8 bytes, upper-case, ASCII — where `X.Y` is one of
 * 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 (ISO 32000-1) or 2.0 (ISO 32000-2),
 * and the header must then END: the ninth byte must be absent (the object is
 * exactly the 8 header bytes), or LF (0x0A), or CR (0x0D). Any other ninth
 * byte is rejected — a digit (`%PDF-1.77`, `%PDF-1.10`, `%PDF-2.00`), a
 * space, a tab, NUL, `.`, a letter, `-`, or any other byte (`%PDF-1.7x`,
 * `%PDF-1.7.1`, `%PDF-1.7-beta`) — so the accepted header is one closed
 * form, not "something that starts like a PDF". Also rejected: a different
 * version (1.8, 3.0, `X.Y`), lower-case `%pdf-`, a BOM or whitespace before
 * the signature, the signature at a non-zero offset, and other file types
 * (PNG, ZIP, HTML). Nothing after the ninth byte is inspected.
 *
 * This proves only that the object is not obviously some other file type. It
 * does not prove the file is safe or well-formed — a polyglot can pass.
 */

/** Length of the shortest valid header, `%PDF-1.0`. */
export const PDF_SIGNATURE_LENGTH = 8;

const ALLOWED_HEADERS: ReadonlySet<string> = new Set([
  '%PDF-1.0',
  '%PDF-1.1',
  '%PDF-1.2',
  '%PDF-1.3',
  '%PDF-1.4',
  '%PDF-1.5',
  '%PDF-1.6',
  '%PDF-1.7',
  '%PDF-2.0',
]);

const LF = 0x0a;
const CR = 0x0d;

export function hasPdfSignature(prefix: Uint8Array): boolean {
  if (prefix.length < PDF_SIGNATURE_LENGTH) {
    return false;
  }

  // Bytes >= 0x80 map to code points that can never appear in an allowed
  // header, so a latin1-style decode of 8 bytes is a safe exact comparison.
  const header = String.fromCharCode(...prefix.subarray(0, PDF_SIGNATURE_LENGTH));
  if (!ALLOWED_HEADERS.has(header)) {
    return false;
  }

  // The header must end here: nothing more, or a line terminator. Anything
  // else (a digit, space, tab, NUL, `.`, a letter, `-`, ...) is not a closed
  // `%PDF-X.Y` header line.
  const next = prefix[PDF_SIGNATURE_LENGTH];
  return next === undefined || next === LF || next === CR;
}
