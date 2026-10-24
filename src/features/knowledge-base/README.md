# knowledge-base

Will own each clinic's knowledge source — services, pricing, hours, and
policies — used to ground automated replies to patients.

## Current scope (P5 Slices 1A–1C: persistence, upload, and the staff screens)

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
  only inserts the row once the actual `ContentLength`/`Content-Type` pass and
  a bounded read of at most 1024 bytes shows a valid PDF header (ADR-0021) —
  this is the one legitimate INSERT path Slice 1A deferred.
- `KNOWLEDGE_BASE_MANAGER_ROLES` / `toKnowledgeDocumentSummary` (Slice 1C) —
  the owner/admin role list shared by `GET /api/knowledge-documents` and the
  `/dashboard/knowledge-base` screens, and the list item shape without
  `storageKey`, `clinicId` or `uploadedBy`.

## Text extraction and chunking (ADR-0026, PR C — not wired yet)

`./extraction/` turns a PDF's bytes into the document's canonical text and its
chunks. It is **not called by any route yet** (that is PR D, which also adds the
storage re-validation read) and touches no database or storage.

- `extract.ts` — `extractKnowledgeDocumentText(bytes)` runs PDF.js
  (`pdfjs-dist`, pinned exactly) in a `worker_threads` worker with a V8
  old-generation heap limit and a wall-clock timeout, then canonicalises and
  chunks the text. The result is the canonical text, its chunks and the two
  version strings, or one closed failure reason (`too_large`,
  `too_many_pages`, `too_much_text`, `extraction_timeout`, `extraction_error`,
  `no_extractable_text`, `encrypted`). No exception message or file text is
  ever returned or logged. The worker is **not** process isolation: a hostile
  file can still put the whole process under memory pressure (ADR-0026
  section 1).
- `pdf-worker.mjs` — the only file that loads PDF.js. It blocks every network
  module and `fetch`, refuses to load the optional native `@napi-rs/canvas`
  package (PDF.js only wants it for rendering), and silences console output.
  Every encrypted PDF fails, including one that opens without a password.
- `canonicalize.ts` — the versioned `canon-1` rules (the canonical text is the
  stored source of ADR-0011 E2).
- `chunker.ts` — contiguous chunks that rebuild the canonical text exactly; the
  database derives the offsets (`store_knowledge_document_chunks`).

Known limitations (recorded, not hidden):

- **Arabic from word processors does not extract verbatim** (Owner ruling F7).
  In the synthetic LibreOffice fixture, lam-alef comes out as alef-lam
  ("االثنين" for "الاثنين") and tanween moves; poppler shows the same lam-alef
  defect, so part of it is in how such PDFs map glyphs to text. Greek and
  English in the same file are intact, and Arabic written with presentation
  forms extracts correctly. Quotes stay safe under E2 (they are matched
  against the stored text), but Arabic quotes can carry these defects.
- **Paragraphs come only from pages and empty lines.** PDF.js does not emit an
  empty line for vertical spacing, so in practice each page is one paragraph
  and chunks break mostly at sentences. Detecting paragraphs from layout would
  be a new canonicalisation version.
- A worker heap limit far too small to start a V8 isolate aborts the whole
  process, so the module refuses any limit below 16 MiB.

**Not yet implemented** (a later slice, not this one):

- Any route that runs extraction, or the storage re-validation read (PR D).
- Moving a document to `ready`, embeddings, pgvector, or any AI/retrieval code.
- Delete/download operations on `knowledge_documents`.
- Orphan-object reconciliation (an object uploaded but never completed is an
  accepted limitation of this slice, not a bug — see
  `docs/technical/06-knowledge-document-storage.md`).
- A single-document GET route (the list route covers the Slice 1C screens).

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
