/**
 * Public entry point for the `knowledge-base` feature (roadmap P5 Slice 1A:
 * "document persistence foundation"). Only this module — never
 * `./repository` — is a valid import target for other features or for
 * `src/app/**` route/page code.
 *
 * Record-only, read-only in this slice: `getKnowledgeDocumentsForClinic` and
 * `getKnowledgeDocument` list/fetch `knowledge_documents` rows
 * (`db/migrations/0013_knowledge_documents.sql`). There is no
 * `createKnowledgeDocument` here — `storage_key` is `NOT NULL` and is only
 * ever produced by the Slice 1B upload flow (ADR-0018), which this slice
 * does not implement. No Scaleway SDK, presigned URL, object byte,
 * extraction, chunking, embedding, pgvector, or AI code exists in this
 * feature yet.
 *
 * Every function here is tenant-scoped via `withTenantContext`: the caller
 * supplies `clinicId` (resolved elsewhere — a session, a test fixture — this
 * feature does not resolve it), and RLS is the actual isolation boundary,
 * not any filtering done here.
 */
import { withTenantContext } from '@/lib/db';
import {
  listKnowledgeDocuments,
  getKnowledgeDocumentById,
  type KnowledgeDocument,
  type KnowledgeDocumentStatus,
} from './repository';

export type { KnowledgeDocument, KnowledgeDocumentStatus };

export async function getKnowledgeDocumentsForClinic(
  clinicId: string,
): Promise<KnowledgeDocument[]> {
  return withTenantContext(clinicId, (client) => listKnowledgeDocuments(client));
}

export async function getKnowledgeDocument(
  clinicId: string,
  id: string,
): Promise<KnowledgeDocument | null> {
  return withTenantContext(clinicId, (client) => getKnowledgeDocumentById(client, id));
}
