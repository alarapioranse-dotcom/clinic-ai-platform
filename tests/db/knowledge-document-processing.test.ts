import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * `processKnowledgeDocument` (ADR-0026, PR D) against the real database (migration 0020) and the
 * real extraction worker, with only object storage replaced by an in-memory fake that models
 * HeadObject, the If-Match whole-object read and its outcomes. Proves: every outcome is recorded
 * through the 0020 functions with its closed reason; a stored document stays `processing` (D9);
 * stale reports never overwrite; an unrecordable outcome leaves the document `processing`; one
 * document at a time (G3); logs carry only the document id and an outcome code (G4).
 * Synthetic PDFs only.
 */

interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
  etag?: string;
  /** Force the conditional read's outcome. */
  read?: 'changed' | 'not_found';
  headThrows?: boolean;
  /** Report this length from HeadObject instead of the real one. */
  headLength?: number;
}

const { objects, events, headObjectMock, readObjectForExtractionMock } = vi.hoisted(() => {
  const objects = new Map<string, StoredObject>();
  const events: string[] = [];
  return {
    objects,
    events,
    headObjectMock: vi.fn(async (key: string) => {
      events.push(`start:${key.split('/')[1]}`);
      const object = objects.get(key);
      if (!object) return null;
      if (object.headThrows) throw new Error('storage unavailable: secret-key-material');
      return {
        contentLength: object.headLength ?? object.bytes.byteLength,
        contentType: object.contentType ?? 'application/pdf',
        etag: 'etag' in object ? object.etag : '"etag-1"',
      };
    }),
    readObjectForExtractionMock: vi.fn(
      async (key: string, etag: string, expectedLength: number) => {
        // Let other queued work try to interleave, so G3 is really exercised.
        await new Promise((resolve) => setTimeout(resolve, 20));
        const object = objects.get(key);
        if (!object || object.read === 'not_found') return { outcome: 'not_found' as const };
        if (object.read === 'changed' || etag !== '"etag-1"')
          return { outcome: 'changed' as const };
        if (expectedLength !== object.bytes.byteLength) return { outcome: 'changed' as const };
        return { outcome: 'ok' as const, bytes: object.bytes };
      },
    ),
  };
});

vi.mock('@/features/knowledge-base/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/knowledge-base/storage')>()),
  headObject: headObjectMock,
  readObjectForExtraction: readObjectForExtractionMock,
}));

