# 0030 — Staff keyword search over clinic documents, without an AI model

## Status

Proposed — 2026-11-13.

## Date

2026-11-13. Records the plan the Owner approved in conversation on 2026-11-13 ("موافق على خطة
البحث"), with its three decisions: keyword-only search for the pilot, a document becomes `ready`
once it is searchable, and no search index yet.

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)). This is the first
retrieval step. It calls no AI model, creates no embedding and sends no text to any external
service, so [ADR-0019](./0019-ai-provider-selection.md) does not block it. It does not close P5:
grounded automated replies remain.

## Impact

Reversible. It adds one migration (0021) that replaces one `SECURITY DEFINER` function and widens
its owner role's column grant by one column, one read-only search path in the application, and a
search box on two staff screens. It adds no table, column, index, extension, dependency or
service. It changes one sentence of an Accepted ADR
([ADR-0026](./0026-knowledge-document-text-extraction-and-chunking.md) section 7), which is why it is
recorded here before any code.

## Context

Facts this decision rests on, all on `main` at `2978fa7` unless stated:

- After upload, extraction stores one complete chunk set per document in
  `knowledge_document_chunks` (migration 0020, ADR-0026): at most 2,000 code points per chunk,
  RLS and FORCE RLS, `app_user` holds `SELECT` only. The only write paths are the two
  `SECURITY DEFINER` functions owned by `knowledge_document_processor`.
- ADR-0026 section 7 says moving a document to `ready` "belongs to the embeddings slice, because a
  document is ready only when retrieval can use it". So today a document whose text was extracted
  stays `processing` ("قيد المعالجة") for ever. Its consequences record this as a limitation the
  Owner accepted (D9).
- `knowledge_documents.status` allows `processing`, `ready` and `failed`; the row check
  `knowledge_document_status_fields_match` requires `ready_at` to be set exactly when the status is
  `ready` (migration 0013). `knowledge_document_processor` holds column `UPDATE` on `status` and
  `failed_reason` only.
- Embeddings need an AI model, and no provider is selected (ADR-0019 is Proposed; no candidate
  passes gate 1). Grounded AI replies are therefore not close.
- Staff answering a patient today have no way to look something up in the clinic's own documents
  inside the product.
- PostgreSQL 16 ships text-search configurations for `arabic`, `greek` and `english`. Checked on
  PostgreSQL 16 on 2026-11-13: `arabic` strips the definite article, diacritics and hamza forms
  (`التنظيف` matches `تنظيف`, `أسعار` matches `اسعار`) but does not join broken plurals (`سعر` does
  not match `أسعار`); `greek` folds accents and case (`Τιμη` matches `τιμή`), which `simple` does
  not; `english` stems normally.
- Measured on the same local server without an index: matching one query under all three
  configurations against 5,000 chunks of about 1,500 characters took about 3 seconds. A pilot
  clinic is expected to hold tens of documents, that is hundreds of chunks, not thousands.
  Production's speed has not been measured.

## Decision

1. **Keyword search for the pilot (Owner decision 1).** Staff search the clinic's documents with
   PostgreSQL full-text search. A chunk matches when the query matches it under any of the
   `arabic`, `greek` or `english` configurations, so a document that mixes languages is found in
   each of them. The query is parsed with `websearch_to_tsquery`, which accepts any user input
   without a syntax error. Results are ordered by the highest `ts_rank` across the three
   configurations, then by document and chunk order, and capped at 10. Search by meaning (finding
   "تبييض" when staff type "تلميع") is not part of this ADR; it needs embeddings and therefore the
   ADR-0019 decision.
2. **Only ready documents of the caller's clinic.** Search reads `knowledge_document_chunks` joined
   to `knowledge_documents`, as `app_user`, inside the caller's tenant transaction, so RLS and
   FORCE RLS decide which rows exist. It returns only chunks of documents whose status is `ready`.
   No new privilege, policy or `SECURITY DEFINER` function is added for reading.
3. **A document becomes `ready` when it is searchable (Owner decision 2).** Migration 0021 replaces
   `store_knowledge_document_chunks` so that, in the same transaction that inserts the complete
   chunk set, it sets the document's `status = 'ready'` and `ready_at = now()`. Everything else in
   the function stays as ADR-0026 section 7 defines it: the row lock, the `processing` and
   no-chunks preconditions, the whole-set validation, the `READ COMMITTED` check and the all-or-
   nothing rollback. Because the status changes under the same lock, a document can no longer hold
   a chunk set while still `processing`, and `mark_knowledge_document_failed` keeps rejecting it.
   The migration:
   - grants `knowledge_document_processor` column `UPDATE (ready_at)` on `knowledge_documents`,
     and nothing else;
   - replaces the function as its owner, using `SET LOCAL ROLE` for that statement only and then
     restoring the executing role, as [ADR-0025](./0025-migrating-role-no-inherit-on-function-owner-roles.md)
     requires, with the same pinned `search_path`, qualified names, owner and grants
     ([ADR-0024](./0024-security-definer-search-path-and-name-qualification.md));
   - moves every document that already has a chunk set and is still `processing` to `ready`, with
     `ready_at = now()`. Production holds no documents (checked 2026-10-26), so there this is
     expected to change no row; the post-check confirms it.
