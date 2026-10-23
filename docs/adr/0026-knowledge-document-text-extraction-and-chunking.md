# 0026 — Knowledge-document text extraction and chunking

## Status

Proposed

## Date

2026-10-23. Records the Owner rulings D1-D4, made after a read-only audit, and D5-D9, made after
the external architecture review of the first draft, all of 2026-10-23.

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)). This is steps 4 and 5
of the processing lifecycle in
[`docs/technical/06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md),
without embeddings: no AI provider, model, embedding or API call is involved, so
[ADR-0019](./0019-ai-provider-selection.md) does not block it.

## Impact

Reversible, but security-relevant: it adds a dependency that parses untrusted files, a new
tenant-scoped table, a new function-owner role and two new `SECURITY DEFINER` functions. It is
recorded here before any migration or dependency is added.

## Context

After P5 Slices 1A-1C, an owner or admin can upload a PDF. Completion checks its size, its stored
`Content-Type` and its first bytes ([ADR-0021](./0021-bounded-prefix-read.md)), then inserts a
`knowledge_documents` row with `status = 'processing'`. Nothing happens after that: no text is
read, and no document ever leaves `processing`.

Facts this decision rests on, all on `main` unless stated:

- `knowledge_documents` has RLS and FORCE RLS. `app_user` holds `SELECT` and `INSERT` on it, and
  no `UPDATE` or `DELETE` (migration 0014; verified in production).
- The status lifecycle is forward-only: `processing` to `ready` or `failed`, never back
  (`docs/technical/01-database-schema.md`). The knowledge-base screen labels `processing` as
  "قيد المعالجة" and shows `failed_reason` as stored.
- [ADR-0008](./0008-embeddings-storage.md) puts retrieval data in a tenant-scoped table in the same
  database (`knowledge_document_chunks`), with RLS and FORCE RLS.
- [ADR-0011](./0011-regulatory-scope-boundaries.md) E2 requires a quote to be a contiguous span of
  a clinic-authored source document, verified by exact match against the stored source.
- The signature check does not prove a file is safe or well formed, and the object can be
  overwritten for up to 300 seconds after completion (`06-knowledge-document-storage.md`, "What the
  signature check does not prove"). Any step that reads the file must treat it as untrusted and
  validate it again.
- PDF.js before 4.2.67 allowed arbitrary JavaScript execution through a crafted font when
  `isEvalSupported` is `true`, its default (CVE-2024-4367).
- There is no background-job infrastructure. The web service is a long-running Node.js server
  (`next start` on Render), where Next.js `after()` (stable since 15.1) runs work after the
  response is sent. `after()` schedules work; it is not a durable job queue.
- PostgreSQL only lets a role take a row lock (`SELECT ... FOR UPDATE`, `FOR SHARE` and their
  variants) on a table where it holds `UPDATE` on at least one column, so `app_user` cannot lock a
  `knowledge_documents` row (reproduced on PostgreSQL 16 on 2026-10-23). The lock that a foreign
  key check takes on the parent row (`FOR KEY SHARE`) does not conflict with an update of non-key
  columns such as `status`.
- `package.json` declares `"node": ">=22 <23"`. The `pdfjs-dist` 5.x and 6.x releases declare
  `"node": ">=22.13.0 || >=24"`. The demo service's build of 2026-10-23 used Node.js 22.23.4,
  selected by its `NODE_VERSION=22` environment variable; production's build runtime has not been
  read for this ADR.
- `src/lib/db.ts` opens each tenant transaction with a plain `BEGIN`, so it runs at the server's
  default isolation level; no code sets another level. PostgreSQL's default is `READ COMMITTED`,
  but production's configured default has not been read for this ADR.

## Decision

### 1. Where extraction runs (Owner rulings D1 and D6)

Extraction runs in the web service process, scheduled with `after()` from the upload completion
route once the `knowledge_documents` row is committed. The completion response is not delayed.

PDF parsing runs in a `worker_threads` worker with a configured V8 resource limit and a
parent-enforced wall-clock timeout. This keeps synchronous parsing off the main event loop, but it
is **not process-level isolation**: a worker shares the server's process, and its V8 limit does
not bound total process memory or native and external allocations. A hostile PDF can therefore
still put memory pressure on the whole process, and in the worst case the process can be
restarted, interrupting unrelated requests.

The parent handles worker errors, abnormal exits and timeouts without unhandled promise rejections.
It terminates a timed-out worker and marks the document failed with a closed reason code. A status
update that fails is an unresolved operational failure, not a completed transition.

If the process stops while a document is being extracted, the document stays `processing`. This
ADR provides no durable job delivery, automatic recovery or guaranteed completion. Under D6 this
is accepted for the initial implementation only: before the first real clinic is onboarded, the
Owner reviews whether parsing must move to a separate process or a durable job mechanism, and
decides stuck-document detection, retry and recovery separately.

### 2. PDF library and runtime (Owner rulings D2 and D8)

`pdfjs-dist` (Mozilla PDF.js, Apache-2.0) is the only PDF library added. The version:

- is not older than 4.2.67 and is pinned exactly in `package.json` and the lockfile;
- is configured with `isEvalSupported: false`, font faces disabled, text-content extraction only
  (no rendering), and is given the bytes read in section 3, never a URL;
- has no CMap, standard-font or other auxiliary resource URL configured, so no loading path can
  reach the network; tests run extraction with outbound network access denied and fail on any
  request;
- is upgraded only through a reviewed change that checks security advisories, the new version's
  declared Node.js engine range, API compatibility and the synthetic-PDF regression suite;
- is reviewed monthly, and whenever a PDF.js security advisory is published.

The supported Node.js range becomes `>=22.13 <23`, in `package.json` `engines` and in the local and
CI runtime. Before the route integration (PR D below) is merged, production's build log must show
a Node.js version in that range.

### 3. Re-validation before reading

Before parsing, the worker's caller repeats the completion checks against the object as it now
stands: HeadObject size at most 10 MiB and `Content-Type` exactly `application/pdf`, then a full
GET conditioned on `If-Match` with that ETag, stopping if more bytes arrive than HeadObject
reported, then the ADR-0021 signature check on the bytes actually read. Any failure marks the
document failed; nothing is parsed.

Missing objects, changed objects, wrong content types or signatures, limit breaches, encrypted
files and parser failures are told apart only through the closed reason codes of section 7. If the
storage provider does not honour the conditional read, extraction fails closed rather than assume
the object is unchanged. Production storage read permission and conditional-read behaviour remain
unverified until checked against the actual production configuration; this ADR authorises no
production permission change.

### 4. Limits (initial test parameters)

| Limit                  | Initial value      | On breach                                    |
| ---------------------- | ------------------ | -------------------------------------------- |
| File size              | 10 MiB (unchanged) | failed: `too_large`                          |
| Pages                  | 100                | failed: `too_many_pages`                     |
| Extracted characters   | 500,000            | failed: `too_much_text`                      |
| Worker wall-clock time | 30 seconds         | failed: `extraction_timeout`                 |
| V8 old-generation heap | 256 MiB            | failed: `extraction_error`, best effort only |
| Text found             | at least 1 letter  | failed: `no_extractable_text`                |

Encrypted PDFs fail with `encrypted`. Scanned PDFs without a text layer fail with
`no_extractable_text`: there is no OCR.

The heap value is the worker's `resourceLimits` V8 old-generation limit, not a cap on total worker
or process memory. A failure is recorded only if the parent process is still alive and the status
update succeeds; if the process is terminated, the document can remain `processing`. Limits are
enforced as early as the library allows, but checking the page count after the document is loaded
does not prevent every resource cost of loading it. These values are product limits and test
parameters, not demonstrated safety bounds; peak memory and time are measured on representative and
adversarial synthetic PDFs before PR D.

### 5. The canonical text (Owner ruling D5)

PDF.js produces a text representation of the file; that does not prove each character matches the
PDF's visual appearance. The text is normalised once, by a deterministic, versioned algorithm, and
the result is that document's **canonical text**. The algorithm applies Unicode NFKC (so that
Arabic presentation forms and ligatures become ordinary characters), normalises line endings,
keeps paragraph boundaries as one defined canonical paragraph separator, collapses repeated
horizontal whitespace within a paragraph, and trims by a defined rule at paragraph boundaries. It
never collapses a paragraph separator into an ordinary space. The exact order of these operations
and the separator are part of `canonicalization_version`; PR C fixes them in code and tests them on
the actual normalisation output.

Under D5, the canonical text is "the stored source" of ADR-0011 E2: a quote passes only if it is a
contiguous substring of the canonical text rebuilt from the stored chunks, by exact match, before it
is returned. The product must not present a quote as a literal visual transcription of the PDF.

The normalisation and chunking rules carry a version, stored with every chunk as
`canonicalization_version`, separate from `extractor_version` (the PDF.js version and options). Any
change to either is a data-contract change that needs a compatibility review; it never silently
changes the meaning of chunks already stored.

The canonical text is split into **contiguous, non-overlapping chunks that cover it exactly**:

- offsets are zero-based, half-open ranges `[char_start, char_end)` counted in Unicode code points
  of the canonical text (not UTF-16 code units or bytes), the same unit as PostgreSQL's `length()`
  on `text`, and the implementation uses that unit everywhere;
- ordinals start at 0 and are contiguous; the first chunk starts at 0; each later chunk starts where
  the previous one ends; the last ends at the canonical text's length; no chunk is empty;
- each chunk's `content` is exactly its range, so concatenating the chunks in ordinal order
  reproduces the canonical text with no gap, overlap, separator or missing character;
- chunks break at paragraph, then sentence boundaries, with a target of about 1,500 and a hard
  maximum of 2,000 code points (proposed values); a paragraph or sentence longer than the maximum
  is split at a deterministic code-point boundary, so no chunk ever exceeds it.

Overlap between chunks, if retrieval needs it, is added when reading, never stored.

### 6. Storage: `knowledge_document_chunks`

One new table, in one migration (0020), with:

- `id`, `clinic_id NOT NULL`, `document_id`, `ordinal`, `content`, `char_start`, `char_end`,
  `extractor_version`, `canonicalization_version`, `created_at`;
- row checks: `ordinal >= 0`, `char_start >= 0`, `char_end > char_start`, and
  `char_end - char_start = length(content)`;
- `UNIQUE (document_id, ordinal)`, and a composite foreign key `(document_id, clinic_id)` to
  `knowledge_documents (id, clinic_id)` with `ON DELETE CASCADE`, which needs a new unique
  constraint on those two columns of `knowledge_documents`, so a chunk can never point at another
  clinic's document;
- RLS and FORCE RLS with the same `tenant_isolation` policy as every tenant-scoped table
  ([ADR-0006](./0006-rls-tenant-context-propagation.md));
- **no embedding column**: the vector column and its dimension depend on the model, so they are
  added by a later migration once ADR-0019 selects a provider.

Under D7, `app_user` gets `SELECT` on the table and nothing else: chunks are written only by the
function in section 7. Row checks cannot express continuity across rows; that rule is enforced by
that function, inside the transaction that writes the set.

### 7. Writes go through tenant-bound functions (Owner rulings D3 and D7)

`app_user` keeps no `UPDATE` on `knowledge_documents` and gets no write on
`knowledge_document_chunks`. Two `SECURITY DEFINER` functions, in the
[ADR-0022](./0022-clinic-settings-writes-through-tenant-bound-function.md) and
[ADR-0024](./0024-security-definer-search-path-and-name-qualification.md) pattern, are the only
write paths. Both derive the clinic only from `app.current_clinic_id`, fail closed when that
context is absent, and act only on a document of that clinic:

- **Store the chunk set.** It takes the document id, the extractor and canonicalization version
  strings, the complete canonical text and the complete proposed chunk set. It locks the document
  row (`SELECT ... FOR UPDATE`), requires `status = 'processing'` and no existing chunks, and
  validates the text and the set as one unit: it rejects an empty canonical text or an empty set;
  it checks that ordinals and offsets are contiguous, that the first offset is 0 and the last equals
  the canonical text's length, that no chunk exceeds the maximum, and that every chunk's `content`
  equals the matching half-open range of the supplied canonical text, using PostgreSQL text
  functions, which count code points as section 5 does. It inserts all chunks in one statement.
  Any validation or insertion error raises and rolls back every row the call wrote; nothing partial
  survives, so a document has one complete chunk set or none, and tests prove that rollback. The
  canonical text itself is not stored; it is rebuilt from the committed chunks. The function does
  not change the document's status.
- **Mark failed.** It takes the document id and a reason code. It locks the same row, requires that
  the document is still `processing` and has no chunk set, and only then sets `status = 'failed'`
  and `failed_reason`. The reason must be one of `too_large`, `too_many_pages`, `too_much_text`,
  `extraction_timeout`, `extraction_error`, `no_extractable_text`, `encrypted`, `object_missing`,
  `object_changed` or `not_a_pdf`; no exception message or file-derived text is ever stored. A
  failure rejected because chunks already exist is a stale or conflicting report: the caller treats
  it as such and never overwrites the committed result.

Both functions lock the same document row, so they serialize and the outcome is deterministic: if a
failure commits first, a later store call rejects the document because it is no longer
`processing`; if a chunk set commits first, a later failure call rejects it because chunks exist. A
document with a complete chunk set therefore cannot become `failed` through these functions, for
example from a duplicate schedule or a delayed timeout. Moving a document to `ready` is not part of
this ADR; it belongs to the embeddings slice, because a document is ready only when retrieval can
use it.

This guarantee holds under `READ COMMITTED`, where each statement after the lock sees rows
committed by the transaction that held it. Under `REPEATABLE READ` or `SERIALIZABLE`, a transaction
that waited for the lock still reads from its older snapshot and could miss a chunk set committed
meanwhile, because the store function does not update the document row. Both functions therefore
check `transaction_isolation` and fail closed unless it is `read committed`, so correctness never
rests on an assumed server default; tests run both race orders at `READ COMMITTED` and prove the
functions refuse to run at the other levels.

Both functions are owned by one dedicated `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS` role holding
only the combined privileges these two functions require: `SELECT` and column-level `UPDATE` of
`status` and `failed_reason` on `knowledge_documents` (the column grant is also what allows the row
lock), and `SELECT` and `INSERT` on `knowledge_document_chunks`. Each function therefore runs with
the union of both functions' privileges, not the minimum it needs alone; neither `app_user` nor
`PUBLIC` gains any write through this role. The functions pin
`search_path = pg_catalog, public, pg_temp`, qualify every name, have `EXECUTE` revoked from
`PUBLIC` and granted to `app_user` only, and the migrating role keeps `SET` but not `INHERIT` on
the new owner role, with the fail-closed check of
[ADR-0025](./0025-migrating-role-no-inherit-on-function-owner-roles.md) extended to cover it. Tests
verify the role's actual attributes, its effective grants and every membership in it, not only its
name. `SECURITY DEFINER` does not bypass RLS: the owner role has no `BYPASSRLS`, so FORCE RLS
still applies inside both functions. Tests run both functions as the real owner role, under a real
tenant context, and prove that neither can read, lock, chunk or fail another clinic's document;
checking the role's `NOBYPASSRLS` attribute alone is not enough.

### 8. What is never done

No extracted text, filename, file byte or raw parser exception is logged, returned in an error, or
sent to any external service. Nothing in this ADR calls an AI model or creates embeddings. Text is
extracted for the clinic that uploaded the file and is readable only under that clinic's tenant
context.

## Consequences

- Under D9 no status is added. After extraction succeeds, a document stays `processing` until the
  embeddings slice completes the retrieval-ready pipeline; "قيد المعالجة" then means the document
  is not yet usable by the assistant, not that a parser is running. The screen never shows a
  success state or implies the document is searchable. This is a documented limitation the Owner
  has accepted.
- The route integration PR replaces the raw `failed_reason` code on the knowledge-base screen with
  an Arabic message per reason code (D9).
- Implementation is staged behind this ADR, each step under Gates 1-5 with its own Owner approval;
  only the Owner merges:
  1. **PR A — this ADR only**, status Proposed, plus its index row. No migration, dependency,
     application code, configuration or test change.
  2. **PR B — migration 0020**: the table, the owner role, both functions and the ADR-0025 check,
     with PostgreSQL tests. No application code.
  3. **PR C — extraction and chunking module**: the pinned `pdfjs-dist` dependency, the Node.js
     engine range, the worker and the chunker, with synthetic-PDF tests; not wired to any route.
  4. **PR D — route integration**: `after()` from the completion route, the status transitions and
     the Arabic failure messages.
- Applying 0020 to production, checking production's Node.js version, and any production storage
  permission change are each separate Owner-approved steps. Reading whole objects needs the
  production storage key to hold object read permission, already an unverified production
  prerequisite of Slice 1B. The demo environment has no storage bucket, so this path cannot run
  there without a separate decision; its absence is never a reason to test against production.
  Integration tests use synthetic data and a test storage double that models the conditional-read
  behaviour explicitly.
- Tests must prove, against PostgreSQL and with synthetic PDFs only:
  - RLS isolation of chunks, and no chunk for another clinic's document;
  - `app_user` cannot insert, update or delete chunks, or update or delete documents, directly;
  - `PUBLIC` cannot execute either function, and both fail without tenant context;
  - the store function rejects a non-`processing` document, an existing chunk set, an empty
    canonical text, an empty set, gaps, overlaps, a wrong first offset, a last offset that differs
    from the canonical text's length, non-contiguous ordinals, empty chunks, a chunk over 2,000 code
    points, and a chunk whose content differs from the supplied canonical text although its lengths
    and offsets are valid;
  - the failure function rejects unknown reason codes, a document that already has a chunk set,
    and any row that is not its own clinic's `processing` document;
  - a chunk write and a failure racing on one document serialize in both lock orders, and a delayed
    failure call after a complete chunk set has committed is rejected;
  - chunks rebuild the canonical text exactly, and valid text containing characters outside the
    Basic Multilingual Plane is accepted, with the same code-point offsets in PostgreSQL and in
    application code;
  - the normaliser's actual output, including paragraph separators and over-long paragraphs and
    sentences, matches the versioned rules, rather than chunks merely reproducing themselves;
  - every limit fails the document with its code, and a worker error, an abnormal exit and a
    timeout are each classified;
  - every expected storage, parser, worker and limit failure at the route boundary maps to one
    closed reason code, with no exception text in the stored reason or the response;
  - a failure that was recorded is distinguished from an attempt to record one that failed: when
    the database is unavailable, the document stays `processing` and nothing claims otherwise;
  - an object replaced after completion fails with `object_changed`, as modelled by the storage
    double;
  - extraction with outbound network access denied makes no request, including for a PDF that
    embeds a link or needs a font or CMap that is not bundled;
  - fixtures cover English, Greek and Arabic text, mixed Arabic and Latin, Arabic presentation
    forms and combining marks, scanned, encrypted, malformed, empty, oversized, many-page, and
    small-file-high-text cases.
- Extraction quality for Arabic and Greek PDFs is a known risk (glyph order and shaping in
  right-to-left text); it is measured in PR C, not assumed. These tests establish known limits and
  catch regressions; they do not prove perfect extraction.

## Alternatives considered

- **Extract inside the completion request.** Simplest, but makes the browser wait on parsing and
  ties the request's lifetime to an untrusted file. Rejected (D1).
- **A separate Render background worker with durable job delivery and recovery.** A separate
  process gives stronger isolation from the web server; surviving restarts additionally needs
  durable job delivery, persisted job state and recovery logic, since a worker holding a job only in
  memory loses it when it restarts. It adds infrastructure and operational work before any clinic
  exists. Deferred, not rejected: before the first real clinic, the Owner reviews whether this
  isolation and recovery model is required (D6).
- **`unpdf`, `pdf-parse`.** Both wrap PDF.js, so a PDF.js security fix reaches this product only
  after the wrapper releases it; `pdf-parse` 2.x (2.4.5 on 2026-10-23) pins its own `pdfjs-dist`
  version and adds a native canvas dependency that text extraction does not need. Rejected (D2).
- **A column-scoped `UPDATE` grant to `app_user`.** RLS would still isolate it, since
  `knowledge_documents` has FORCE RLS, but the database would not enforce the forward-only status
  rule or the closed reason set, and `app_user` would gain a write it does not have today.
  Rejected (D3).
- **`INSERT` on chunks for `app_user`, guarded by a trigger.** An ordinary trigger runs as
  `app_user`, which cannot lock the document row, and the foreign key's own lock does not conflict
  with a status update, so the "only while `processing`" check would race with a failure. Making
  the trigger `SECURITY DEFINER` fixes the race but still checks one row at a time and cannot
  enforce continuity of the whole set. Rejected in favour of one store function (D7).
- **A new `extracted` status.** It would describe the intermediate state precisely, but changes the
  schema, the transition rules and the screen for a state the existing label can describe honestly.
  Rejected (D9).
- **A separate table holding each document's full text.** Duplicates what the chunks already
  rebuild exactly. Rejected in favour of contiguous chunks.
- **Overlapping chunks.** Common for retrieval, but overlap breaks exact reconstruction. Rejected
  for storage; overlap can be applied at read time.
- **OCR for scanned PDFs.** Adds a heavy dependency and a new class of extraction errors in
  clinic-authored quotes. Out of scope; a scanned file fails with `no_extractable_text`.
