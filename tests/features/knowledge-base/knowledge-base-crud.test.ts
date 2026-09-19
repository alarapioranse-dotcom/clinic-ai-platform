import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import {
  createKnowledgeDocument,
  listKnowledgeDocumentsForClinic,
  getKnowledgeDocumentForClinic,
  editKnowledgeDocument,
  removeKnowledgeDocument,
  KnowledgeDocumentNotFoundError,
} from '@/features/knowledge-base';
import { createTestClinic } from '../../fixtures';

const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Feature-level CRUD coverage for the P5 Slice 1 `knowledge-base` feature
 * (roadmap: "each clinic maintains its own knowledge base"). Runs against a
 * real Postgres instance through `app_user`, same precondition as every
 * other test here — see tests/db/tenant-isolation.test.ts. Synthetic clinic
 * data only, never real patient/clinic data (CLAUDE.md hard rule).
 */
describe('createKnowledgeDocument', () => {
  afterAll(async () => {
    await closePool();
  });

  it('creates a document scoped to the caller clinic', async () => {
    const clinic = await createTestClinic('KbCreate1');

    const document = await createKnowledgeDocument(clinic.id, {
      title: 'ساعات العمل',
      content: 'نعمل من الأحد إلى الخميس، ٩ صباحًا حتى ٥ مساءً.',
    });

    expect(document.clinicId).toBe(clinic.id);
    expect(document.title).toBe('ساعات العمل');
    expect(document.content).toBe('نعمل من الأحد إلى الخميس، ٩ صباحًا حتى ٥ مساءً.');
    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects an empty title', async () => {
    const clinic = await createTestClinic('KbCreate2');

    await expect(
      createKnowledgeDocument(clinic.id, { title: '   ', content: 'some content' }),
    ).rejects.toThrow(/title is required/);
  });

  it('rejects empty content', async () => {
    const clinic = await createTestClinic('KbCreate3');

    await expect(
      createKnowledgeDocument(clinic.id, { title: 'Pricing', content: '' }),
    ).rejects.toThrow(/content is required/);
  });
});

describe('listKnowledgeDocumentsForClinic', () => {
  afterAll(async () => {
    await closePool();
  });

  it('a clinic with documents receives its own documents', async () => {
    const clinic = await createTestClinic('KbList1');
    const document = await createKnowledgeDocument(clinic.id, {
      title: 'الأسعار',
      content: 'الكشف: ٢٠٠ جنيه',
    });

    const documents = await listKnowledgeDocumentsForClinic(clinic.id);

    expect(documents.map((d) => d.id)).toContain(document.id);
  });

  it('a clinic with no documents receives an empty list', async () => {
    const clinic = await createTestClinic('KbList2');

    const documents = await listKnowledgeDocumentsForClinic(clinic.id);

    expect(documents).toEqual([]);
  });

  it("does not include another clinic's documents", async () => {
    const clinicOwn = await createTestClinic('KbListIsoOwn');
    const clinicOther = await createTestClinic('KbListIsoOther');
    await createKnowledgeDocument(clinicOther.id, {
      title: 'other clinic doc',
      content: 'other clinic content',
    });

    const documents = await listKnowledgeDocumentsForClinic(clinicOwn.id);

    expect(documents).toEqual([]);
  });
});

describe('getKnowledgeDocumentForClinic', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns the document for its own clinic', async () => {
    const clinic = await createTestClinic('KbGet1');
    const created = await createKnowledgeDocument(clinic.id, {
      title: 'Policies',
      content: 'Cancel 24h in advance.',
    });

    const found = await getKnowledgeDocumentForClinic(clinic.id, created.id);

    expect(found).toEqual(created);
  });

  it('returns null for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbGet2');

    const found = await getKnowledgeDocumentForClinic(clinic.id, NONEXISTENT_ID);

    expect(found).toBeNull();
  });

  it("returns null for another clinic's document under the calling clinic context", async () => {
    const clinicOwn = await createTestClinic('KbGetIsoOwn');
    const clinicOther = await createTestClinic('KbGetIsoOther');
    const other = await createKnowledgeDocument(clinicOther.id, {
      title: 'other',
      content: 'other content',
    });

    const found = await getKnowledgeDocumentForClinic(clinicOwn.id, other.id);

    expect(found).toBeNull();
  });
});

