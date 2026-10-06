import { describe, it, expect } from 'vitest';
import { hasPdfSignature, PDF_SIGNATURE_LENGTH } from '@/features/knowledge-base/pdf-signature';

/**
 * The pure PDF header validator (ADR-0021 / human-approved policy): the
 * object must begin, at byte offset 0 exactly, with `%PDF-X.Y` where `X.Y` is
 * one of 1.0-1.7 or 2.0, and that header must then END: the ninth byte is
 * absent, LF (0x0A) or CR (0x0D) — nothing else (no digit, space, tab, NUL,
 * dot, letter, dash, ...). No parsing, no `%%EOF`, nothing past the ninth
 * byte is inspected.
 */
function bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'latin1'));
}

function raw(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('hasPdfSignature', () => {
  it('requires exactly 8 header bytes', () => {
    expect(PDF_SIGNATURE_LENGTH).toBe(8);
  });

  describe('accepts', () => {
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
      it(`%PDF-${version} followed by a newline`, () => {
        expect(hasPdfSignature(bytes(`%PDF-${version}\n%binary-comment`))).toBe(true);
      });
    }

    it('a header of exactly 8 bytes with nothing after it', () => {
      expect(hasPdfSignature(bytes('%PDF-1.4'))).toBe(true);
    });

    it('a header followed by LF, CR, or CRLF (the only allowed ninth bytes)', () => {
      expect(hasPdfSignature(bytes('%PDF-1.7\n'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\r'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\r\n'))).toBe(true);
    });

    it('a header, a line terminator, then a binary-comment line with high bytes', () => {
      expect(hasPdfSignature(raw(...bytes('%PDF-1.7\n'), 0xe2, 0xe3, 0xcf, 0xd3))).toBe(true);
      expect(hasPdfSignature(raw(...bytes('%PDF-1.7\r'), 0xe2, 0xe3, 0xcf, 0xd3))).toBe(true);
    });

    it('any content after the ninth byte is not inspected once the header has ended', () => {
      expect(hasPdfSignature(bytes('%PDF-1.7\n.x-beta 123'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\n\u0000\u0000'))).toBe(true);
    });

    it('a full 1024-byte prefix that starts with a valid header', () => {
      const prefix = new Uint8Array(1024).fill(0x41);
      prefix.set(bytes('%PDF-2.0\n'), 0);
      expect(hasPdfSignature(prefix)).toBe(true);
    });
  });

  describe('rejects versions outside the allowed set', () => {
    for (const header of [
      '%PDF-1.8',
      '%PDF-1.9',
      '%PDF-0.9',
      '%PDF-2.1',
      '%PDF-2.9',
      '%PDF-3.0',
      '%PDF-X.Y',
      '%PDF-A.B',
      '%PDF-1.x',
      '%PDF-1,4',
      '%PDF-1-4',
      '%PDF-1..',
    ]) {
      it(header, () => {
        expect(hasPdfSignature(bytes(`${header}\n`))).toBe(false);
      });
    }
  });

  describe('rejects a further digit glued onto the version', () => {
    for (const header of ['%PDF-1.77', '%PDF-1.10', '%PDF-1.40', '%PDF-2.00', '%PDF-1.01']) {
      it(header, () => {
        expect(hasPdfSignature(bytes(header))).toBe(false);
      });
    }
  });

  describe('rejects any ninth byte other than LF or CR (the header must end)', () => {
    for (const [label, tail] of [
      ['a space', ' '],
      ['a tab', '\t'],
      ['a NUL byte', '\u0000'],
      ['a dot', '.'],
      ['a dotted sub-version', '.1'],
      ['a letter', 'x'],
      ['a dash', '-'],
      ['a dash suffix', '-beta'],
      ['a digit', '7'],
      ['a form feed', '\f'],
      ['a vertical tab', '\v'],
      ['a comma', ','],
      ['a slash', '/'],
      ['a percent sign', '%'],
    ] as const) {
      it(`%PDF-1.7 followed by ${label}`, () => {
        expect(hasPdfSignature(bytes(`%PDF-1.7${tail}`))).toBe(false);
        // still rejected when a valid-looking line terminator follows later
        expect(hasPdfSignature(bytes(`%PDF-1.7${tail}\n`))).toBe(false);
      });
    }

    it('%PDF-1.7 followed by a high (non-ASCII) byte', () => {
      expect(hasPdfSignature(raw(...bytes('%PDF-1.7'), 0x80))).toBe(false);
      expect(hasPdfSignature(raw(...bytes('%PDF-1.7'), 0xe2, 0x0a))).toBe(false);
      expect(hasPdfSignature(raw(...bytes('%PDF-1.7'), 0xff))).toBe(false);
    });

    it('applies to every allowed version, not only 1.7', () => {
      for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
        expect(hasPdfSignature(bytes(`%PDF-${version}x`))).toBe(false);
        expect(hasPdfSignature(bytes(`%PDF-${version} `))).toBe(false);
        expect(hasPdfSignature(bytes(`%PDF-${version}\n`))).toBe(true);
      }
    });

    it('the exact cases named by the Owner', () => {
      expect(hasPdfSignature(bytes('%PDF-1.7'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\n'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\r'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7\r\n'))).toBe(true);
      expect(hasPdfSignature(bytes('%PDF-1.7 '))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.7\t'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.7\0'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.7.'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.7x'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.7-beta'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.77'))).toBe(false);
      expect(hasPdfSignature(bytes('%PDF-1.10'))).toBe(false);
    });
  });

  describe('rejects a wrong or malformed signature', () => {
    it('lower-case %pdf-', () => {
      expect(hasPdfSignature(bytes('%pdf-1.4\n'))).toBe(false);
    });

    it('mixed case', () => {
      expect(hasPdfSignature(bytes('%Pdf-1.4\n'))).toBe(false);
    });

    it('a missing dash', () => {
      expect(hasPdfSignature(bytes('%PDF1.4xx'))).toBe(false);
    });

    it('a different leading character', () => {
      expect(hasPdfSignature(bytes('#PDF-1.4\n'))).toBe(false);
    });
  });

  describe('rejects anything before the signature (it must be at offset 0)', () => {
    it('a UTF-8 BOM', () => {
      expect(hasPdfSignature(raw(0xef, 0xbb, 0xbf, ...bytes('%PDF-1.4\n')))).toBe(false);
    });

    it('a UTF-16 BOM', () => {
      expect(hasPdfSignature(raw(0xff, 0xfe, ...bytes('%PDF-1.4\n')))).toBe(false);
    });

    for (const [label, lead] of [
      ['a space', ' '],
      ['a tab', '\t'],
      ['a newline', '\n'],
      ['CRLF', '\r\n'],
      ['a NUL byte', '\u0000'],
    ] as const) {
      it(`${label}`, () => {
        expect(hasPdfSignature(bytes(`${lead}%PDF-1.4\n`))).toBe(false);
      });
    }

    it('a signature at offset 1', () => {
      expect(hasPdfSignature(bytes('x%PDF-1.4\n'))).toBe(false);
    });

    it('a valid signature at offset 512', () => {
      const prefix = new Uint8Array(1024).fill(0x20);
      prefix.set(bytes('%PDF-1.7\n'), 512);
      expect(hasPdfSignature(prefix)).toBe(false);
    });
  });

  describe('rejects other file types and noise', () => {
    it('PNG', () => {
      expect(
        hasPdfSignature(raw(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d)),
      ).toBe(false);
    });

    it('ZIP', () => {
      expect(hasPdfSignature(raw(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0, 0, 0))).toBe(
        false,
      );
    });

    it('HTML', () => {
      expect(hasPdfSignature(bytes('<!DOCTYPE html><html><body>%PDF-1.4</body></html>'))).toBe(
        false,
      );
      expect(hasPdfSignature(bytes('<html><body></body></html>'))).toBe(false);
    });

    it('random bytes', () => {
      expect(hasPdfSignature(raw(0x9f, 0x01, 0xc3, 0x7e, 0x55, 0xaa, 0x10, 0x80, 0xfe, 0x00))).toBe(
        false,
      );
    });

    it('high bytes that merely resemble the header when truncated to 7 bits', () => {
      // 0xA5 & 0x7F === '%' ; the check is exact, never a bit-masked match.
      expect(hasPdfSignature(raw(0xa5, 0xd0, 0xc4, 0xc6, 0xad, 0xb1, 0xae, 0xb4))).toBe(false);
    });
  });

  describe('rejects an object too short to hold a header', () => {
    it('empty', () => {
      expect(hasPdfSignature(new Uint8Array(0))).toBe(false);
    });

    for (const header of ['%', '%PDF', '%PDF-', '%PDF-1', '%PDF-1.']) {
      it(`"${header}" (${header.length} bytes)`, () => {
        expect(hasPdfSignature(bytes(header))).toBe(false);
      });
    }
  });
});
