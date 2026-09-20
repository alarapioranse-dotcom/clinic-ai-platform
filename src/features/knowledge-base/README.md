# knowledge-base

Will own each clinic's knowledge source — services, pricing, hours, and
policies — used to ground automated replies to patients.

## Current scope (P5 Slice 1B: "upload initiation and completion")

`knowledge_documents` (`db/migrations/0013_knowledge_documents.sql`,
`0014_knowledge_documents_insert_grant.sql`) is a file-upload record —
identity, status, and metadata pointing at an object-store key — not a
title/content text model. A corrected file is a new upload, never an edit in
place (`docs/technical/01-database-schema.md`).

- `getKnowledgeDocumentsForClinic(clinicId)` / `getKnowledgeDocument(clinicId, id)`
  (Slice 1A) — reads inside one transaction scoped to `clinicId` via
  `withTenantContext` (`src/lib/db.ts`).
- `createKnowledgeDocumentUploadIntent(clinicId, { filename, mimeType, sizeBytes })`
  (Slice 1B) — upload initiation. Generates the document identity, rejects a
  declared `mimeType` other than `application/pdf` or a declared `sizeBytes`
  over `MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES` (10485760, i.e. 10 MiB — these
  declared-value checks are a UX courtesy only, never authoritative — see
  `docs/technical/06-knowledge-document-storage.md`), and returns a
  presigned PUT the browser uploads directly to Scaleway (ADR-0018) — no
  database row exists yet.
- `completeKnowledgeDocumentUpload(clinicId, uploadedBy, documentId, filename)`
  (Slice 1B) — upload completion. Re-derives `storage_key` from
  `(clinicId, documentId)` (never from client input), calls HeadObject, and
  only inserts the row once the actual `ContentLength`/`Content-Type` pass —
  this is the one legitimate INSERT path Slice 1A deferred.

**Not yet implemented** (a later slice, not this one):

- Any status-transition or delete/download operation on `knowledge_documents`.
- Orphan-object reconciliation (an object uploaded but never completed is an
  accepted limitation of this slice, not a bug — see
  `docs/technical/06-knowledge-document-storage.md`).
- Magic-byte/PDF-signature validation (HeadObject's Content-Type proves only
  Scaleway's stored metadata, not the actual bytes).
- Extraction, chunking, embeddings, pgvector, or any AI/retrieval code.
- Any GET/list HTTP route (Slice 1A's reads have no route yet either).

Row Level Security on `knowledge_documents` is the actual tenant isolation
boundary, not application-side filtering (charter §5), exactly like
`patients`/`conversations`/`appointments`. `./storage.ts` (internal — see
"Rules" below) is the only module that talks to Scaleway; nothing else in
this feature, or outside it, constructs an S3 client or reads a Scaleway
credential.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `patients`, `conversations`) may import
  from this feature's internals. Only `./index.ts` is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
