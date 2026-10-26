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

- **Vendor and region**: this document originally left them unspecified, deferring to
  [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7). That question is
  now resolved by [ADR-0018](../adr/0018-knowledge-document-object-storage.md) (Accepted): Scaleway
  Object Storage, region `fr-par`, satisfying the EU/EEA residency
  [ADR-0009](../adr/0009-data-residency.md) requires.
- Access is via short-lived, server-generated URLs — no bucket or object is ever public. A
  download request goes through `GET /api/knowledge-documents/:id` (or a dedicated download
  endpoint), which re-derives `storage_key` from the RLS-scoped row lookup — a request for another
  clinic's document ID never resolves to a valid `storage_key` in the first place, so file access
  inherits tenant isolation from the same mechanism as everything else in this system, rather than
  needing its own.
- Deleting a `knowledge_documents` row (per `DELETE /api/knowledge-documents/:id`,
  [`03-api-contracts.md`](./03-api-contracts.md)) deletes the corresponding object in the same
  logical operation — a document is never left orphaned in the object store after its row is gone.

## Upload is two validated stages, not one

Roadmap P5 Slice 1B ([ADR-0018](../adr/0018-knowledge-document-object-storage.md), Accepted)
implements the upload path this section's "Raw file storage" already fixed the shape of: the
browser uploads directly to Scaleway, and the application validates that upload in two stages that
are not interchangeable and must not be conflated.

- **Initiation** (`POST /api/knowledge-documents`, [`03-api-contracts.md`](./03-api-contracts.md)):
  the client declares `filename`, `mimeType`, and `sizeBytes` before it has uploaded anything. The
  server checks the declared `mimeType` is exactly `application/pdf` — the only accepted declared
  MIME type for this slice — and the declared `sizeBytes` does not exceed **10485760 bytes (10
  MiB, exactly `10 * 1024 * 1024`)**. **These checks are a client-declared UX guard, not
  authoritative enforcement.** Nothing prevents a client from declaring `application/pdf` and a
  small `sizeBytes`, then uploading a different file entirely — the presigned PUT this stage
  returns authorizes writing bytes to `clinicId/documentId`, not any particular bytes. No database
  row exists after this stage; it exists only to catch an obviously-wrong file before the browser
  spends time uploading it.
- **Completion** (`POST /api/knowledge-documents/:id/complete`): once the browser's PUT to Scaleway
  finishes, the server calls **HeadObject** against `clinicId/documentId` — re-derived from the
  authenticated session and the document id, never accepted as a `storage_key` from the client.
  **The actual object `ContentLength` returned by HeadObject is the authoritative size check**
  (must be `<= 10485760`), and **the actual stored `Content-Type` is the authoritative type check**
  (must be exactly `application/pdf`). **A stored `Content-Type` of `application/pdf` proves only
  that Scaleway recorded that metadata for the object — it does not prove the bytes are actually a
  PDF.** So after those checks the server also verifies the file's signature, per
  [ADR-0021](../adr/0021-bounded-prefix-read.md): an object shorter than 8 bytes (zero bytes
  included) is rejected without any read; otherwise the server reads **at most the first 1024
  bytes** (`Range: bytes=0-1023`, a fixed constant, server-side credentials) and the object must
  begin, at byte offset 0 exactly, with `%PDF-X.Y` where `X.Y` is one of `1.0`–`1.7` or `2.0`,
  and that header must then end: the ninth byte must be absent (the object is exactly those 8
  bytes), a line feed (`0x0A`), or a carriage return (`0x0D`) — any other ninth byte is rejected.
  Rejected: `%PDF-1.8`, `%PDF-3.0`, `%PDF-X.Y`, lower-case `%pdf-`, a BOM or whitespace before the
  signature, the signature at any other offset, other file types, and any other character after
  the version — a further digit (`%PDF-1.77`, `%PDF-1.10`, `%PDF-2.00`), a space, a tab, NUL, a
  dot, a letter, a dash (`%PDF-1.7x`, `%PDF-1.7.1`, `%PDF-1.7-beta`). The read is conditioned on `If-Match` with the ETag
  HeadObject returned, so the bytes checked belong to the very object whose size and type were
  just checked. Only once everything passes does the server insert the `knowledge_documents`
  row. The 1024 bytes are never stored, logged, returned to the client, or placed in an error
  message, and nothing is parsed, extracted, or sent to any AI.
