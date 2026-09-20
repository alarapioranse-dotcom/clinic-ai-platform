import { DatabaseError, type PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/knowledge-base/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 *
 * Roadmap P5 Slice 1A ("document persistence foundation") added the
 * read-only operations below. Roadmap P5 Slice 1B (ADR-0018) adds
 * `insertKnowledgeDocument` — the one legitimate way a row is ever created,
 * called only after `./index.ts`'s `completeKnowledgeDocumentUpload` has
 * independently verified the uploaded object via HeadObject. Object bytes
 * are never touched by this module — only the metadata row.
 */

export type KnowledgeDocumentStatus = 'processing' | 'ready' | 'failed';

export interface KnowledgeDocument {
  id: string;
  clinicId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: KnowledgeDocumentStatus;
  failedReason: string | null;
  createdAt: Date;
  readyAt: Date | null;
}

interface KnowledgeDocumentRow {
  id: string;
  clinic_id: string;
  uploaded_by: string;
  filename: string;
  mime_type: string;
  size_bytes: string; // bigint arrives as string from `pg` unless a type parser is registered
  storage_key: string;
  status: KnowledgeDocumentStatus;
  failed_reason: string | null;
  created_at: Date;
  ready_at: Date | null;
}

function toKnowledgeDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    uploadedBy: row.uploaded_by,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    status: row.status,
    failedReason: row.failed_reason,
    createdAt: row.created_at,
    readyAt: row.ready_at,
  };
}

const KNOWLEDGE_DOCUMENT_COLUMNS = `id, clinic_id, uploaded_by, filename, mime_type, size_bytes,
     storage_key, status, failed_reason, created_at, ready_at`;

/**
 * Lists every knowledge document visible in the caller's transaction.
 * Deliberately unfiltered by `clinic_id` in application code — RLS is the
 * filter (charter §5), same pattern as `src/features/patients/repository.ts`'s
 * `listPatients`.
 */
export async function listKnowledgeDocuments(client: PoolClient): Promise<KnowledgeDocument[]> {
  const { rows } = await client.query<KnowledgeDocumentRow>(
    `SELECT ${KNOWLEDGE_DOCUMENT_COLUMNS}
     FROM knowledge_documents
     ORDER BY created_at`,
  );
  return rows.map(toKnowledgeDocument);
}

/**
 * Looks up one knowledge document by ID. Returns `null` when no such
 * document is visible in the caller's transaction — RLS makes "doesn't
 * exist" and "exists, wrong clinic" indistinguishable here, same as
 * `src/features/conversations/repository.ts`'s `getConversationWithMessages`.
 */
export async function getKnowledgeDocumentById(
  client: PoolClient,
  id: string,
): Promise<KnowledgeDocument | null> {
  const { rows } = await client.query<KnowledgeDocumentRow>(
    `SELECT ${KNOWLEDGE_DOCUMENT_COLUMNS}
     FROM knowledge_documents
     WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toKnowledgeDocument(row) : null;
}

/**
 * Thrown by `insertKnowledgeDocument` when `id` already has a row — the
 * completion endpoint called twice for the same upload (a retry after a
 * successful completion, not the "orphan" case, which never reaches this
 * function at all since it never gets past HeadObject). Surfaces the
 * `knowledge_documents_pkey` unique-violation, same "let the schema be the
 * authority" pattern as `AppointmentConflictError` in
 * `src/features/appointments/repository.ts`.
 */
export class DuplicateKnowledgeDocumentError extends Error {
  constructor() {
    super('This document has already been recorded.');
    this.name = 'DuplicateKnowledgeDocumentError';
  }
}

export interface InsertKnowledgeDocumentInput {
  /** The document id generated at upload-initiation time — never DB-generated (see 0014's migration comment). */
  id: string;
  clinicId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

/**
 * The one legitimate INSERT path for `knowledge_documents` (roadmap P5
 * Slice 1B, ADR-0018, `db/migrations/0014_knowledge_documents_insert_grant.sql`).
 * Callers must have already verified `mimeType`/`sizeBytes` against the
 * actual uploaded object (HeadObject) before calling this — this function
 * performs no storage-side verification of its own, only the database
 * write. `status` is left at its `processing` default and `ready_at`/
 * `failed_reason` at `NULL`, matching `knowledge_document_status_fields_match`
 * — this slice does not implement the processing pipeline that would move
 * status forward.
 */
export async function insertKnowledgeDocument(
  client: PoolClient,
  input: InsertKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  try {
    const { rows } = await client.query<KnowledgeDocumentRow>(
      `INSERT INTO knowledge_documents (id, clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${KNOWLEDGE_DOCUMENT_COLUMNS}`,
      [
        input.id,
        input.clinicId,
        input.uploadedBy,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.storageKey,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Insert into knowledge_documents returned no row');
    }
    return toKnowledgeDocument(row);
  } catch (err) {
    if (err instanceof DatabaseError && err.constraint === 'knowledge_documents_pkey') {
      throw new DuplicateKnowledgeDocumentError();
    }
    throw err;
  }
}