4. **No search index yet (Owner decision 3).** The text-search vectors are computed at query time.
   No `tsvector` column, generated column, GIN index or extension is added. Each search runs with a
   `statement_timeout` of 5 seconds set locally in its transaction, so a slow search fails cleanly
   instead of holding a connection. Adding a stored vector and an index later changes no API or
   screen. It is revisited when any clinic holds more than 1,000 chunks, when a search is seen to
   take more than 1 second in production, or when the search timeout is ever hit.
5. **Where staff search.** A search box on the knowledge-base screen (owner and admin, as today)
   and on the conversation screen (every active staff role, since receptionists answer patients).
   Each result shows the document's file name and the chunk's text exactly as stored, so what staff
   read or copy is the clinic's own text, never generated or rewritten (compatible with
   [ADR-0011](./0011-regulatory-scope-boundaries.md) E2). The labels and messages exist in Arabic,
   Greek and English ([ADR-0027](./0027-staff-ui-localization.md)); the knowledge-base status label
   for `ready` says the document is ready for search, not that the assistant uses it.
6. **The query is treated as possible patient data.** Staff may paste a patient's words into the
   box. The query is sent in a request body, never in a URL or query string, so it does not reach
   access logs. It is never logged, stored, put in an error message or sent to any external service.
   It must be 1 to 200 characters after trimming; a query that reduces to no search terms (for
   example only stop words) returns no results and says so.

## What this ADR does not decide

- **Embeddings, search by meaning and AI replies.** They wait for ADR-0019 and need their own ADR.
  The `ready` status of decision 3 means searchable by keyword; when embeddings arrive, that ADR
  decides how documents that are already `ready` get their vectors.
- **Search for patients.** Only staff search; nothing here is patient-facing.
- **Rate limiting.** Not added for the pilot; the timeout in decision 4 bounds the cost of one
  search.

## Consequences

- After 0021, a document whose text was extracted shows as ready for search instead of "قيد
  المعالجة". ADR-0026's D9 limitation ends. "Processing" again means extraction has not finished.
- Once this ADR is accepted, the pull request that adds migration 0021 also adds a note to
  ADR-0026's Status section, as ADR-0012's records ADR-0024: the last sentence of its section 7,
  and the first bullet of its Consequences, are superseded by this ADR; the rest stands.
- Search is weaker than search by meaning: it misses synonyms and Arabic broken plurals. Staff may
  need to try a second word. This is accepted for the pilot.
- Receptionists can read the text of every ready document of their own clinic through search. These
  are the clinic's own administrative documents; no other clinic's text is reachable.
- Searching works in production only after extraction works there, which still needs the production
  storage key's read permission verified (unchanged).
- No new data is stored and nothing is sent outside the database, so the privacy notice's data,
  hosting and sub-processor statements do not change; the implementation pull request checks
  `src/app/(marketing)/privacy/content.ts` and updates it only if a sentence there becomes untrue.
- Implementation is staged, each step under Gates 1-5; only the Owner merges:
  1. **This ADR**, Proposed, with its index row. No code.
  2. **Migration 0021** and its PostgreSQL tests: the function sets `ready` with its chunk set and
     rolls both back together; the ADR-0026 race and isolation tests still pass; the owner role
     gained `UPDATE (ready_at)` and nothing else; the backfill moves only documents with a chunk
     set; the ADR-0025 membership check still holds. Plus a production procedure in
     `docs/operations/` that the Owner runs from Termux, with read-only pre- and post-checks.
  3. **Search**: the search function behind the `knowledge-base` public entry point, the API route,
     both search boxes and the three dictionaries. Tests prove, against PostgreSQL with synthetic
     text only, that search never returns another clinic's chunk, never returns a chunk of a
     `processing` or `failed` document, matches across the three languages as the Context above
     describes, caps results at 10, rejects empty and over-long queries, keeps the query out of
     the URL and logs, and requires an authenticated staff session.
- Applying 0021 in production is a separate Owner step, as with 0020.

## Alternatives considered

- **Wait for embeddings and build retrieval once.** Rejected: it ties all retrieval to the AI
  provider decision, which has no date, and leaves staff with nothing in the meantime. Keyword
  search also remains useful next to embeddings later.
- **The `simple` configuration only.** One computation per chunk instead of three, but it does not
  fold Greek accents or strip the Arabic definite article, so common queries would miss.
- **A stored `tsvector` column with a GIN index now.** Faster at scale, but adds a column, an index
  and write-path changes for a clinic size the pilot will not reach. Decision 4 names when to add
  it.
- **Trigram matching (`pg_trgm`).** Tolerates typos, but needs an extension and an index to be
  usable, and ranks poorly on long chunks.
- **A new status such as `extracted` beside `ready`.** Keeps "ready" for embeddings, but changes the
  status check constraint, every screen and dictionary that shows status, and leaves staff with a
  state they cannot act on. The Owner chose to make `ready` mean searchable.
- **A separate `mark_knowledge_document_ready` function.** Leaves a window in which a document has
  a chunk set but is still `processing`, and adds a third write path; setting the status in the
  store function keeps one atomic step.