- **Failed completion inserts no row.** If HeadObject finds nothing, or the actual size or
  Content-Type fails its check, or the object is not a PDF by signature, no `knowledge_documents`
  row is ever created for that upload attempt. Outcomes: 404 (no object, including one that
  vanished before the prefix read), 422 (too large, wrong Content-Type, not a PDF), 409 with code
  `object_changed` (the object was replaced between HeadObject and the prefix read — the
  `If-Match` precondition failed; distinct from the `conflict` code of a retried completion), and
  a generic 500 if HeadObject returns no ETag (completion fails closed: it never reads without
  the precondition).
- **What the signature check does not prove.** It shows only that the object is not obviously
  some other file type. It does not prove the file is safe or well-formed — a polyglot can pass,
  and PDFs can carry active content. Any later step that reads the file's contents must treat it
  as untrusted. It also does not stop the uploader from overwriting the object **after**
  completion: the presigned PUT URL stays valid for its 300-second expiry, is not single-use, and
  the bucket has no versioning; the ETag is not persisted (that would need a schema change). A
  later slice that reads the file's contents must re-validate.
- **Production validation prerequisites (deferred).** Everything above is verified in tests
  against a faked storage client only; none of it has run against the real bucket, because
  production has no active staff identity and none will be created just to test. Before this path
  can be relied on in production, a first legitimate upload must confirm: the application's storage
  key can read objects (a read permission it may not hold today — granting it is a production
  infrastructure change that needs the Owner's explicit approval); the store honors
  `Range: bytes=0-1023`; HeadObject returns an ETag (without one every completion fails closed
  with a 500); the store honors `If-Match` on GET; the object stays private; and a rejected
  object leaves no `knowledge_documents` row.
- **Orphan objects are an accepted limitation of this slice.** If the browser's PUT to Scaleway
  succeeds but the client never calls the completion endpoint (a closed tab, a crashed browser, a
  network failure after the PUT but before completion), the object remains in the private bucket
  with no corresponding database row, indefinitely. This slice does not reconcile that: there is no
  background job, no listing of the bucket, no comparison against `knowledge_documents` rows.
  Orphan-object reconciliation is a future follow-up.

## Processing lifecycle (Processing → Ready / Failed)

```text
POST /api/knowledge-documents (initiation) -> 201 { documentId, uploadUrl, expiresAt }
  1. Validate the declared filename/mimeType/sizeBytes per the non-authoritative UX guard above.
     Reject with 400 before anything is persisted if invalid. No row created on success either.

Browser PUTs the file directly to Scaleway using uploadUrl (ADR-0018) — the application's own
process never sees these bytes.

POST /api/knowledge-documents/:id/complete
  2. HeadObject against the re-derived storage_key. 404 if missing; 422 if the actual
     ContentLength/Content-Type fails the authoritative check above (see "Upload is two
     validated stages, not one"). No row created on failure.
  2a. Bounded prefix read (ADR-0021): at most the first 1024 bytes, If-Match the HeadObject
     ETag; the object must start with %PDF-1.0 ... %PDF-1.7 or %PDF-2.0. 422 if not a PDF
     (or shorter than 8 bytes), 409 object_changed on a failed precondition, 404 if the object
     vanished, 500 if HeadObject returned no ETag. No row created on failure.
  3. INSERT knowledge_documents (status = 'processing').  ─────► 201 returned to the caller
     immediately; the route then schedules steps 4-5 with Next.js after() (ADR-0026).

After the response (processKnowledgeDocument, one document at a time per process):
  4a. Re-validate the object as it now stands: HeadObject (size <= 10 MiB, Content-Type
      application/pdf, an ETag present), then a whole-object GET conditioned on If-Match with
      that ETag and bounded by HeadObject's length, then the ADR-0021 signature check on the
      bytes actually read.
  4b. Extract the text in a worker_threads worker (PDF.js), canonicalise it (canon-1) and split
      it into chunks (ADR-0026 sections 1, 2, 4 and 5).
  4c. On success: store_knowledge_document_chunks(...) writes the whole chunk set; the document
      stays 'processing' (Owner ruling D9).
      On failure: mark_knowledge_document_failed(:id, :reason) with one closed reason code.
      Both are tenant-bound SECURITY DEFINER functions (db/migrations/0020) that act only on a
      'processing' document; a stale report (SQLSTATE 55000) is ignored, never overwritten.
  5. Generate embeddings and move the document to 'ready': the embeddings slice, not yet
     implemented (it needs an AI provider, ADR-0019).
```

**Whole-object reads (Owner ruling G1, PR D).** [ADR-0018](../adr/0018-knowledge-document-object-storage.md)
Decision 1 keeps uploads out of the Next.js process, and
[ADR-0021](../adr/0021-bounded-prefix-read.md) allows only a 1024-byte prefix read at completion,
adding that "any full-body read (extraction, download) requires its own decision".
[ADR-0026](../adr/0026-knowledge-document-text-extraction-and-chunking.md) section 3 (Accepted) is
that decision: after completion, the server reads the whole object (at most 10 MiB, bound to the
HeadObject ETag) solely to extract its text. Uploads still never pass through the server; no other
full read exists, and the bytes are never logged, persisted, returned to a client or sent to a
third party. The read needs object-read permission on the application's storage key, which is
still unverified in production (a documented gap, ruling G6).

**What processing logs.** One line per document: its id and an outcome code (`stored`, a failure
reason, `stale` or `unrecorded`) — never text, a filename, bytes, a storage key or an exception
message (Owner ruling G4). If the process stops or the outcome cannot be recorded, the document
stays `processing`; there is no automatic retry yet (ADR-0026 section 1).

The `WHERE status = 'processing'` guard on both terminal updates is what keeps status
"forward-only" (B, KnowledgeDocument aggregate invariant) true under retries: an async job that
retries after a transient failure and eventually succeeds can't accidentally move an
already-`failed` row back to `ready`, or vice versa, because by the time a delayed retry's update
runs, the row may no longer match `processing`.

## Retrieval-time storage — resolved by ADR-0008

What Stage 3 (RETRIEVE) in [`05-ai-pipeline.md`](./05-ai-pipeline.md) needs is: **given a Clinic
and a query, return the most relevant chunks of that Clinic's `Ready` KnowledgeDocuments, scoped by
`clinic_id` like every other read in this system.** That requirement is fixed here. _Where_ the
chunk/embedding representation physically lives was Open Question 3 in
[`07-open-questions.md`](./07-open-questions.md); it is now resolved by
[ADR-0008](../adr/0008-embeddings-storage.md) (Accepted): **co-located** — a `knowledge_document_chunks`
table in the same Postgres database, using the `pgvector` extension for similarity search,
`clinic_id`-scoped and RLS-protected exactly like every table in
[`01-database-schema.md`](./01-database-schema.md) — retrieval becomes an ordinary tenant-isolated
query, no second system to keep in sync or separately secure. The rejected alternative (a dedicated
vector store) and the reasoning are recorded in ADR-0008 itself, not repeated here.

This represents the retrieval-time content of a `Ready` KnowledgeDocument (chunk text plus its
embedding vector), keyed back to `knowledge_documents.id` — it is **not** a new domain entity: it
has no independent lifecycle, identity, or meaning outside the KnowledgeDocument it was derived
from (deleting the KnowledgeDocument deletes its chunks; a chunk is never referenced from anywhere
except the retrieval step). This is the same "infrastructure supporting an existing aggregate"
framing [`00-overview.md`](./00-overview.md) applies to `staff_sessions` in
[`04-auth-implementation.md`](./04-auth-implementation.md).

## What must hold, per ADR-0008

- Retrieval never returns chunks from a KnowledgeDocument whose status is not `ready` — deleting or
  re-uploading a document must make its old chunks unreachable at least as promptly as the row's
  own status changes, so a `Failed` or since-deleted document can never leak into a grounded reply.
- Retrieval is always scoped to one `clinic_id`, with the same "no cross-tenant leak, checked
  structurally, not by remembering a `WHERE` clause" bar as the rest of this platform — enforced by
  the RLS policy ADR-0008 gives `knowledge_document_chunks`, not application-side filtering.
