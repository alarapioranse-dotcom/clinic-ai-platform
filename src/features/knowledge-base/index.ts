/**
 * Public entry point for the `knowledge-base` feature. Only this module —
 * never `./repository` or `./storage` — is a valid import target for other
 * features or for `src/app/**` route/page code.
 *
 * Roadmap P5 Slice 1A ("document persistence foundation") added the
 * read-only `getKnowledgeDocumentsForClinic`/`getKnowledgeDocument` pair.
 * Roadmap P5 Slice 1B (ADR-0018, human-approved decisions) adds the upload
 * flow: `createKnowledgeDocumentUploadIntent` (initiation) and
 * `completeKnowledgeDocumentUpload` (completion) — direct browser-to-Scaleway
 * upload via a presigned PUT, file bytes never passing through this process.
 * No extraction, chunking, embedding, pgvector, or AI code exists in this
 * feature yet — that remains a later slice.
 *
 * Every function here is tenant-scoped via `withTenantContext`: the caller
 * supplies `clinicId` (resolved elsewhere — a session, a test fixture — this
 * feature does not resolve it), and RLS is the actual isolation boundary,
 * not any filtering done here.
 */
import { randomUUID } from 'node:crypto';
import { withTenantContext } from '@/lib/db';
import {
  listKnowledgeDocuments,
  getKnowledgeDocumentById,
  insertKnowledgeDocument,
  DuplicateKnowledgeDocumentError,
  type KnowledgeDocument,
  type KnowledgeDocumentStatus,
} from './repository';
import { createPresignedUploadUrl, headObject } from './storage';

export type { KnowledgeDocument, KnowledgeDocumentStatus };
export { DuplicateKnowledgeDocumentError };

/**
 * The only declared MIME type this slice accepts (human-approved decision).
 * Applied at both initiation (client-declared, a UX courtesy only — see
 * `InvalidDeclaredMimeTypeError`) and completion (the actual stored
 * Content-Type from HeadObject — see `UploadObjectContentTypeMismatchError`
 * — which is authoritative).
 */
export const ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE = 'application/pdf';

/**
 * 10 MiB, exactly `10 * 1024 * 1024` (human-approved decision) — never
 * written elsewhere as "10 MB". Applied at both initiation
 * (client-declared, non-authoritative — see `DeclaredSizeTooLargeError`)
 * and completion (the actual stored ContentLength from HeadObject — see
 * `UploadObjectTooLargeError` — which is authoritative).
 */
export const MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Short-lived, per ADR-0018's "short expiry" requirement for the presigned PUT. */
const PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS = 300;

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

/**
 * Thrown by `createKnowledgeDocumentUploadIntent` when the client-declared
 * `mimeType` isn't `application/pdf`. This check is a UX courtesy only —
 * catching an obviously wrong file before the browser spends time uploading
 * it — never authoritative enforcement: nothing stops a client from
 * declaring `application/pdf` and then uploading a different file. Only
 * `completeKnowledgeDocumentUpload`'s HeadObject check is authoritative.
 */
export class InvalidDeclaredMimeTypeError extends Error {
  constructor() {
    super(`Declared file type must be ${ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE}.`);
    this.name = 'InvalidDeclaredMimeTypeError';
  }
}

/**
 * Thrown by `createKnowledgeDocumentUploadIntent` when the client-declared
 * `sizeBytes` exceeds `MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES`. Same
 * non-authoritative caveat as `InvalidDeclaredMimeTypeError` above — a
 * client can declare any value it likes; only the completion-time
 * HeadObject check on the actual object is authoritative.
 */
export class DeclaredSizeTooLargeError extends Error {
  constructor() {
    super(`Declared file size must not exceed ${MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES} bytes.`);
    this.name = 'DeclaredSizeTooLargeError';
  }
}

export interface CreateKnowledgeDocumentUploadIntentInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface KnowledgeDocumentUploadIntent {
  documentId: string;
  uploadUrl: string;
  expiresAt: Date;
}

/**
 * Upload initiation (ADR-0018 / `docs/technical/06-knowledge-document-storage.md`).
 * Generates the document identity and a presigned PUT bound to exactly
 * `clinicId/documentId`, with `input.mimeType` bound into the signature
 * (`storage.ts`'s `createPresignedUploadUrl`) — the browser's PUT must send
 * the identical `Content-Type` header or Scaleway rejects the signature.
 *
 * No database row is created here, deliberately: `knowledge_documents.id`
 * only ever gets a row once `completeKnowledgeDocumentUpload` has verified
 * the actual uploaded object. A browser that never calls completion leaves
 * an object with no row — the accepted "orphan object" limitation
 * (`docs/technical/06-knowledge-document-storage.md`) — never a row
 * pointing at bytes that were never checked.
 */
