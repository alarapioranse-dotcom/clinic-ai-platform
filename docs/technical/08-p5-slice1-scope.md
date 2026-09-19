# P5 Slice 1 — Scope Investigation (Knowledge Document Model Reconciliation)

Read-only design investigation. Written after PR #65 was closed without merging: that PR
implemented `knowledge_documents` as `title` + `content` + `updated_at`, with edit-in-place and a
`DELETE` grant. The architect rejected all three — that model is not revived here.

This document answers one question: **what is the smallest P5 Slice 1 that establishes the
DOCUMENTED `knowledge_documents` model (file-upload record, per
[`01-database-schema.md`](./01-database-schema.md)) without prematurely building the downstream
extraction/chunking/embedding pipeline?**

No code, migration, or ADR is proposed or written here. Nothing in this document changes any
ADR's Status.

## 1. What `06-knowledge-document-storage.md` actually specifies

Quoting directly, three separate things are named, and only two of the three are decided:

**Raw file storage — a vendor/region decision that is explicitly left open:**

> "Uploaded files (the PDF/DOCX/etc. a clinic uploads) are stored in an S3-compatible object
> store, one object per `knowledge_documents.storage_key`... **Bucket/region is left unspecified
> here**, per the data-residency assumption in `00-overview.md` — whichever region is chosen must
> satisfy 'data resides in the EU' (charter §7) as currently assumed... This document does not
> commit to a vendor or region for that reason."

**Processing lifecycle (extract → chunk → embed) — explicitly the "downstream pipeline" this
investigation was told not to build:**

> "4. Extract text content from the file. 5. Split into retrieval-sized chunks and generate
> embeddings for each... 6. On success: UPDATE knowledge_documents SET status = 'ready'..."

**Retrieval-time (embeddings) storage — presented in this document as undecided, but that
framing is stale.** The document still reads:

> "Neither is chosen here. Whichever the underlying storage, this represents the retrieval-time
> content of a `Ready` KnowledgeDocument..."

and frames it as "Open Question 3" between a co-located `pgvector` table and a dedicated vector
store. **This is a documentation/reality contradiction** — see §6 below. [ADR-0008](../adr/0008-embeddings-storage.md)
(Accepted, 2026-08-30) already resolved this in favor of co-located `pgvector`, tenant-scoped with
the same RLS shape as every other table. `06-knowledge-document-storage.md` was never updated to
reflect that, and still describes the choice as open.

So, of the three things this document covers, only the **raw file storage vendor/region** remains
genuinely, currently undecided.

## 2. What the API contract requires

[`03-api-contracts.md`](./03-api-contracts.md)'s Knowledge base section defines four endpoints as
one group, all restricted to `owner`/`admin`:

| Method | Path | What it requires to exist |
| --- | --- | --- |
| `GET /api/knowledge-documents` | List with status | Rows with real `status` values — meaningless against an empty table with no ingestion path. |
| `POST /api/knowledge-documents` | Multipart upload | Pre-upload validation, **an actual object-store write** to get a `storage_key`, then "creates a `processing` row and enqueues the pipeline in `06-knowledge-document-storage.md`" — the contract wires this endpoint directly to the very pipeline this investigation was told not to build. |
| `GET /api/knowledge-documents/:id` | Current `status`/`failedReason` | Only meaningful once a row can reach `ready` or `failed`, i.e. once the pipeline runs. |
| `DELETE /api/knowledge-documents/:id` | Removes document + retrieval representation | Requires deleting a real object in the object store — same storage-vendor dependency as `POST`. |

Every one of the four endpoints depends, directly or indirectly, on the raw-file storage mechanism
existing. `POST` and `DELETE` need it to do real object-store I/O. `GET` (list and by-id) are only
non-trivial once at least one row exists, which requires `POST` to have run.

## 3. What a clinic can actually DO in Slice 1 without an upload mechanism

Concretely: **nothing meaningful.**

