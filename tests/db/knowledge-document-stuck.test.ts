import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import {
  failStuckKnowledgeDocuments,
  getKnowledgeDocumentsForClinic,
  STUCK_DOCUMENT_MINUTES,
} from '@/features/knowledge-base';
import { storeKnowledgeDocumentChunks } from '@/features/knowledge-base/repository';
import { closePool, withTenantContext } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * ADR-0028 decision 2 against the real database (migration 0020): a document
 * still `processing` with no chunk set, more than 15 minutes after it was
 * created, is marked failed (`extraction_timeout`) when the clinic's list is
 * read. Documents that are recent, have a chunk set, already left
 * `processing`, or belong to another clinic are untouched.
 */
async function admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const backdate = (documentId: string, minutes: number) =>
  admin((client) =>
    client.query(
      `UPDATE knowledge_documents SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1`,
      [documentId, minutes],
    ),
  );

const stateOf = (documentId: string) =>
  admin(async (client) => {
    const { rows } = await client.query<{ status: string; failed_reason: string | null }>(
      'SELECT status, failed_reason FROM knowledge_documents WHERE id = $1',
      [documentId],
    );
    return rows[0]!;
  });

async function newClinic(label: string) {
  const clinic = await createTestClinic(label);
  const staff = await createTestStaffMember(clinic.id, `${label}Owner`, { role: 'owner' });
  const document = (status: 'processing' | 'ready' | 'failed' = 'processing') =>
    createTestKnowledgeDocument(clinic.id, staff.id, { status, filename: 'SECRET-FILENAME.pdf' });
  return { clinic, document };
}

describe('stuck knowledge documents (ADR-0028)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closePool();
  });

  it('uses a 15-minute threshold', () => {
    expect(STUCK_DOCUMENT_MINUTES).toBe(15);
  });

  it('fails a processing document with no chunk set once it is older than the threshold', async () => {
    const { clinic, document } = await newClinic('StuckOld');
    const stuck = await document();
    await backdate(stuck.id, STUCK_DOCUMENT_MINUTES + 1);

    const listed = await getKnowledgeDocumentsForClinic(clinic.id);

    expect(await stateOf(stuck.id)).toEqual({
      status: 'failed',
      failed_reason: 'extraction_timeout',
    });
    expect(listed.find((d) => d.id === stuck.id)).toMatchObject({
      status: 'failed',
      failedReason: 'extraction_timeout',
    });
  });

  it('leaves a document younger than the threshold processing', async () => {
    const { clinic, document } = await newClinic('StuckRecent');
    const recent = await document();
    await backdate(recent.id, STUCK_DOCUMENT_MINUTES - 1);

    await getKnowledgeDocumentsForClinic(clinic.id);

    expect(await stateOf(recent.id)).toEqual({ status: 'processing', failed_reason: null });
    expect(info).not.toHaveBeenCalled();
  });

  it('never fails an old document that has a chunk set (extracted, awaiting embeddings)', async () => {
    const { clinic, document } = await newClinic('StuckExtracted');
    const extracted = await document();
    const stored = await withTenantContext(clinic.id, (client) =>
      storeKnowledgeDocumentChunks(client, extracted.id, {
        canonicalText: 'Opening hours. Prices.',
        chunks: ['Opening hours. ', 'Prices.'],
        extractorVersion: 'test',
        canonicalizationVersion: 'test',
      }),
    );
    expect(stored).toBe('stored');
    await backdate(extracted.id, 24 * 60);

    await getKnowledgeDocumentsForClinic(clinic.id);

    expect(await stateOf(extracted.id)).toEqual({ status: 'processing', failed_reason: null });
  });

  it('leaves ready and failed documents as they are, however old', async () => {
    const { clinic, document } = await newClinic('StuckFinal');
    const ready = await document('ready');
    const failed = await document('failed');
    await backdate(ready.id, 24 * 60);
    await backdate(failed.id, 24 * 60);

    await failStuckKnowledgeDocuments(clinic.id);

    expect((await stateOf(ready.id)).status).toBe('ready');
    expect(await stateOf(failed.id)).toEqual({ status: 'failed', failed_reason: 'test failure' });
  });

  it("does not touch another clinic's stuck document", async () => {
    const a = await newClinic('StuckA');
    const b = await newClinic('StuckB');
    const stuckInB = await b.document();
    await backdate(stuckInB.id, 60);

    await getKnowledgeDocumentsForClinic(a.clinic.id);
    expect(await stateOf(stuckInB.id)).toEqual({ status: 'processing', failed_reason: null });

    await getKnowledgeDocumentsForClinic(b.clinic.id);
    expect((await stateOf(stuckInB.id)).status).toBe('failed');
  });

  it('fails every stuck document of the clinic and logs only ids and outcome codes', async () => {
    const { clinic, document } = await newClinic('StuckMany');
    const first = await document();
    const second = await document();
    await backdate(first.id, 30);
    await backdate(second.id, 20);

    await failStuckKnowledgeDocuments(clinic.id);

    expect((await stateOf(first.id)).status).toBe('failed');
    expect((await stateOf(second.id)).status).toBe('failed');
    const lines = info.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines).toEqual([
      `knowledge_document_stuck document=${first.id} outcome=failed`,
      `knowledge_document_stuck document=${second.id} outcome=failed`,
    ]);
    expect(lines.join('\n')).not.toContain('SECRET-FILENAME');
    expect(error).not.toHaveBeenCalled();
  });

  it('is idempotent: a second read changes nothing and logs nothing', async () => {
    const { clinic, document } = await newClinic('StuckTwice');
    const stuck = await document();
    await backdate(stuck.id, 60);
    await getKnowledgeDocumentsForClinic(clinic.id);
    info.mockClear();

    await getKnowledgeDocumentsForClinic(clinic.id);

    expect(info).not.toHaveBeenCalled();
    expect((await stateOf(stuck.id)).failed_reason).toBe('extraction_timeout');
  });

  it('never throws when the check itself cannot run', async () => {
    await expect(failStuckKnowledgeDocuments('not-a-uuid')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('knowledge_document_stuck check=failed');
  });
});
