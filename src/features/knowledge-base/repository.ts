import type { PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/knowledge-base/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 *
 * Roadmap P5 Slice 1A ("document persistence foundation"): record-only
 * operations against `knowledge_documents` (`db/migrations/0013_knowledge_documents.sql`).
 * Deliberately read-only — no `insertKnowledgeDocument` exists here. A real
 * row can only ever be created by the Slice 1B upload flow (ADR-0018:
 * presigned PUT to Scaleway, then `INSERT ... storage_key = clinic_id/document_id`),
 * which is out of scope for this slice; there is no other legitimate source
 * of a `storage_key` value. Object bytes are never touched by this module —
 * only the metadata row.
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