describe('editKnowledgeDocument', () => {
  afterAll(async () => {
    await closePool();
  });

  it('updates title and content in place', async () => {
    const clinic = await createTestClinic('KbEdit1');
    const created = await createKnowledgeDocument(clinic.id, {
      title: 'Old title',
      content: 'Old content',
    });

    const updated = await editKnowledgeDocument(clinic.id, created.id, {
      title: 'New title',
      content: 'New content',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('New title');
    expect(updated.content).toBe('New content');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const reread = await getKnowledgeDocumentForClinic(clinic.id, created.id);
    expect(reread?.title).toBe('New title');
  });

  it('throws KnowledgeDocumentNotFoundError for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbEdit2');

    await expect(
      editKnowledgeDocument(clinic.id, NONEXISTENT_ID, { title: 'x', content: 'y' }),
    ).rejects.toThrow(KnowledgeDocumentNotFoundError);
  });

  it("throws KnowledgeDocumentNotFoundError for another clinic's document", async () => {
    const clinicOwn = await createTestClinic('KbEditIsoOwn');
    const clinicOther = await createTestClinic('KbEditIsoOther');
    const other = await createKnowledgeDocument(clinicOther.id, {
      title: 'other',
      content: 'other content',
    });

    await expect(
      editKnowledgeDocument(clinicOwn.id, other.id, { title: 'hacked', content: 'hacked' }),
    ).rejects.toThrow(KnowledgeDocumentNotFoundError);

    // And confirm the other clinic's document was left untouched.
    const untouched = await getKnowledgeDocumentForClinic(clinicOther.id, other.id);
    expect(untouched?.title).toBe('other');
  });

  it('rejects an empty title on edit', async () => {
    const clinic = await createTestClinic('KbEdit3');
    const created = await createKnowledgeDocument(clinic.id, { title: 'ok', content: 'ok' });

    await expect(
      editKnowledgeDocument(clinic.id, created.id, { title: '', content: 'ok' }),
    ).rejects.toThrow(/title is required/);
  });
});

describe('removeKnowledgeDocument', () => {
  afterAll(async () => {
    await closePool();
  });

  it('deletes the document', async () => {
    const clinic = await createTestClinic('KbDelete1');
    const created = await createKnowledgeDocument(clinic.id, { title: 'ok', content: 'ok' });

    await removeKnowledgeDocument(clinic.id, created.id);

    const found = await getKnowledgeDocumentForClinic(clinic.id, created.id);
    expect(found).toBeNull();
  });

  it('throws KnowledgeDocumentNotFoundError for a nonexistent ID', async () => {
    const clinic = await createTestClinic('KbDelete2');

    await expect(removeKnowledgeDocument(clinic.id, NONEXISTENT_ID)).rejects.toThrow(
      KnowledgeDocumentNotFoundError,
    );
  });

  it("throws KnowledgeDocumentNotFoundError and does not delete another clinic's document", async () => {
    const clinicOwn = await createTestClinic('KbDeleteIsoOwn');
    const clinicOther = await createTestClinic('KbDeleteIsoOther');
    const other = await createKnowledgeDocument(clinicOther.id, {
      title: 'other',
      content: 'other content',
    });

    await expect(removeKnowledgeDocument(clinicOwn.id, other.id)).rejects.toThrow(
      KnowledgeDocumentNotFoundError,
    );

    const stillThere = await getKnowledgeDocumentForClinic(clinicOther.id, other.id);
    expect(stillThere).not.toBeNull();
  });
});
