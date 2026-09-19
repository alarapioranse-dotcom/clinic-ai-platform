/**
 * Public entry point for the `knowledge-base` feature (roadmap P5 Slice 1:
 * "each clinic maintains its own knowledge base" only — no AI, no retrieval,
 * no embeddings; see `db/migrations/0013_knowledge_documents.sql` and this
 * PR's description for what was deliberately left out of the design-only
 * schema and why). Only this module — never `./repository` — is a valid
 * import target for other features or for `src/app/**` route/page code.
 *
 * Every function here runs inside one `withTenantContext` transaction: the
 * caller supplies `clinicId` (resolved elsewhere — a session, in
 * production), and RLS is the actual isolation boundary
 * (`db/migrations/0013_knowledge_documents.sql`), not any filtering done
 * here.
 */
import { withTenantContext } from '@/lib/db';
import {
  insertKnowledgeDocument,
  listKnowledgeDocuments,
  getKnowledgeDocument,
  updateKnowledgeDocument,
  deleteKnowledgeDocument,
  KnowledgeDocumentNotFoundError,
  type KnowledgeDocument,
  type CreateKnowledgeDocumentInput,
  type UpdateKnowledgeDocumentInput,
} from './repository';

export type { KnowledgeDocument, CreateKnowledgeDocumentInput, UpdateKnowledgeDocumentInput };
export { KnowledgeDocumentNotFoundError };

export async function createKnowledgeDocument(
  clinicId: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  return withTenantContext(clinicId, (client) => insertKnowledgeDocument(client, clinicId, input));
}

export async function listKnowledgeDocumentsForClinic(
  clinicId: string,
): Promise<KnowledgeDocument[]> {
  return withTenantContext(clinicId, (client) => listKnowledgeDocuments(client));
}

/** Throws nothing for a nonexistent or cross-clinic `id` — returns `null` instead, same as `getConversation`. */
export async function getKnowledgeDocumentForClinic(
  clinicId: string,
  id: string,
): Promise<KnowledgeDocument | null> {
  return withTenantContext(clinicId, (client) => getKnowledgeDocument(client, id));
}

/** Throws `KnowledgeDocumentNotFoundError` for a nonexistent or cross-clinic `id`. */
export async function editKnowledgeDocument(
  clinicId: string,
  id: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  return withTenantContext(clinicId, (client) => updateKnowledgeDocument(client, id, input));
}

/** Throws `KnowledgeDocumentNotFoundError` for a nonexistent or cross-clinic `id`. */
export async function removeKnowledgeDocument(clinicId: string, id: string): Promise<void> {
  return withTenantContext(clinicId, (client) => deleteKnowledgeDocument(client, id));
}