- A migration alone (a `knowledge_documents` table matching the documented DDL, with its two
  `CHECK` constraints and RLS policy) is real, reviewable work, and would bring the schema in line
  with `01-database-schema.md` for the first time. But it is invisible to a clinic — there is no
  way to put a row into the table without the API, and no useful way to expose the API without a
  place to actually store the uploaded file.
- Read-only endpoints (`GET` list, `GET :id`) could technically be built against an always-empty
  table. That satisfies "smallest" in the most literal sense, but it is not a P5 Slice 1 in any
  product sense — a clinic staff member opening `/dashboard/knowledge-base` would see a permanently
  empty list with no way to add anything to it. That is not "maintaining a knowledge base"; it is
  dead UI.
- The one endpoint that would make the feature real — `POST` — cannot be implemented against the
  documented model without picking an object-store vendor and a region, because `storage_key` has
  to point at something that actually exists. There is no way to "fake" this at the Slice-1 level
  the way, say, an in-memory stub could fake an AI provider behind an interface: the schema itself
  (`storage_key text NOT NULL`, `size_bytes bigint NOT NULL`) commits to a real uploaded file
  existing before a row is valid, and the whole point of this exercise is to build to the
  *documented* model, not a placeholder shape.

## 4. Does the storage mechanism require a decision that has never been made?

**Yes — precisely and only this one:** which S3-compatible object storage provider, and which
EU/EEA region/bucket, holds the raw uploaded files behind `knowledge_documents.storage_key`.

This is distinct from, and not resolved by, either of the two ADRs that look adjacent to it:

- **[ADR-0008](../adr/0008-embeddings-storage.md)** resolved *retrieval-time* (chunk/embedding)
  storage only — co-located `pgvector`. It says nothing about where the original uploaded
  PDF/DOCX file itself lives. `06-knowledge-document-storage.md` treats these as two separate
  storage questions ("Raw file storage" vs. "Retrieval-time storage" are two different sections),
  and only one of the two has an ADR.