export async function createKnowledgeDocumentUploadIntent(
  clinicId: string,
  input: CreateKnowledgeDocumentUploadIntentInput,
): Promise<KnowledgeDocumentUploadIntent> {
  if (input.mimeType !== ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE) {
    throw new InvalidDeclaredMimeTypeError();
  }
  if (input.sizeBytes > MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES) {
    throw new DeclaredSizeTooLargeError();
  }

  const documentId = randomUUID();
  const storageKey = `${clinicId}/${documentId}`;
  const uploadUrl = await createPresignedUploadUrl(
    storageKey,
    input.mimeType,
    PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS,
  );

  return {
    documentId,
    uploadUrl,
    expiresAt: new Date(Date.now() + PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS * 1000),
  };
}

/**
 * Thrown by `completeKnowledgeDocumentUpload` when HeadObject finds nothing
 * at the re-derived storage key — the browser upload never completed, or a
 * completion attempt derived a key under a different clinic's prefix than
 * whatever was actually uploaded (the cross-clinic case; see this
 * function's own doc comment). Indistinguishable from a plain missing
 * object, deliberately, same 404-collapsing rationale used everywhere else
 * in this codebase for cross-tenant access.
 */
export class UploadObjectMissingError extends Error {
  constructor() {
    super('No uploaded object was found for this document.');
    this.name = 'UploadObjectMissingError';
  }
}

/** Thrown when the actual uploaded object's ContentLength exceeds the limit — the authoritative check, unlike initiation's declared-size check. */
export class UploadObjectTooLargeError extends Error {
  constructor() {
    super(`The uploaded object exceeds the ${MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES}-byte limit.`);
    this.name = 'UploadObjectTooLargeError';
  }
}

/** Thrown when the actual uploaded object's stored Content-Type isn't application/pdf — the authoritative check, unlike initiation's declared-type check. */
export class UploadObjectContentTypeMismatchError extends Error {
  constructor() {
    super(`The uploaded object's Content-Type is not ${ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE}.`);
    this.name = 'UploadObjectContentTypeMismatchError';
  }
}

/**
 * Upload completion (ADR-0018 / `docs/technical/06-knowledge-document-storage.md`).
 * `storageKey` is re-derived here from `(clinicId, documentId)` — both
 * already trusted (`clinicId` from the caller's verified session,
 * `documentId` validated as a UUID by the caller) — and is never accepted
 * from client input, so a client cannot point this at an arbitrary object.
 *
 * HeadObject's actual `ContentLength`/`Content-Type` are the sole authority
 * for size/type — `filename` is the only value this function still trusts
 * from the client, exactly like `insertKnowledgeDocument`'s other metadata
 * columns; it is never used for any check. A stored `Content-Type` of
 * `application/pdf` proves only Scaleway's recorded metadata, not that the
 * bytes are actually a PDF (magic-byte validation is a future follow-up,
 * not this slice's job).
 *
 * Inserts nothing when any check fails. `DuplicateKnowledgeDocumentError`
 * (from `insertKnowledgeDocument`) surfaces a completion retry after an
 * already-successful completion for the same `documentId`.
 */
export async function completeKnowledgeDocumentUpload(
  clinicId: string,
  uploadedBy: string,
  documentId: string,
  filename: string,
): Promise<KnowledgeDocument> {
  const storageKey = `${clinicId}/${documentId}`;

  const head = await headObject(storageKey);
  if (!head) {
    throw new UploadObjectMissingError();
  }
  if (head.contentLength > MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES) {
    throw new UploadObjectTooLargeError();
  }
  if (head.contentType !== ALLOWED_KNOWLEDGE_DOCUMENT_MIME_TYPE) {
    throw new UploadObjectContentTypeMismatchError();
  }

  return withTenantContext(clinicId, (client) =>
    insertKnowledgeDocument(client, {
      id: documentId,
      clinicId,
      uploadedBy,
      filename,
      mimeType: head.contentType!,
      sizeBytes: head.contentLength,
      storageKey,
    }),
  );
}
