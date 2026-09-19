import { describe, it, expect, afterAll } from 'vitest';
import type { PoolClient, QueryResult } from 'pg';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import {
  createKnowledgeDocument,
  listKnowledgeDocumentsForClinic,
} from '@/features/knowledge-base';
import { createTestClinic } from '../fixtures';

/**
 * Same helper, same rationale, as tests/db/tenant-isolation.test.ts's
 * `expectFailClosed`.
 */
async function expectFailClosed(run: (client: PoolClient) => Promise<QueryResult>): Promise<void> {
  try {
    const result = await withoutTenantContext(run);
    expect(result.rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(/invalid input syntax for type uuid/i);
  }
}

/**
 * Proves tenant isolation on `knowledge_documents`
 * (`db/migrations/0013_knowledge_documents.sql`) is enforced by RLS at the
 * data layer, per ADR-0003/ADR-0006 — same shape as
 * tests/db/tenant-isolation.test.ts (patients) and
 * tests/db/conversations-isolation.test.ts.
 */
describe('tenant isolation: knowledge_documents', () => {
  afterAll(async () => {
    await closePool();
  });

  it('Clinic A sees its own knowledge document', async () => {
    const clinicA = await createTestClinic('KbIsoA1');
    const document = await createKnowledgeDocument(clinicA.id, {
      title: 'Hours',
      content: '9am - 5pm',
    });

    const visible = await listKnowledgeDocumentsForClinic(clinicA.id);

    expect(visible.map((d) => d.id)).toContain(document.id);
  });

  it('Clinic A cannot see Clinic B knowledge documents', async () => {
    const clinicA = await createTestClinic('KbIsoA2');
    const clinicB = await createTestClinic('KbIsoB2');
    const documentB = await createKnowledgeDocument(clinicB.id, {
      title: 'B only',
      content: 'B content',
    });

    const visibleToA = await listKnowledgeDocumentsForClinic(clinicA.id);

    expect(visibleToA.map((d) => d.id)).not.toContain(documentB.id);
    expect(visibleToA.every((d) => d.clinicId === clinicA.id)).toBe(true);
  });

  it('no tenant context set (unset variable, inside a transaction) fails closed', async () => {
    const clinicA = await createTestClinic('KbIsoA3');
    await createKnowledgeDocument(clinicA.id, { title: 'x', content: 'y' });

    await expectFailClosed(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await client.query('SELECT id FROM knowledge_documents');
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  });

  it('a query path that opens no transaction at all also fails closed', async () => {
    const clinicA = await createTestClinic('KbIsoA4');
    await createKnowledgeDocument(clinicA.id, { title: 'x', content: 'y' });

    await expectFailClosed((client) => client.query('SELECT id FROM knowledge_documents'));
  });

  it('rejects an insert whose clinic_id does not match the transaction tenant context', async () => {
    const clinicA = await createTestClinic('KbIsoA5');
    const clinicB = await createTestClinic('KbIsoB5');

    await expect(
      withTenantContext(clinicA.id, (client) =>
        client.query(
          `INSERT INTO knowledge_documents (clinic_id, title, content) VALUES ($1, $2, $3)`,
          [clinicB.id, 'cross-tenant title', 'cross-tenant content'],
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);

    const visibleToB = await listKnowledgeDocumentsForClinic(clinicB.id);
    expect(visibleToB.map((d) => d.title)).not.toContain('cross-tenant title');
  });

  it("an update targeting another clinic's document touches zero rows, not the row", async () => {
    const clinicA = await createTestClinic('KbIsoA6');
    const clinicB = await createTestClinic('KbIsoB6');
    const documentB = await createKnowledgeDocument(clinicB.id, {
      title: 'original',
      content: 'original content',
    });

    const updateResult = await withTenantContext(clinicA.id, (client) =>
      client.query(`UPDATE knowledge_documents SET title = $1 WHERE id = $2`, [
        'should not apply',
        documentB.id,
      ]),
    );
    expect(updateResult.rowCount).toBe(0);

    const [unchanged] = await listKnowledgeDocumentsForClinic(clinicB.id);
    expect(unchanged?.title).toBe('original');
  });

  it("a delete targeting another clinic's document touches zero rows", async () => {
    const clinicA = await createTestClinic('KbIsoA7');
    const clinicB = await createTestClinic('KbIsoB7');
    const documentB = await createKnowledgeDocument(clinicB.id, {
      title: 'to keep',
      content: 'to keep content',
    });

    const deleteResult = await withTenantContext(clinicA.id, (client) =>
      client.query(`DELETE FROM knowledge_documents WHERE id = $1`, [documentB.id]),
    );
    expect(deleteResult.rowCount).toBe(0);

    const stillVisible = await listKnowledgeDocumentsForClinic(clinicB.id);
    expect(stillVisible.map((d) => d.id)).toContain(documentB.id);
  });
});

/**
 * Content-validation CHECK constraints
 * (`db/migrations/0013_knowledge_documents.sql`), exercised directly against
 * the database — the task's "empty/content validation per the contract"
 * requirement, proven structurally rather than only at the application
 * layer (the feature layer's own `assertValid` is covered in
 * tests/features/knowledge-base/knowledge-base-crud.test.ts).
 */
describe('knowledge_documents CHECK constraints', () => {
  afterAll(async () => {
    await closePool();
  });

  it('rejects an empty title at the database layer', async () => {
    const clinic = await createTestClinic('KbCheckTitle');

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query(
          `INSERT INTO knowledge_documents (clinic_id, title, content) VALUES ($1, $2, $3)`,
          [clinic.id, '', 'some content'],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects empty content at the database layer', async () => {
    const clinic = await createTestClinic('KbCheckContent');

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query(
          `INSERT INTO knowledge_documents (clinic_id, title, content) VALUES ($1, $2, $3)`,
          [clinic.id, 'some title', ''],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });
});
