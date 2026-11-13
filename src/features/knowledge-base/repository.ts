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

/**
 * `55000 object_not_in_prerequisite_state`: the 0020 functions' answer when a
 * document is no longer `processing` or already has a chunk set — a stale or
 * conflicting report the caller must not overwrite (ADR-0026 section 7, E6).
 */
const NOT_PROCESSING_OR_CHUNKED = '55000';

function isStaleReport(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === NOT_PROCESSING_OR_CHUNKED
  );
}

export interface KnowledgeDocumentChunkSet {
  canonicalText: string;
  chunks: string[];
  extractorVersion: string;
  canonicalizationVersion: string;
}

/**
 * Stores one complete chunk set through `store_knowledge_document_chunks`
 * (db/migrations/0020, ADR-0026) — the only write path; `app_user` has no
 * direct write on `knowledge_document_chunks`. The database derives every
 * offset, validates the whole set and leaves the document `processing`.
 * Returns `'stale'` when the document is no longer `processing` or already
 * has a chunk set; any other database error is thrown.
 */
export async function storeKnowledgeDocumentChunks(
  client: PoolClient,
  documentId: string,
  chunkSet: KnowledgeDocumentChunkSet,
): Promise<'stored' | 'stale'> {
  try {
    await client.query('SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[])', [
      documentId,
      chunkSet.extractorVersion,
      chunkSet.canonicalizationVersion,
      chunkSet.canonicalText,
      chunkSet.chunks,
    ]);
    return 'stored';
  } catch (err) {
    if (isStaleReport(err)) return 'stale';
    throw err;
  }
}

/**
 * Moves a `processing` document with no chunk set to `failed` through
 * `mark_knowledge_document_failed` (db/migrations/0020, ADR-0026). `reason`
 * must be one of the closed codes the function accepts. Returns `'stale'`
 * when the document already left `processing` or has a chunk set; any other
 * database error is thrown.
 */
export async function markKnowledgeDocumentFailed(
  client: PoolClient,
  documentId: string,
  reason: string,
): Promise<'failed' | 'stale'> {
  try {
    await client.query('SELECT mark_knowledge_document_failed($1, $2)', [documentId, reason]);
    return 'failed';
  } catch (err) {
    if (isStaleReport(err)) return 'stale';
    throw err;
  }
}

/**
 * ADR-0028 decision 2: the ids of the context clinic's stuck documents —
 * still `processing`, with no chunk set, and created more than
 * `olderThanMinutes` ago. A document whose chunk set was stored is `ready`
 * since migration 0021 (ADR-0030); the no-chunk-set condition still keeps any
 * `processing` row that has one off the list.
 */
export async function listStuckKnowledgeDocumentIds(
  client: PoolClient,
  olderThanMinutes: number,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT d.id
       FROM knowledge_documents d
      WHERE d.status = 'processing'
        AND d.created_at < now() - make_interval(mins => $1::int)
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_document_chunks c WHERE c.document_id = d.id
        )
      ORDER BY d.created_at`,
    [olderThanMinutes],
  );
  return result.rows.map((row) => row.id);
}

/** One search hit: a chunk of a ready document, its text exactly as stored. */
export interface KnowledgeSearchHit {
  documentId: string;
  filename: string;
  ordinal: number;
  content: string;
}

/**
 * ADR-0030 decision 4: each search runs with this statement timeout, set
 * locally in its transaction, so a slow search fails cleanly instead of
 * holding a connection.
 */
export const KNOWLEDGE_SEARCH_STATEMENT_TIMEOUT = '5s';

/**
 * ADR-0030 decisions 1, 2 and 4: keyword search over the caller's clinic's
 * ready documents, as `app_user` inside the caller's tenant transaction (RLS
 * and FORCE RLS decide which rows exist; there is no clinic filter here).
 *
 * A chunk matches when `websearch_to_tsquery` of the query matches it under
 * any of the `arabic`, `greek` or `english` configurations; results are
 * ordered by the highest `ts_rank` across the three, then by document and
 * chunk order, and capped at `limit`. Vectors are computed at query time: no
 * index exists (decision 4).
 *
 * Returns `null` when the query reduces to no search term in any of the three
 * configurations (for example only stop words), so the caller can say so
 * instead of showing an empty list. The query is a bind parameter only; it is
 * never logged or interpolated.
 */
export async function searchReadyKnowledgeChunks(
  client: PoolClient,
  query: string,
  limit: number,
): Promise<KnowledgeSearchHit[] | null> {
  await client.query("SELECT pg_catalog.set_config('statement_timeout', $1, true)", [
    KNOWLEDGE_SEARCH_STATEMENT_TIMEOUT,
  ]);

  const terms = await client.query<{ has_terms: boolean }>(
    `SELECT pg_catalog.numnode(pg_catalog.websearch_to_tsquery('pg_catalog.arabic', $1)) > 0
         OR pg_catalog.numnode(pg_catalog.websearch_to_tsquery('pg_catalog.greek', $1)) > 0
         OR pg_catalog.numnode(pg_catalog.websearch_to_tsquery('pg_catalog.english', $1)) > 0
         AS has_terms`,
    [query],
  );
  if (!terms.rows[0]?.has_terms) {
    return null;
  }

  const result = await client.query<{
    document_id: string;
    filename: string;
    ordinal: number;
    content: string;
  }>(
    `WITH q AS (
       SELECT pg_catalog.websearch_to_tsquery('pg_catalog.arabic', $1) AS ar,
              pg_catalog.websearch_to_tsquery('pg_catalog.greek', $1) AS el,
              pg_catalog.websearch_to_tsquery('pg_catalog.english', $1) AS en
     ),
     scored AS (
       SELECT c.document_id, d.filename, d.created_at, c.ordinal, c.content,
              pg_catalog.to_tsvector('pg_catalog.arabic', c.content) AS v_ar,
              pg_catalog.to_tsvector('pg_catalog.greek', c.content) AS v_el,
              pg_catalog.to_tsvector('pg_catalog.english', c.content) AS v_en
         FROM knowledge_document_chunks c
         JOIN knowledge_documents d
           ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        WHERE d.status = 'ready'
     )
     SELECT s.document_id, s.filename, s.ordinal, s.content
       FROM scored s, q
      WHERE s.v_ar @@ q.ar OR s.v_el @@ q.el OR s.v_en @@ q.en
      ORDER BY GREATEST(
                 CASE WHEN s.v_ar @@ q.ar THEN pg_catalog.ts_rank(s.v_ar, q.ar) ELSE 0 END,
                 CASE WHEN s.v_el @@ q.el THEN pg_catalog.ts_rank(s.v_el, q.el) ELSE 0 END,
                 CASE WHEN s.v_en @@ q.en THEN pg_catalog.ts_rank(s.v_en, q.en) ELSE 0 END
               ) DESC,
               s.created_at, s.document_id, s.ordinal
      LIMIT $2`,
    [query, limit],
  );

  return result.rows.map((row) => ({
    documentId: row.document_id,
    filename: row.filename,
    ordinal: row.ordinal,
    content: row.content,
  }));
}
