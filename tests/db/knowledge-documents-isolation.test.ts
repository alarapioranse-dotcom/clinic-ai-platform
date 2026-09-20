import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, type PoolClient, type QueryResult } from 'pg';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import {
  getKnowledgeDocumentsForClinic,
  getKnowledgeDocument,
  completeKnowledgeDocumentUpload,
} from '@/features/knowledge-base';
import { createTestClinic, createTestStaffMember, createTestKnowledgeDocument } from '../fixtures';

/**
 * Storage is mocked for the whole file: every test here exercises the
 * database layer (RLS, grants, constraints), never real Scaleway I/O. Only
 * the "authorized tenant-scoped INSERT is permitted through the intended
 * domain path" test below actually calls into this mock (via
 * `completeKnowledgeDocumentUpload`) — every other test in this file never
 * reaches `storage.ts` at all.
 */
const { headObjectMock } = vi.hoisted(() => ({ headObjectMock: vi.fn() }));
vi.mock('@/features/knowledge-base/storage', () => ({
  headObject: headObjectMock,
  createPresignedUploadUrl: vi.fn(),
}));

/**
 * Database-layer coverage for `db/migrations/0013_knowledge_documents.sql`
 * and `db/migrations/0014_knowledge_documents_insert_grant.sql` (roadmap P5
 * Slices 1A and 1B): RLS tenant isolation, the documented CHECK constraints,
 * the foreign keys (including the `knowledge_documents_uploaded_by_same_clinic`
 * composite FK added on owner review), and `app_user`'s grants — SELECT and,
 * as of 0014, INSERT (never UPDATE/DELETE). Read-path and constraint tests
 * still insert fixture rows directly via `createTestKnowledgeDocument`
 * (../fixtures.ts), the same convention `tests/db/appointments-invariants.test.ts`
 * uses for schema-level behavior; the INSERT-grant tests below instead go
 * through the real application INSERT path (`completeKnowledgeDocumentUpload`)
 * or, for the cross-clinic case, a direct app_user-connection SQL statement
 * (WITH CHECK cannot be forged through `completeKnowledgeDocumentUpload`
 * itself — see that test's own comment).
 */

