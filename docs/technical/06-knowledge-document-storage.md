# Knowledge Document Storage

Covers what [`docs/domain/00-overview.md`](../domain/00-overview.md) names as deferred to C:
"Storage details for Knowledge Documents (file storage, embeddings)." The `knowledge_documents`
table itself (identity, status, metadata) is already defined in
[`01-database-schema.md`](./01-database-schema.md); this document covers the two things that
table's `storage_key` column and status lifecycle point at but don't themselves store: the raw
uploaded file, and whatever representation retrieval actually searches over.

## Raw file storage

Uploaded files (the PDF/DOCX/etc. a clinic uploads) are stored in an S3-compatible object store,
one object per `knowledge_documents.storage_key`, **not** as a database column — a multi-megabyte
binary blob in Postgres would bloat every backup and every RLS-scoped query's working set for no
benefit, and object storage is the ordinary tool for this job.

- **Bucket/region is left unspecified here**, per the data-residency assumption in
  [`00-overview.md`](./00-overview.md) — whichever region is chosen must satisfy "data resides in
  the EU" (charter §7) as currently assumed, and that assumption itself is what
  [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7) may revisit. This
  document does not commit to a vendor or region for that reason.
- Access is via short-lived, server-generated URLs — no bucket or object is ever public. A
  download request goes through `GET /api/knowledge-documents/:id` (or a dedicated download
  endpoint), which re-derives `storage_key` from the RLS-scoped row lookup — a request for another
  clinic's document ID never resolves to a valid `storage_key` in the first place, so file access
  inherits tenant isolation from the same mechanism as everything else in this system, rather than
  needing its own.
- Deleting a `knowledge_documents` row (per `DELETE /api/knowledge-documents/:id`,
  [`03-api-contracts.md`](./03-api-contracts.md)) deletes the corresponding object in the same
  logical operation — a document is never left orphaned in the object store after its row is gone.

## Processing lifecycle (Processing → Ready / Failed)

```text
POST /api/knowledge-documents (multipart upload)
  1. Validate file type/size (B: pre-upload validation branches). Reject with 400 before
     anything is persisted if invalid.
  2. Upload the raw file to object storage under a new storage_key.
  3. INSERT knowledge_documents (status = 'processing').  ─────► 201 returned to the caller
     immediately; steps 4-6 run asynchronously.
  4. Extract text content from the file.
  5. Split into retrieval-sized chunks and generate embeddings for each (see below).
  6. On success: UPDATE knowledge_documents SET status = 'ready', ready_at = now()
                 WHERE id = :id AND status = 'processing';
     On failure: UPDATE knowledge_documents SET status = 'failed', failed_reason = :reason
                 WHERE id = :id AND status = 'processing';
```

The `WHERE status = 'processing'` guard on both terminal updates is what keeps status
"forward-only" (B, KnowledgeDocument aggregate invariant) true under retries: an async job that
retries after a transient failure and eventually succeeds can't accidentally move an
already-`failed` row back to `ready`, or vice versa, because by the time a delayed retry's update
runs, the row may no longer match `processing`.

## Retrieval-time storage — a requirement, not a decided architecture

What Stage 3 (RETRIEVE) in [`05-ai-pipeline.md`](./05-ai-pipeline.md) needs is: **given a Clinic
and a query, return the most relevant chunks of that Clinic's `Ready` KnowledgeDocuments, scoped by
`clinic_id` like every other read in this system.** That requirement is fixed here. _Where_ the
chunk/embedding representation physically lives is not — it is Open Question 3 in
[`07-open-questions.md`](./07-open-questions.md), between two candidate architectures:

- **Co-located**: a `knowledge_document_chunks` table in the same Postgres database, using the
  `pgvector` extension for similarity search, `clinic_id`-scoped and RLS-protected exactly like
  every table in [`01-database-schema.md`](./01-database-schema.md) — retrieval becomes an
  ordinary tenant-isolated query, no second system to keep in sync or separately secure.
- **Dedicated vector store**: a separate, retrieval-specialized service, with `clinic_id` carried
  as metadata on each stored vector and filtered on at query time — isolation there depends on that
  service's own filtering being applied correctly on every query, which is exactly the
  "remembering to add `WHERE clinic_id = ...` everywhere, forever" failure mode ADR-0003 was
  written to avoid for the primary database; extending that same trust model to a second store is
  not automatic and would need its own equivalent of Row Level Security-strength guarantees to
  match this platform's isolation bar.

Neither is chosen here. Whichever the underlying storage, this represents the retrieval-time
content of a `Ready` KnowledgeDocument (chunk text plus its embedding vector), keyed back to
`knowledge_documents.id` — it is **not** a new domain entity: it has no independent lifecycle,
identity, or meaning outside the KnowledgeDocument it was derived from (deleting the
KnowledgeDocument deletes its chunks; a chunk is never referenced from anywhere except the
retrieval step). This is the same "infrastructure supporting an existing aggregate" framing
[`00-overview.md`](./00-overview.md) applies to `staff_sessions` in
[`04-auth-implementation.md`](./04-auth-implementation.md).

## What must hold regardless of which candidate is chosen

- Retrieval never returns chunks from a KnowledgeDocument whose status is not `ready` — deleting or
  re-uploading a document must make its old chunks unreachable at least as promptly as the row's
  own status changes, so a `Failed` or since-deleted document can never leak into a grounded reply.
- Retrieval is always scoped to one `clinic_id`, with the same "no cross-tenant leak, checked
  structurally, not by remembering a `WHERE` clause" bar as the rest of this platform — this is the
  one requirement neither candidate architecture above is allowed to relax, whichever Ahmed
  chooses.