- **[ADR-0009](../adr/0009-data-residency.md)** (Accepted, resolves issue #7) fixes the
  *constraint* any storage decision must satisfy — EU/EEA only, no sub-processor outside the EEA
  without a DPA — and its Decision §3 scope list explicitly names "primary Postgres, replicas and
  backups, pgvector embeddings, conversation transcripts, audit logs, application and error logs,
  monitoring, and AI inference calls." **It does not name object storage for raw knowledge-document
  files.** ADR-0009 tells us what any answer must satisfy; it does not supply the answer, and the
  raw-file object store isn't even literally in its enumerated scope, only covered by the more
  general charter §7 EU-residency assumption `06-knowledge-document-storage.md` cites independently.

So the gap is real and specific: **no ADR has picked a raw-file object storage vendor + region.**
`06-knowledge-document-storage.md` says so about itself ("This document does not commit to a
vendor or region for that reason") and nothing written since (ADR-0008, ADR-0009, or the API
contract) closes that gap.

## 5. Conclusion: no Slice 1 exists that is both meaningful and buildable today

Per the charter's ADR Policy (§10) and this repository's hard rule — "A one-way-door decision gets
its own ADR, with Ahmed's approval, before code" — the raw-file object storage vendor/region choice
fits the same profile as ADR-0007 (AI provider) and ADR-0008 (embeddings storage): switching
vendors after clinics have uploaded real files means migrating real file bytes across providers
and re-validating data-residency posture, not a config change. It should get an ADR of its own
before any upload-capable code is written, on the same footing as those two.

That means:

- A **schema-only Slice 1** (the migration, matching `01-database-schema.md` exactly, with RLS)
  is buildable today, with no open decisions blocking it. But per §3 above, it demonstrates
  nothing a clinic can use and isn't a meaningful product slice on its own.
- A **Slice 1 that includes the `POST` upload endpoint** — the only endpoint that would make the
  feature real — **cannot** be built today without first deciding the object-storage
  vendor/region, because the documented schema requires a real `storage_key` for every row.

This is the outcome the architect's instructions anticipated as valid: **the P5 acceptance
criterion ("each clinic can maintain its own knowledge base") cannot be meaningfully demonstrated
with the documented file-record model without implementing an upload/storage mechanism, and that
mechanism requires a decision — vendor + EU/EEA region for raw file object storage — that has never
been made.** This is surfaced as a Slice 1 scope question, not solved by changing the domain model
(PR #65's approach, already rejected) and not solved by this document inventing a storage answer.

## 6. Every decision that must be made before implementation

| # | Decision | Needs an ADR? | Status |
| --- | --- | --- | --- |
| 1 | Raw-file object storage vendor + EU/EEA bucket/region for `knowledge_documents.storage_key` | **Yes** — one-way door, same profile as ADR-0007/ADR-0008 | **Not made. Blocking.** |
| 2 | Retrieval-time (chunk/embedding) storage architecture | Already has one | Resolved — [ADR-0008](../adr/0008-embeddings-storage.md), Accepted |
| 3 | Data residency / governing privacy regime | Already has one | Resolved — [ADR-0009](../adr/0009-data-residency.md), Accepted |
| 4 | AI/LLM provider for the extraction/embedding step of the processing pipeline | Already has one | Resolved — [ADR-0007](../adr/0007-ai-provider-constraints.md), Accepted |
| 5 | Pre-upload validation rules (accepted file types, max size) | No — this is an implementation detail within the already-fixed contract ("B's pre-upload validation branches"), not a one-way door | Undecided but not blocking Slice 1 scoping; would be decided alongside the `POST` handler once decision #1 is made |

Only decision #1 blocks Slice 1. Decisions #2–#4 are already resolved and don't need re-litigating
here. Decision #5 is ordinary implementation work, not an ADR-worthy choice.

## 7. Contradictions found in the docs

**`06-knowledge-document-storage.md` §"Retrieval-time storage" is stale relative to ADR-0008.**
The document still presents the co-located-vs-dedicated-vector-store choice as open ("Neither is
chosen here... Open Question 3... between two candidate architectures"), and
[`07-open-questions.md`](./07-open-questions.md) itself correctly shows Open Question 3 as
"Resolved by ADR-0008" at the top of that section, while the body text underneath it is unchanged
from before the ADR existed. `06-knowledge-document-storage.md` was never updated when ADR-0008
was accepted (2026-08-30) to say the choice is now decided. This doesn't block Slice 1 — the
practical answer (pgvector, tenant-scoped) is available from ADR-0008 directly — but it is a
documentation inconsistency worth fixing in a follow-up (not this investigation's job, since fixing
prose in that file is a small doc edit, not part of this read-only scope question).

**`CLAUDE.md`'s Status section is stale relative to the repository's actual state.** It reads "P3-A,
P3-B and P3-C are complete and merged on main... Next: P4 — Appointments," but `db/migrations/`
already contains `0011_appointments.sql` and `0012_clinic_timezone.sql`, `src/app/api/appointments`
and `src/features/appointments` already exist, and ADR-0014 through ADR-0017 (all
appointment/scheduling-related) are Accepted. The repository state — and this very task, which
opens with "P5 SLICE 1" — indicates P4 is substantially done and P5 is the active phase, which
`CLAUDE.md` does not yet reflect. Flagged for visibility; not corrected here, since editing
`CLAUDE.md`'s Status section is outside this investigation's read-only scope.

No other contradiction was found between `01-database-schema.md`, `03-api-contracts.md`,
`06-knowledge-document-storage.md`, `07-open-questions.md`, ADR-0008, and ADR-0009 — the documented
`knowledge_documents` model (file-upload record, no `title`/`content`, forward-only status,
"a corrected file is a new upload") is consistent across all of them, and is the model this
document treats as authoritative and in force.
