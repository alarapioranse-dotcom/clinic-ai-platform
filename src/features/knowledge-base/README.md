# knowledge-base

Will own each clinic's knowledge source — services, pricing, hours, and
policies — used to ground automated replies to patients.

## Current scope (P5 Slice 1A: "document persistence foundation")

Persistence only, record-only: `knowledge_documents`
(`db/migrations/0013_knowledge_documents.sql`) is a file-upload record —
identity, status, and metadata pointing at an object-store key — not a
title/content text model. A corrected file is a new upload, never an edit in
place (`docs/technical/01-database-schema.md`).

- `getKnowledgeDocumentsForClinic(clinicId)` / `getKnowledgeDocument(clinicId, id)`
  — the only operations this slice implements. Both are reads inside one
  transaction scoped to `clinicId` via `withTenantContext` (`src/lib/db.ts`).

**No create operation exists in this slice, deliberately.** `storage_key` is
`NOT NULL` and is only ever produced by the Slice 1B upload flow (ADR-0018:
browser-to-Scaleway presigned PUT). There is no other legitimate source of a
valid `storage_key`, so no `createKnowledgeDocument` function exists here —
inventing a metadata-only document to give this slice something to create
was exactly PR #65's rejected model.

**Not yet implemented** (Slice 1B and later, not this slice):

- Any create, status-transition, or delete operation.
- Scaleway SDK/configuration, bucket provisioning, CORS, presigned URLs, or
  upload bytes.
- Extraction, chunking, embeddings, pgvector, or any AI/retrieval code.
- Any HTTP route or UI that implies upload works.

Row Level Security on `knowledge_documents` is the actual tenant isolation
boundary, not application-side filtering (charter §5), exactly like
`patients`/`conversations`/`appointments`.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `patients`, `conversations`) may import
  from this feature's internals. Only `./index.ts` is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
