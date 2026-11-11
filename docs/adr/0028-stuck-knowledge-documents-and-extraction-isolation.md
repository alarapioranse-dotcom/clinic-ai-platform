# 0028 — Stuck knowledge documents and extraction isolation for the pilot

## Status

Accepted — 2026-11-11. Approved by the owner in a comment on
[PR #129](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/129#issuecomment-6805258614).

## Date

2026-11-11

## Phase

P5 (knowledge base), pilot readiness. This ADR closes the review that
[ADR-0026](./0026-knowledge-document-text-extraction-and-chunking.md) section 1 (Owner ruling D6)
requires before the first real clinic is onboarded. It does not close P5.

## Impact

Reversible. It adds no table, column, migration, dependency or service, and changes no API
contract. It is recorded as an ADR because ADR-0026 reserves both questions for the Owner.

## Context

ADR-0026 runs PDF text extraction inside the web service process, in a `worker_threads` worker
with a V8 limit and a 30-second parent-enforced timeout, scheduled with `after()` when an upload is
completed. It accepts two weaknesses for the initial implementation only, and asks the Owner to
decide them before the first clinic:

1. **Isolation.** A worker thread is not a separate process. A hostile or pathological PDF can put
   memory pressure on the whole web process and, in the worst case, restart it.
2. **Stuck documents.** If the process stops while a document is being extracted, nothing resumes
   the work. The document stays `processing` for ever, and the clinic's staff see "Processing" with
   no way to know it will never finish.

Facts that bound the decision:

- A `knowledge_documents` row is created with status `processing` when the upload is completed, so
  `created_at` is the moment extraction was scheduled.
- A document whose text was extracted keeps status `processing` on purpose: `ready` belongs to the
  later embeddings slice (ADR-0026 section 7). Such a document has a chunk set.
- `mark_knowledge_document_failed` (migration 0020) moves a document to `failed` only if it is
  `processing` **and has no chunk set**, locks the row, accepts a closed set of reason codes that
  includes `extraction_timeout`, and is executable by `app_user` inside the clinic's tenant
  context. A late `store_knowledge_document_chunks` for a document that has already failed is
  refused by the database.
- Uploads are limited to PDF, 10 MB and 100 pages, by an owner or administrator of the clinic. The
  pilot is one or two design-partner clinics.
- The web service runs on a single Render instance. A separate worker service or a job queue adds
  a recurring hosting cost and a second deployable.

## Decision

### 1. Isolation: stay in-process for the pilot

Extraction keeps running in the web process as ADR-0026 describes. No separate worker process,
service or queue is added now.

This is revisited, with a new ADR, before any of the following:

- a third clinic is onboarded;
- the upload limits (10 MB, 100 pages) are raised, or a file type other than PDF is accepted;
- documents can be uploaded by anyone other than a clinic's owner or administrator;
- a production restart or out-of-memory event is attributed to extraction.

### 2. Stuck documents: fail them after 15 minutes, when the list is read

A document is **stuck** when its status is `processing`, it has no chunk set, and its `created_at`
is more than 15 minutes in the past. Fifteen minutes is thirty times the worker timeout, so a
document that is still being extracted is never treated as stuck.

When a clinic's knowledge-base list is read (`GET /api/knowledge-documents`), the service first
marks that clinic's stuck documents `failed` with the existing reason code `extraction_timeout`,
through `mark_knowledge_document_failed`, inside the clinic's tenant context. The list then shows
them as failed with the existing "took longer than allowed" message.

- No new status, reason code, column, migration, scheduler or background job.
- A failure to mark one document is logged with the document id only and does not fail the list
  request; the document stays `processing` and is tried again on the next read.
- The database, not the application, still decides: a document that gained a chunk set or left
  `processing` in the meantime is left as it is.

### 3. Recovery: upload the file again

There is no automatic retry. Staff recover a failed document by uploading the file again, which is
the same action every other failure reason already asks for. The failed row and its stored object
are kept, as today; deleting knowledge documents is a separate, unbuilt feature.

## Consequences

- Staff are never left with a document that says "Processing" for ever; within 15 minutes of
  opening the list after a lost extraction they see a failure and can upload again.
- Detection is lazy. A stuck document that nobody looks at stays `processing` in the database until
  the list is next read. Nothing downstream consumes `processing` documents without a chunk set, so
  this has no effect beyond the screen.
- `extraction_timeout` now also covers "the extraction was lost", not only "the worker ran past its
  time limit". The message shown to staff is true of both.
- The isolation weakness of ADR-0026 remains for the pilot, bounded by the upload limits, the
  trusted uploader roles and the small number of clinics, with explicit triggers for revisiting it.
- This ADR does not verify read permission for the production storage key; that operational check
  (CLAUDE.md, Status) is still required before extraction is used with a real clinic.

## Alternatives considered

- **A separate worker service or child process now.** Real isolation, but a second deployable and a
  recurring cost before there is a single clinic. Deferred with explicit triggers (decision 1).
- **A durable job queue with automatic retry.** Guarantees completion, but adds a table or a
  service, and retrying a file that crashed the process risks a crash loop. Rejected for the pilot.
- **A scheduled sweep (cron).** Detects stuck documents nobody looks at, but needs a scheduler and
  a cross-tenant actor that the tenant-isolation model deliberately does not have. Rejected.
- **A new `stuck` status or a new reason code.** More precise, but changes the schema and the
  closed reason set for a case the existing code and message describe truthfully. Rejected.
- **Leaving it as it is.** Staff cannot tell a slow extraction from a lost one. Rejected.
