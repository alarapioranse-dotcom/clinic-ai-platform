import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { closePool, withTenantContext } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import {
  searchKnowledgeBase,
  InvalidKnowledgeSearchQueryError,
  KNOWLEDGE_SEARCH_MAX_RESULTS,
} from '@/features/knowledge-base';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * ADR-0030: staff keyword search over the clinic's ready documents, against
 * PostgreSQL with RLS. Synthetic text only. Proves: per-clinic isolation, only
 * `ready` documents, the three-language matching recorded in ADR-0030's
 * Context, the 10-result cap, query validation, the no-terms outcome and the
 * local statement timeout.
 */

async function storeChunks(clinicId: string, documentId: string, chunks: string[]): Promise<void> {
  await withTenantContext(clinicId, (client) =>
    client.query('SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[])', [
      documentId,
      'test',
      'test',
      chunks.join(''),
      chunks,
    ]),
  );
}

async function readyDocument(clinicId: string, staffId: string, chunks: string[]): Promise<string> {
  const document = await createTestKnowledgeDocument(clinicId, staffId);
  await storeChunks(clinicId, document.id, chunks);
  return document.id;
}

/** Puts a stored document back into another status, as the superuser (for the filter tests). */
async function forceStatus(documentId: string, status: 'processing' | 'failed'): Promise<void> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(
      `UPDATE knowledge_documents
          SET status = $2, ready_at = NULL,
              failed_reason = CASE WHEN $2 = 'failed' THEN 'encrypted' ELSE NULL END
        WHERE id = $1`,
      [documentId, status],
    );
  } finally {
    await admin.end();
  }
}

async function hitsFor(clinicId: string, query: string) {
  const result = await searchKnowledgeBase(clinicId, query);
  if (result.outcome !== 'results') throw new Error(`expected results, got ${result.outcome}`);
  return result.hits;
}