import { processKnowledgeDocument } from '@/features/knowledge-base';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/pdfs/${name}`, import.meta.url)));

const LOG_LINE = /^knowledge_document_processing document=[0-9a-f-]{36} outcome=[a-z_]+$/;

async function newDocument(
  label: string,
  status: 'processing' | 'ready' | 'failed' = 'processing',
) {
  const clinic = await createTestClinic(label);
  const staff = await createTestStaffMember(clinic.id, `${label}Owner`, { role: 'owner' });
  const document = await createTestKnowledgeDocument(clinic.id, staff.id, {
    status,
    filename: 'SECRET-FILENAME.pdf',
  });
  return { clinic, document, key: `${clinic.id}/${document.id}` };
}

async function stateOf(documentId: string) {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const doc = await admin.query<{ status: string; failed_reason: string | null }>(
      'SELECT status, failed_reason FROM knowledge_documents WHERE id = $1',
      [documentId],
    );
    const chunks = await admin.query<{ text: string | null; n: number }>(
      `SELECT string_agg(content, '' ORDER BY ordinal) AS text, count(*)::int AS n
         FROM knowledge_document_chunks WHERE document_id = $1`,
      [documentId],
    );
    return { ...doc.rows[0]!, chunks: chunks.rows[0]!.n, text: chunks.rows[0]!.text };
  } finally {
    await admin.end();
  }
}

describe('processKnowledgeDocument (ADR-0026, PR D)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    objects.clear();
    events.length = 0;
    info = vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(`end:${String(line).match(/document=([0-9a-f-]{36})/)?.[1]}`);
    });
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // G4: every line written is exactly "document id + outcome code", nothing else.
    const lines = [...info.mock.calls, ...error.mock.calls].map((call) => call.join(' '));
    for (const line of lines) {
      expect(line).toMatch(LOG_LINE);
      expect(line).not.toMatch(/SECRET|Ωράριο|Opening|secret-key|storage unavailable/);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closePool();
  });

  it('stores the chunk set of a valid PDF and leaves the document processing (D9)', async () => {
    const { clinic, document, key } = await newDocument('ProcStore');
    objects.set(key, { bytes: fixture('greek.pdf') });

    expect(await processKnowledgeDocument(clinic.id, document.id)).toBe('stored');

    const state = await stateOf(document.id);
    expect(state).toMatchObject({ status: 'processing', failed_reason: null });
    expect(state.text).toBe(
      'Ωράριο λειτουργίας: Δευτέρα έως Παρασκευή. Καθαρισμός δοντιών: 40 ευρώ.',
    );
    expect(info).toHaveBeenCalledWith(
      `knowledge_document_processing document=${document.id} outcome=stored`,
    );
    expect(readObjectForExtractionMock).toHaveBeenCalledWith(
      key,
      '"etag-1"',
      fixture('greek.pdf').byteLength,
    );
  });

  it.each([
    ['encrypted-password.pdf', 'encrypted'],
    ['encrypted-owner-only.pdf', 'encrypted'],
    ['scanned.pdf', 'no_extractable_text'],
    ['pages-101.pdf', 'too_many_pages'],
    ['high-text-ratio.pdf', 'too_much_text'],
    ['truncated.pdf', 'extraction_error'],
  ])('%s fails the document with %s', async (name, reason) => {
    const { clinic, document, key } = await newDocument(`ProcFail${reason}`);
    objects.set(key, { bytes: fixture(name) });

    expect(await processKnowledgeDocument(clinic.id, document.id)).toBe(reason);
    expect(await stateOf(document.id)).toMatchObject({
      status: 'failed',
      failed_reason: reason,
      chunks: 0,
    });
  });

  it('re-validates the object as it now stands, failing with the closed storage reasons', async () => {
    const pdf = fixture('english.pdf');
    const cases: [string, StoredObject | undefined][] = [
      ['object_missing', undefined],
      ['object_missing', { bytes: pdf, read: 'not_found' }],
      ['object_changed', { bytes: pdf, read: 'changed' }],
      ['not_a_pdf', { bytes: pdf, contentType: 'text/plain' }],
      ['not_a_pdf', { bytes: new TextEncoder().encode('%PDF-1.7x not a closed header') }],
      ['not_a_pdf', { bytes: new TextEncoder().encode('%PDF') }],
      ['too_large', { bytes: pdf, headLength: 10 * 1024 * 1024 + 1 }],
      ['extraction_error', { bytes: pdf, etag: undefined }],
      ['extraction_error', { bytes: pdf, headThrows: true }],
    ];
    for (const [reason, object] of cases) {
      const { clinic, document, key } = await newDocument(`ProcStorage${reason}`);
      if (object) objects.set(key, object);
      expect(await processKnowledgeDocument(clinic.id, document.id), reason).toBe(reason);
      expect(await stateOf(document.id), reason).toMatchObject({
        status: 'failed',
        failed_reason: reason,
        chunks: 0,
      });
    }
  });

  it('a document that already left processing is reported stale and not overwritten', async () => {
    for (const status of ['failed', 'ready'] as const) {
      const { clinic, document, key } = await newDocument(`ProcStale${status}`, status);
      objects.set(key, { bytes: fixture('english.pdf') });
      const before = await stateOf(document.id);
      expect(await processKnowledgeDocument(clinic.id, document.id)).toBe('stale');
      expect(await stateOf(document.id)).toEqual(before);
    }
  });

  it('processing twice keeps the first chunk set; a later failure cannot overwrite it', async () => {
    const { clinic, document, key } = await newDocument('ProcTwice');
    objects.set(key, { bytes: fixture('english.pdf') });
    expect(await processKnowledgeDocument(clinic.id, document.id)).toBe('stored');
    const first = await stateOf(document.id);

    expect(await processKnowledgeDocument(clinic.id, document.id)).toBe('stale');
    objects.set(key, { bytes: fixture('english.pdf'), read: 'changed' });
    expect(await processKnowledgeDocument(clinic.id, document.id)).toBe('stale');

    expect(await stateOf(document.id)).toEqual(first);
  });

  it('cannot reach another clinic’s document: the outcome is recorded nowhere', async () => {
    const a = await newDocument('ProcClinicA');
    const b = await newDocument('ProcClinicB');
    // Clinic A's context, clinic B's document id: the storage key and the database both refuse.
    objects.set(`${a.clinic.id}/${b.document.id}`, { bytes: fixture('english.pdf') });
    const outcome = await processKnowledgeDocument(a.clinic.id, b.document.id);
    expect(outcome).toBe('unrecorded');
    expect(await stateOf(b.document.id)).toMatchObject({ status: 'processing', chunks: 0 });
    expect(error).toHaveBeenCalledWith(
      `knowledge_document_processing document=${b.document.id} outcome=unrecorded`,
    );
  });

  it('when the outcome cannot be recorded, the document stays processing and the log says so', async () => {
    const { document } = await newDocument('ProcUnrecorded');
    // An invalid tenant context makes every database write fail before it reaches the database.
    expect(await processKnowledgeDocument('not-a-clinic-id', document.id)).toBe('unrecorded');
    expect(await stateOf(document.id)).toMatchObject({ status: 'processing', failed_reason: null });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('processes one document at a time (G3)', async () => {
    const docs = await Promise.all([1, 2, 3].map((n) => newDocument(`ProcQueue${n}`)));
    for (const { key } of docs) objects.set(key, { bytes: fixture('english.pdf') });

    const outcomes = await Promise.all(
      docs.map((d) => processKnowledgeDocument(d.clinic.id, d.document.id)),
    );

    expect(outcomes).toEqual(['stored', 'stored', 'stored']);
    expect(events).toEqual(docs.flatMap((d) => [`start:${d.document.id}`, `end:${d.document.id}`]));
  });

  it('a failure in one document does not stop the queue', async () => {
    const bad = await newDocument('ProcQueueBad');
    const good = await newDocument('ProcQueueGood');
    objects.set(bad.key, { bytes: fixture('english.pdf'), headThrows: true });
    objects.set(good.key, { bytes: fixture('english.pdf') });

    const [first, second] = await Promise.all([
      processKnowledgeDocument(bad.clinic.id, bad.document.id),
      processKnowledgeDocument(good.clinic.id, good.document.id),
    ]);
    expect([first, second]).toEqual(['extraction_error', 'stored']);
  });
});