async function expectFailClosed(run: (client: PoolClient) => Promise<QueryResult>): Promise<void> {
  try {
    const result = await withoutTenantContext(run);
    expect(result.rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(/invalid input syntax for type uuid/i);
  }
}

describe('knowledge documents: persistence, RLS, and grants', () => {
  afterAll(async () => {
    await closePool();
  });

  describe('persistence', () => {
    it('a fixture row round-trips through getKnowledgeDocument with every documented column', async () => {
      const clinic = await createTestClinic('KdocPersist');
      const staff = await createTestStaffMember(clinic.id, 'KdocPersist');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id, {
        filename: 'opening-hours.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });

      const result = await getKnowledgeDocument(clinic.id, doc.id);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        id: doc.id,
        clinicId: clinic.id,
        uploadedBy: staff.id,
        filename: 'opening-hours.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        storageKey: doc.storageKey,
        status: 'processing',
        failedReason: null,
        readyAt: null,
      });
      expect(result?.createdAt).toBeInstanceOf(Date);
    });

    it('a ready document carries a non-null readyAt', async () => {
      const clinic = await createTestClinic('KdocReady');
      const staff = await createTestStaffMember(clinic.id, 'KdocReady');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id, { status: 'ready' });

      const result = await getKnowledgeDocument(clinic.id, doc.id);

      expect(result?.status).toBe('ready');
      expect(result?.readyAt).toBeInstanceOf(Date);
    });

    it('a failed document carries its failedReason', async () => {
      const clinic = await createTestClinic('KdocFailed');
      const staff = await createTestStaffMember(clinic.id, 'KdocFailed');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id, {
        status: 'failed',
        failedReason: 'unsupported file type',
      });

      const result = await getKnowledgeDocument(clinic.id, doc.id);

      expect(result?.status).toBe('failed');
      expect(result?.failedReason).toBe('unsupported file type');
    });

    it('getKnowledgeDocumentsForClinic lists every document for that clinic', async () => {
      const clinic = await createTestClinic('KdocList');
      const staff = await createTestStaffMember(clinic.id, 'KdocList');
      const first = await createTestKnowledgeDocument(clinic.id, staff.id);
      const second = await createTestKnowledgeDocument(clinic.id, staff.id);

      const visible = await getKnowledgeDocumentsForClinic(clinic.id);

      expect(visible.map((d) => d.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    });

    it('getKnowledgeDocument returns null for a nonexistent id', async () => {
      const clinic = await createTestClinic('KdocMissing');

      const result = await getKnowledgeDocument(clinic.id, '00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });
  });

  describe('tenant isolation (RLS)', () => {
    it('Clinic A cannot see Clinic B documents via the list read', async () => {
      const clinicA = await createTestClinic('KdocIsoListA');
      const clinicB = await createTestClinic('KdocIsoListB');
      const staffB = await createTestStaffMember(clinicB.id, 'KdocIsoListB');
      const docB = await createTestKnowledgeDocument(clinicB.id, staffB.id);

      const visibleToA = await getKnowledgeDocumentsForClinic(clinicA.id);

      expect(visibleToA.map((d) => d.id)).not.toContain(docB.id);
    });

    it("Clinic A cannot retrieve Clinic B's document by id", async () => {
      const clinicA = await createTestClinic('KdocIsoGetA');
      const clinicB = await createTestClinic('KdocIsoGetB');
      const staffB = await createTestStaffMember(clinicB.id, 'KdocIsoGetB');
      const docB = await createTestKnowledgeDocument(clinicB.id, staffB.id);

      const result = await getKnowledgeDocument(clinicA.id, docB.id);

      expect(result).toBeNull();
    });

    it('an unscoped SELECT as Clinic A totals exactly Clinic A own rows', async () => {
      const clinicA = await createTestClinic('KdocIsoRawA');
      const clinicB = await createTestClinic('KdocIsoRawB');
      const staffA = await createTestStaffMember(clinicA.id, 'KdocIsoRawA');
      const staffB = await createTestStaffMember(clinicB.id, 'KdocIsoRawB');
      const docA = await createTestKnowledgeDocument(clinicA.id, staffA.id);
      await createTestKnowledgeDocument(clinicB.id, staffB.id);

      const visibleToA = await withTenantContext(clinicA.id, (client) =>
        client.query<{ id: string; clinic_id: string }>(
          'SELECT id, clinic_id FROM knowledge_documents',
        ),
      );

      expect(visibleToA.rows.map((row) => row.id)).toContain(docA.id);
      expect(visibleToA.rows.every((row) => row.clinic_id === clinicA.id)).toBe(true);
    });

    it('no tenant context set fails closed', async () => {
      const clinic = await createTestClinic('KdocNoCtx');
      const staff = await createTestStaffMember(clinic.id, 'KdocNoCtx');
      await createTestKnowledgeDocument(clinic.id, staff.id);

      await expectFailClosed((client) => client.query('SELECT id FROM knowledge_documents'));
    });

    it('a query path that opens no transaction at all also fails closed (ADR-0006 required case)', async () => {
      const clinic = await createTestClinic('KdocNoTxn');
      const staff = await createTestStaffMember(clinic.id, 'KdocNoTxn');
      await createTestKnowledgeDocument(clinic.id, staff.id);

      await expectFailClosed((client) => client.query('SELECT id FROM knowledge_documents'));
    });

    it('FORCE ROW LEVEL SECURITY remains enabled on knowledge_documents (0014 changed no RLS setting)', async () => {
      const admin = new Client({ connectionString: getDatabaseUrl() });
      await admin.connect();
      try {
        const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
          `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'knowledge_documents'`,
        );
        expect(rows[0]?.relforcerowsecurity).toBe(true);
      } finally {
        await admin.end();
      }
    });

    it("cross-clinic INSERT is rejected by the existing tenant_isolation policy's WITH CHECK (0014 grants INSERT, changes no policy)", async () => {
      // Cannot be forged through completeKnowledgeDocumentUpload itself:
      // that function always derives storage_key and the inserted row's
      // clinic_id from the same clinicId it also sets as the transaction's
      // own app.current_clinic_id, so a mismatched clinic_id is structurally
      // unreachable through the intended domain path — which is itself the
      // property this test's sibling above ("authorized tenant-scoped
      // INSERT is permitted...") demonstrates. Reaching a genuine
      // clinic_id-vs-session mismatch requires issuing the INSERT directly,
      // still through app_user (the tenant-scoped connection
      // withTenantContext provides), so this exercises the same WITH CHECK
      // 0013 already established, not a new policy.
      const clinicA = await createTestClinic('KdocInsertCheckA');
      const clinicB = await createTestClinic('KdocInsertCheckB');
      const staffB = await createTestStaffMember(clinicB.id, 'KdocInsertCheckB');

      await expect(
        withTenantContext(clinicA.id, (client) =>
          client.query(
            `INSERT INTO knowledge_documents (id, clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
             VALUES ($1, $2, $3, 'x.pdf', 'application/pdf', 1, 'x')`,
            [randomUUID(), clinicB.id, staffB.id],
          ),
        ),
      ).rejects.toThrow(/row-level security policy/i);
    });
  });

  describe('app_user grants (least privilege)', () => {
    it('app_user can SELECT knowledge_documents (required for the list/get reads)', async () => {
      const clinic = await createTestClinic('KdocGrantSelect');
      const staff = await createTestStaffMember(clinic.id, 'KdocGrantSelect');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id);

      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query('SELECT id FROM knowledge_documents WHERE id = $1', [doc.id]),
        ),
      ).resolves.toMatchObject({ rows: [{ id: doc.id }] });
    });

    it('app_user can INSERT knowledge_documents through the intended domain path (completeKnowledgeDocumentUpload, 0014)', async () => {
      const clinic = await createTestClinic('KdocGrantInsert');
      const staff = await createTestStaffMember(clinic.id, 'KdocGrantInsert');
      const documentId = randomUUID();
      headObjectMock.mockResolvedValueOnce({ contentLength: 2048, contentType: 'application/pdf' });

      const document = await completeKnowledgeDocumentUpload(
        clinic.id,
        staff.id,
        documentId,
        'grant-check.pdf',
      );

      expect(document.id).toBe(documentId);
      expect(document.status).toBe('processing');
      const persisted = await getKnowledgeDocument(clinic.id, documentId);
      expect(persisted).toMatchObject({ id: documentId, filename: 'grant-check.pdf' });
    });

    it('app_user has no UPDATE grant on knowledge_documents', async () => {
      const clinic = await createTestClinic('KdocGrantNoUpdate');
      const staff = await createTestStaffMember(clinic.id, 'KdocGrantNoUpdate');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id);

      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query(`UPDATE knowledge_documents SET filename = 'renamed.pdf' WHERE id = $1`, [
            doc.id,
          ]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('app_user has no DELETE grant on knowledge_documents', async () => {
      const clinic = await createTestClinic('KdocGrantNoDelete');
      const staff = await createTestStaffMember(clinic.id, 'KdocGrantNoDelete');
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id);

      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query('DELETE FROM knowledge_documents WHERE id = $1', [doc.id]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('documented CHECK constraints', () => {
    it('rejects size_bytes <= 0', async () => {
      const clinic = await createTestClinic('KdocCheckSize');
      const staff = await createTestStaffMember(clinic.id, 'KdocCheckSize');

      const admin = new Client({ connectionString: getDatabaseUrl() });
      await admin.connect();
      try {
        await admin.query('BEGIN');
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
        await expect(
          admin.query(
            `INSERT INTO knowledge_documents (clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
             VALUES ($1, $2, 'x.pdf', 'application/pdf', 0, 'x')`,
            [clinic.id, staff.id],
          ),
        ).rejects.toThrow(/violates check constraint/i);
        await admin.query('ROLLBACK');
      } finally {
        await admin.end();
      }
    });

    it("rejects status = 'ready' with ready_at NULL (knowledge_document_status_fields_match)", async () => {
      await expect(
        createTestKnowledgeDocumentRaw({ status: 'ready', readyAtOverride: null }),
      ).rejects.toThrow(/knowledge_document_status_fields_match|violates check constraint/i);
    });

    it("rejects status <> 'ready' with ready_at set (knowledge_document_status_fields_match)", async () => {
      await expect(
        createTestKnowledgeDocumentRaw({ status: 'processing', readyAtOverride: new Date() }),
      ).rejects.toThrow(/knowledge_document_status_fields_match|violates check constraint/i);
    });

    it("rejects failed_reason set while status <> 'failed' (knowledge_document_failed_reason_matches_status)", async () => {
      await expect(
        createTestKnowledgeDocumentRaw({ status: 'processing', failedReasonOverride: 'oops' }),
      ).rejects.toThrow(
        /knowledge_document_failed_reason_matches_status|violates check constraint/i,
      );
    });

    it("accepts status = 'failed' with a failed_reason", async () => {
      await expect(
        createTestKnowledgeDocumentRaw({ status: 'failed', failedReasonOverride: 'bad file' }),
      ).resolves.toEqual(expect.any(String));
    });
  });

  describe('foreign keys', () => {
    it('rejects a clinic_id referencing a nonexistent clinic', async () => {
      const clinic = await createTestClinic('KdocFkClinic');
      const staff = await createTestStaffMember(clinic.id, 'KdocFkClinic');

      const admin = new Client({ connectionString: getDatabaseUrl() });
      await admin.connect();
      try {
        await expect(
          admin.query(
            `INSERT INTO knowledge_documents (clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
             VALUES ($1, $2, 'x.pdf', 'application/pdf', 1, 'x')`,
            ['00000000-0000-0000-0000-000000000000', staff.id],
          ),
        ).rejects.toThrow(/violates foreign key constraint/i);
      } finally {
        await admin.end();
      }
    });

    it('rejects an uploaded_by referencing a nonexistent staff member', async () => {
      const clinic = await createTestClinic('KdocFkStaff');

      const admin = new Client({ connectionString: getDatabaseUrl() });
      await admin.connect();
      try {
        await admin.query('BEGIN');
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
        await expect(
          admin.query(
            `INSERT INTO knowledge_documents (clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
             VALUES ($1, $2, 'x.pdf', 'application/pdf', 1, 'x')`,
            [clinic.id, '00000000-0000-0000-0000-000000000000'],
          ),
        ).rejects.toThrow(/violates foreign key constraint/i);
        await admin.query('ROLLBACK');
      } finally {
        await admin.end();
      }
    });

    it('rejects an uploaded_by belonging to a different clinic than clinic_id (knowledge_documents_uploaded_by_same_clinic)', async () => {
      // SQLSTATE 23503 (foreign_key_violation), verified directly against a
      // real Postgres instance while adding this constraint: "insert or
      // update on table \"knowledge_documents\" violates foreign key
      // constraint \"knowledge_documents_uploaded_by_same_clinic\"" — same
      // structural pattern as appointments_practitioner_same_clinic and
      // messages_sender_staff_same_clinic above.
      const clinicA = await createTestClinic('KdocFkStaffClinicA');
      const clinicB = await createTestClinic('KdocFkStaffClinicB');
      const staffB = await createTestStaffMember(clinicB.id, 'KdocFkStaffClinicB');

      const admin = new Client({ connectionString: getDatabaseUrl() });
      await admin.connect();
      try {
        await admin.query('BEGIN');
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicA.id]);
        await expect(
          admin.query(
            `INSERT INTO knowledge_documents (clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
             VALUES ($1, $2, 'x.pdf', 'application/pdf', 1, 'x')`,
            [clinicA.id, staffB.id],
          ),
        ).rejects.toThrow(
          /knowledge_documents_uploaded_by_same_clinic|violates foreign key constraint/i,
        );
        await admin.query('ROLLBACK');
      } finally {
        await admin.end();
      }
    });
  });

  /**
   * Raw insert helper for the CHECK-constraint tests above, which need to
   * construct a row shape `createTestKnowledgeDocument` (../fixtures.ts)
   * deliberately never allows (it always keeps ready_at/failed_reason
   * consistent with status). Runs over the admin/owner connection with
   * tenant context set, same pattern as the fixture helper.
   */
  async function createTestKnowledgeDocumentRaw(options: {
    status: 'processing' | 'ready' | 'failed';
    readyAtOverride?: Date | null;
    failedReasonOverride?: string | null;
  }): Promise<string> {
    const clinic = await createTestClinic('KdocRaw');
    const staff = await createTestStaffMember(clinic.id, 'KdocRaw');

    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO knowledge_documents
           (clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key, status, ready_at, failed_reason)
         VALUES ($1, $2, 'x.pdf', 'application/pdf', 1, 'x', $3, $4, $5)
         RETURNING id`,
        [
          clinic.id,
          staff.id,
          options.status,
          options.readyAtOverride ?? null,
          options.failedReasonOverride ?? null,
        ],
      );
      await admin.query('COMMIT');
      return rows[0]!.id;
    } catch (err) {
      await admin.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await admin.end();
    }
  }
});
