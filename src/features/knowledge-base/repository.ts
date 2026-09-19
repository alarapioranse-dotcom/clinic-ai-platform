import type { PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/knowledge-base/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 */

export interface KnowledgeDocument {
  id: string;
  clinicId: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeDocumentInput {
  title: string;
  content: string;
}

export interface UpdateKnowledgeDocumentInput {
  title: string;
  content: string;
}

interface KnowledgeDocumentRow {
  id: string;
  clinic_id: string;
  title: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

interface IdRow {
  id: string;
}

/**
 * Thrown for a nonexistent or cross-clinic `id` on read, update, or delete.
 * RLS makes "doesn't exist" and "exists, wrong clinic" indistinguishable
 * here, same pattern as `ConversationNotFoundError`
 * (`src/features/conversations/repository.ts`) — never used to leak which
 * case actually occurred.
 */
export class KnowledgeDocumentNotFoundError extends Error {
  constructor() {
    super('Knowledge document not found');
    this.name = 'KnowledgeDocumentNotFoundError';
  }
}

function toKnowledgeDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertValid(input: { title: string; content: string }): void {
  if (!input.title.trim()) {
    throw new Error('title is required for a knowledge document');
  }
  if (!input.content.trim()) {
    throw new Error('content is required for a knowledge document');
  }
}

/**
 * Inserts a knowledge-document row for the clinic the caller's transaction
 * is already scoped to (via `withTenantContext`). `clinicId` is passed
 * explicitly and used as a parameter — never string-interpolated — so a
 * caller cannot insert into a clinic other than the one RLS has scoped this
 * transaction to; RLS's `WITH CHECK` clause enforces that independently
 * regardless. Mirrors `src/features/patients/repository.ts`'s
 * `insertPatient`.
 */
export async function insertKnowledgeDocument(
  client: PoolClient,
  clinicId: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  assertValid(input);

  const { rows } = await client.query<KnowledgeDocumentRow>(
    `INSERT INTO knowledge_documents (clinic_id, title, content)
     VALUES ($1, $2, $3)
     RETURNING id, clinic_id, title, content, created_at, updated_at`,
    [clinicId, input.title, input.content],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Insert into knowledge_documents returned no row');
  }
  return toKnowledgeDocument(row);
}

/**
 * Lists every knowledge document visible in the caller's transaction.
 * Deliberately unfiltered by `clinic_id` in application code — RLS is the
 * filter (charter §5); this query would return another clinic's rows too if
 * RLS were ever misconfigured, which is exactly what the isolation test
 * suite checks for. Mirrors `listPatients`/`listConversations`.
 */
export async function listKnowledgeDocuments(client: PoolClient): Promise<KnowledgeDocument[]> {
  const { rows } = await client.query<KnowledgeDocumentRow>(
    `SELECT id, clinic_id, title, content, created_at, updated_at
     FROM knowledge_documents
     ORDER BY created_at`,
  );
  return rows.map(toKnowledgeDocument);
}

/**
 * Looks up one knowledge document by ID. Returns `null` when no such
 * document is visible in the caller's transaction — same "RLS makes
 * nonexistent and cross-clinic indistinguishable" pattern as
 * `getConversationWithMessages`.
 */
export async function getKnowledgeDocument(
  client: PoolClient,
  id: string,
): Promise<KnowledgeDocument | null> {
  const { rows } = await client.query<KnowledgeDocumentRow>(
    `SELECT id, clinic_id, title, content, created_at, updated_at
     FROM knowledge_documents
     WHERE id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? toKnowledgeDocument(row) : null;
}

/**
 * Updates one knowledge document's title/content in place (UPDATE-in-place
 * "edit", per this slice's create/edit UI — see
 * `db/migrations/0013_knowledge_documents.sql`). `WHERE id = $1` alone is
 * sufficient to scope this to the caller's own clinic: RLS's `WITH CHECK`
 * on `tenant_isolation` means a cross-clinic `id` simply matches zero rows
 * rather than updating another clinic's document. Throws
 * `KnowledgeDocumentNotFoundError` when no row was updated.
 */
export async function updateKnowledgeDocument(
  client: PoolClient,
  id: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  assertValid(input);

  const { rows } = await client.query<KnowledgeDocumentRow>(
    `UPDATE knowledge_documents
     SET title = $2, content = $3, updated_at = now()
     WHERE id = $1
     RETURNING id, clinic_id, title, content, created_at, updated_at`,
    [id, input.title, input.content],
  );

  const row = rows[0];
  if (!row) {
    throw new KnowledgeDocumentNotFoundError();
  }
  return toKnowledgeDocument(row);
}

/**
 * Deletes one knowledge document. Throws `KnowledgeDocumentNotFoundError`
 * when no row was deleted (nonexistent or cross-clinic `id` — RLS scopes
 * `DELETE` exactly like every other statement here).
 */
export async function deleteKnowledgeDocument(client: PoolClient, id: string): Promise<void> {
  const { rows } = await client.query<IdRow>(
    `DELETE FROM knowledge_documents WHERE id = $1 RETURNING id`,
    [id],
  );

  if (!rows[0]) {
    throw new KnowledgeDocumentNotFoundError();
  }
}