describe('searchKnowledgeBase (ADR-0030)', () => {
  afterAll(async () => {
    await closePool();
  });

  it("returns only the caller's clinic's chunks", async () => {
    const a = await createTestClinic('SearchIsolationA');
    const b = await createTestClinic('SearchIsolationB');
    const staffA = await createTestStaffMember(a.id, 'SearchIsolationOwnerA', { role: 'owner' });
    const staffB = await createTestStaffMember(b.id, 'SearchIsolationOwnerB', { role: 'owner' });
    const docA = await readyDocument(a.id, staffA.id, ['Opening hours: Monday to Friday.']);
    const docB = await readyDocument(b.id, staffB.id, ['Opening hours: Saturday only.']);

    const hitsA = await hitsFor(a.id, 'opening hours');
    expect(hitsA.map((h) => h.documentId)).toEqual([docA]);
    const hitsB = await hitsFor(b.id, 'opening hours');
    expect(hitsB.map((h) => h.documentId)).toEqual([docB]);
  });

  it('returns the chunk text exactly as stored, with the file name and chunk order', async () => {
    const clinic = await createTestClinic('SearchShape');
    const staff = await createTestStaffMember(clinic.id, 'SearchShapeOwner', { role: 'owner' });
    const document = await createTestKnowledgeDocument(clinic.id, staff.id);
    await storeChunks(clinic.id, document.id, ['First part. ', 'Parking is free for patients.']);

    const hits = await hitsFor(clinic.id, 'parking');
    expect(hits).toEqual([
      {
        documentId: document.id,
        filename: document.filename,
        ordinal: 1,
        content: 'Parking is free for patients.',
      },
    ]);
  });

  it('never returns a chunk of a processing or failed document', async () => {
    const clinic = await createTestClinic('SearchStatus');
    const staff = await createTestStaffMember(clinic.id, 'SearchStatusOwner', { role: 'owner' });
    const ready = await readyDocument(clinic.id, staff.id, ['Whitening costs 200 euros.']);
    const processing = await readyDocument(clinic.id, staff.id, ['Whitening takes one hour.']);
    const failed = await readyDocument(clinic.id, staff.id, ['Whitening is safe.']);
    await forceStatus(processing, 'processing');
    await forceStatus(failed, 'failed');

    const hits = await hitsFor(clinic.id, 'whitening');
    expect(hits.map((h) => h.documentId)).toEqual([ready]);
  });

  it('matches Arabic without the definite article and across hamza forms, but not broken plurals', async () => {
    const clinic = await createTestClinic('SearchArabic');
    const staff = await createTestStaffMember(clinic.id, 'SearchArabicOwner', { role: 'owner' });
    const document = await readyDocument(clinic.id, staff.id, ['أسعار التنظيف في العيادة']);

    expect((await hitsFor(clinic.id, 'تنظيف')).map((h) => h.documentId)).toEqual([document]);
    expect((await hitsFor(clinic.id, 'اسعار')).map((h) => h.documentId)).toEqual([document]);
    expect(await hitsFor(clinic.id, 'سعر')).toEqual([]);
  });

  it('matches Greek regardless of accents and case, and English by stem', async () => {
    const clinic = await createTestClinic('SearchGreekEnglish');
    const staff = await createTestStaffMember(clinic.id, 'SearchGreekOwner', { role: 'owner' });
    const greek = await readyDocument(clinic.id, staff.id, ['Η τιμή του καθαρισμού.']);
    const english = await readyDocument(clinic.id, staff.id, ['Cleaning prices for adults.']);

    expect((await hitsFor(clinic.id, 'ΤΙΜΗ')).map((h) => h.documentId)).toEqual([greek]);
    expect((await hitsFor(clinic.id, 'price clean')).map((h) => h.documentId)).toEqual([english]);
  });

  it('finds each language of a mixed-language document', async () => {
    const clinic = await createTestClinic('SearchMixed');
    const staff = await createTestStaffMember(clinic.id, 'SearchMixedOwner', { role: 'owner' });
    const document = await readyDocument(clinic.id, staff.id, [
      'مواعيد العمل. Ωράριο λειτουργίας. Working hours.',
    ]);

    for (const query of ['مواعيد', 'ωράριο', 'working']) {
      expect(
        (await hitsFor(clinic.id, query)).map((h) => h.documentId),
        query,
      ).toEqual([document]);
    }
  });

  it(`caps results at ${KNOWLEDGE_SEARCH_MAX_RESULTS}`, async () => {
    const clinic = await createTestClinic('SearchCap');
    const staff = await createTestStaffMember(clinic.id, 'SearchCapOwner', { role: 'owner' });
    await readyDocument(
      clinic.id,
      staff.id,
      Array.from({ length: 12 }, (_, i) => `Implant note ${i}. `),
    );

    const hits = await hitsFor(clinic.id, 'implant');
    expect(hits).toHaveLength(KNOWLEDGE_SEARCH_MAX_RESULTS);
    // Equal rank: document order, then chunk order.
    expect(hits.map((h) => h.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ranks the better match first', async () => {
    const clinic = await createTestClinic('SearchRank');
    const staff = await createTestStaffMember(clinic.id, 'SearchRankOwner', { role: 'owner' });
    const weak = await readyDocument(clinic.id, staff.id, ['Crown. Other topics follow here.']);
    const strong = await readyDocument(clinic.id, staff.id, ['Crown crown crown fitting.']);

    expect((await hitsFor(clinic.id, 'crown')).map((h) => h.documentId)).toEqual([strong, weak]);
  });

  it('reports no_terms for a query with no search term, and handles any input without error', async () => {
    const clinic = await createTestClinic('SearchTerms');
    // Punctuation only: no lexeme under any of the three configurations. (English stop words
    // alone are not enough: the arabic and greek configurations keep them as terms.)
    expect(await searchKnowledgeBase(clinic.id, '!!! ... ??')).toEqual({ outcome: 'no_terms' });
    // websearch_to_tsquery accepts any text without a syntax error.
    for (const query of ['"unclosed', '-', 'a & | ! ( )', "'; DROP TABLE x; --"]) {
      const result = await searchKnowledgeBase(clinic.id, query);
      expect(['results', 'no_terms'], query).toContain(result.outcome);
    }
  });

  it('rejects an empty, blank or over-long query without touching the database', async () => {
    const clinic = await createTestClinic('SearchValidation');
    for (const query of ['', '   ', 'x'.repeat(201)]) {
      await expect(searchKnowledgeBase(clinic.id, query)).rejects.toBeInstanceOf(
        InvalidKnowledgeSearchQueryError,
      );
    }
    // 200 characters after trimming is allowed; length counts code points.
    await expect(searchKnowledgeBase(clinic.id, ` ${'ب'.repeat(200)} `)).resolves.toBeDefined();
  });

  it('never puts the query in the error message', async () => {
    const clinic = await createTestClinic('SearchMessage');
    const secret = 'Synthetic patient words '.repeat(10);
    const error = await searchKnowledgeBase(clinic.id, secret).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidKnowledgeSearchQueryError);
    expect((error as Error).message).not.toContain('Synthetic');
  });

  it('runs with a 5 second statement timeout local to its transaction', async () => {
    const clinic = await createTestClinic('SearchTimeout');
    const { searchReadyKnowledgeChunks } = await import('@/features/knowledge-base/repository');
    const timeouts = await withTenantContext(clinic.id, async (client) => {
      const before = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
      await searchReadyKnowledgeChunks(client, 'anything', 10);
      const after = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
      return [before.rows[0]!.statement_timeout, after.rows[0]!.statement_timeout];
    });
    expect(timeouts[1]).toBe('5s');
    expect(timeouts[0]).not.toBe('5s');
    // Local to the transaction: a new one starts from the server default again.
    const next = await withTenantContext(clinic.id, (client) =>
      client.query<{ statement_timeout: string }>('SHOW statement_timeout'),
    );
    expect(next.rows[0]!.statement_timeout).toBe(timeouts[0]);
  });
});
