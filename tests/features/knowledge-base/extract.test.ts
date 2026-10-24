import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  EXTRACTOR_VERSION,
  extractKnowledgeDocumentText,
} from '@/features/knowledge-base/extraction/extract';
import {
  CANONICALIZATION_VERSION,
  codePointLength,
} from '@/features/knowledge-base/extraction/canonicalize';
import { CHUNK_MAX_CODE_POINTS } from '@/features/knowledge-base/extraction/limits';

/**
 * ADR-0026 sections 1, 2 and 4 (PR C): PDF.js in a worker, every limit and failure mapped to a
 * closed reason, no network, no native canvas. Synthetic PDFs from tests/fixtures/pdfs only.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/pdfs/${name}`, import.meta.url)));
const fakeWorker = (name: string) => new URL(`../../fixtures/workers/${name}`, import.meta.url);

async function extractOk(name: string) {
  const result = await extractKnowledgeDocumentText(fixture(name));
  if (!result.ok) throw new Error(`${name} failed with ${result.reason}`);
  expect(result.chunks.join('')).toBe(result.canonicalText);
  for (const chunk of result.chunks)
    expect(codePointLength(chunk)).toBeLessThanOrEqual(CHUNK_MAX_CODE_POINTS);
  expect(result.extractorVersion).toBe(EXTRACTOR_VERSION);
  expect(result.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
  return result;
}

async function reasonFor(
  bytes: Uint8Array,
  options?: Parameters<typeof extractKnowledgeDocumentText>[1],
) {
  const result = await extractKnowledgeDocumentText(bytes, options);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.reason;
}

describe('extractKnowledgeDocumentText', () => {
  it('pins the extractor version to the installed PDF.js', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies['pdfjs-dist']).toBe('6.4.299');
    expect(EXTRACTOR_VERSION).toBe(`pdfjs-dist@${pkg.dependencies['pdfjs-dist']};opts-1`);
    expect(pkg.engines.node).toBe('>=22.13 <23');
  });

  // ── text that extracts ───────────────────────────────────────────────────

  it('extracts English: lines join with a space, a page boundary becomes a paragraph boundary', async () => {
    const result = await extractOk('english.pdf');
    // PDF.js emits no empty line for vertical spacing, so the visual gap between the first two
    // paragraphs does not survive (canon-1 detects paragraphs from empty lines and pages only).
    expect(result.canonicalText).toBe(
      'Opening hours: Monday to Friday, 09:00 to 17:00. A dental cleaning costs 40 EUR.\n\nCancellations need 24 hours notice.',
    );
    expect(result.pageCount).toBe(2);
  });

  it('extracts Greek', async () => {
    const result = await extractOk('greek.pdf');
    expect(result.canonicalText).toBe(
      'Ωράριο λειτουργίας: Δευτέρα έως Παρασκευή. Καθαρισμός δοντιών: 40 ευρώ.',
    );
  });

  it('extracts Arabic presentation forms as ordinary letters, in reading order', async () => {
    const result = await extractOk('arabic-presentation-forms.pdf');
    expect(result.canonicalText).toBe('ساعات العمل من الاثنين إلى الجمعة');
  });

  it('extracts ligatures and a standard font without any font data configured', async () => {
    expect((await extractOk('ligatures.pdf')).canonicalText).toBe('file flow');
    expect((await extractOk('standard-font.pdf')).canonicalText).toBe(
      'Standard font Helvetica text.',
    );
  });

  it('records the known Arabic limitation of a word-processor PDF (Owner ruling F7)', async () => {
    // LibreOffice's Arabic does not extract verbatim: lam-alef comes out as alef-lam and tanween
    // moves. Greek in the same file is intact. This test pins the current behaviour so that a
    // change is noticed; it is a documented limitation, not the desired output.
    const result = await extractOk('libreoffice-arabic-greek.pdf');
    expect(result.canonicalText).toContain('Ωράριο: Δευτέρα–Παρασκευή.');
    expect(result.canonicalText).toContain('االثنين');
    expect(result.canonicalText).not.toContain('الاثنين');
    expect(result.canonicalText).not.toMatch(/[\u0000-\u0009\u000B-\u001F]/u);
  });

  it('chunks a multi-page document into valid chunks', async () => {
    const result = await extractOk('many-paragraphs.pdf');
    expect(result.chunks.length).toBeGreaterThan(1);
    // One paragraph per page (see the English case), so chunks break mostly at sentences.
    expect(result.canonicalText.split('\n\n')).toHaveLength(result.pageCount);
    expect(result.pageCount).toBe(4);
  });

  it('accepts exactly the page limit', async () => {
    const result = await extractOk('pages-100.pdf');
    expect(result.pageCount).toBe(100);
  });

  // ── every failure maps to its closed reason ──────────────────────────────

  it('too_large: more bytes than the limit, before any parsing', async () => {
    expect(await reasonFor(new Uint8Array(10 * 1024 * 1024 + 1))).toBe('too_large');
    expect(await reasonFor(fixture('english.pdf'), { limits: { maxFileBytes: 100 } })).toBe(
      'too_large',
    );
  });

  it('too_many_pages: one page over the limit', async () => {
    expect(await reasonFor(fixture('pages-101.pdf'))).toBe('too_many_pages');
  });

  it('too_much_text: a small file whose text is far over the limit', async () => {
    expect(fixture('high-text-ratio.pdf').byteLength).toBeLessThan(100_000);
    expect(await reasonFor(fixture('high-text-ratio.pdf'))).toBe('too_much_text');
    // The canonical-text check, independently of the worker's early stop.
    expect(
      await reasonFor(fixture('english.pdf'), { limits: { maxCanonicalCodePoints: 50 } }),
    ).toBe('too_much_text');
  });

  it('no_extractable_text: a scanned page and a blank page', async () => {
    expect(await reasonFor(fixture('scanned.pdf'))).toBe('no_extractable_text');
    expect(await reasonFor(fixture('empty.pdf'))).toBe('no_extractable_text');
  });

  it('encrypted: every encrypted PDF, including one that opens without a password (F3)', async () => {
    expect(await reasonFor(fixture('encrypted-password.pdf'))).toBe('encrypted');
    expect(await reasonFor(fixture('encrypted-owner-only.pdf'))).toBe('encrypted');
  });

  it('extraction_error: a broken structure and bytes that are not a PDF', async () => {
    expect(await reasonFor(fixture('truncated.pdf'))).toBe('extraction_error');
    expect(await reasonFor(new TextEncoder().encode('%PDF-1.7\nnot really a pdf'))).toBe(
      'extraction_error',
    );
    expect(await reasonFor(new Uint8Array(0))).toBe('extraction_error');
  });

  it('extraction_timeout: the parent terminates a worker that runs too long', async () => {
    const started = performance.now();
    expect(
      await reasonFor(fixture('english.pdf'), {
        workerUrl: fakeWorker('silent.mjs'),
        limits: { timeoutMs: 300 },
      }),
    ).toBe('extraction_timeout');
    expect(performance.now() - started).toBeLessThan(5_000);
    // And the real worker with an impossible budget.
    expect(await reasonFor(fixture('pages-100.pdf'), { limits: { timeoutMs: 1 } })).toBe(
      'extraction_timeout',
    );
  });

  it('extraction_error: the worker runs out of its V8 heap, and the process survives', async () => {
    // 16 MiB is enough to start the worker but not to load PDF.js (ERR_WORKER_OUT_OF_MEMORY).
    expect(await reasonFor(fixture('english.pdf'), { limits: { maxOldGenerationMb: 16 } })).toBe(
      'extraction_error',
    );
    // Afterwards, extraction in the same process still works.
    expect((await extractOk('greek.pdf')).ok).toBe(true);
  });

  it('refuses a heap limit too small to start a worker safely', async () => {
    await expect(
      extractKnowledgeDocumentText(fixture('english.pdf'), { limits: { maxOldGenerationMb: 2 } }),
    ).rejects.toThrow('maxOldGenerationMb must be at least 16');
  });

  it('extraction_error: the worker exits, throws, or breaks the protocol — nothing it says leaks', async () => {
    for (const name of ['exits.mjs', 'throws.mjs', 'bad-message.mjs']) {
      const result = await extractKnowledgeDocumentText(fixture('english.pdf'), {
        workerUrl: fakeWorker(name),
      });
      expect(result, name).toEqual({ ok: false, reason: 'extraction_error' });
      expect(JSON.stringify(result)).not.toMatch(/secret|ENOENT/u);
    }
  });

  // ── no network, no native canvas, nothing printed ─────────────────────────

  it('the worker blocks every network path and the native canvas package, but not ordinary modules', async () => {
    const worker = new Worker(fakeWorker('probe-blocking.mjs'), { stdout: true, stderr: true });
    worker.stdout.resume();
    worker.stderr.resume();
    try {
      const message = await new Promise<{ results: Record<string, string> }>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      expect(message.results).toEqual({
        fetch: 'blocked',
        requireHttps: 'blocked',
        requireNodeNet: 'blocked',
        requireTls: 'blocked',
        requireDns: 'blocked',
        builtinHttp: 'blocked',
        builtinNodeHttp2: 'blocked',
        requireCanvas: 'blocked',
        requireFs: 'allowed',
        builtinPath: 'allowed',
      });
    } finally {
      await worker.terminate();
    }
  });

  it('a PDF with an embedded link makes no network attempt, and PDF.js never loads the native canvas', async () => {
    const result = await extractOk('embedded-link.pdf');
    expect(result.canonicalText).toBe('Visit our website for directions.');
    expect(result.diagnostics.fetchCalls).toBe(0);
    // PDF.js tries to load @napi-rs/canvas for rendering polyfills; the worker refuses it, and
    // nothing else was attempted.
    expect(result.diagnostics.blockedModuleLoads).toEqual(['@napi-rs/canvas']);
  });
});
