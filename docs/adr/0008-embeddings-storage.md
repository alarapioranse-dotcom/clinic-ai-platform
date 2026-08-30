# 0008 — Embeddings storage

## Status

Proposed

## Date

2026-08-30

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — migrating a production
knowledge base's embeddings from one storage architecture to another later means re-embedding and
re-validating retrieval quality for every live clinic simultaneously, not a schema migration.

## Context

[`docs/technical/06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md)
fixes what Stage 3 (RETRIEVE) of [`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md)
needs — given a Clinic and a query, the most relevant chunks of that Clinic's `Ready`
KnowledgeDocuments, scoped by `clinic_id` — without deciding where that chunk/embedding
representation physically lives. [`docs/technical/07-open-questions.md`](../technical/07-open-questions.md)
(Open Question 3) named this as one-way-door: the two candidates carry meaningfully different
isolation guarantees, and a dedicated vector store is very likely a separate vendor/service with
its own hosting region, doubling the data-residency surface
[issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7) may eventually
need to resolve. This ADR resolves the storage-architecture choice; it does not touch issue #7.

## Decision

**pgvector inside the existing PostgreSQL database.** Embedding rows live in the same database as
every table in [`docs/technical/01-database-schema.md`](../technical/01-database-schema.md), using
the `pgvector` extension for similarity search.

Embedding rows are **tenant-scoped**: a `clinic_id` column, `NOT NULL`, and the same Row Level
Security policy shape given to every tenant-scoped table in
[`docs/technical/01-database-schema.md`](../technical/01-database-schema.md) — `ENABLE ROW LEVEL
SECURITY`, `FORCE ROW LEVEL SECURITY`, and a `tenant_isolation` policy keyed on
`current_setting('app.current_clinic_id', true)`, per the mechanism [ADR-0006](./0006-rls-tenant-context-propagation.md)
fixes. Retrieval becomes an ordinary tenant-isolated query, not a second isolation mechanism to
build, secure, and test separately from the rest of this platform.

## Consequences

- The embeddings table joins the same coverage
  [`docs/technical/02-tenant-isolation-testing.md`](../technical/02-tenant-isolation-testing.md)
  already requires of every tenant-scoped table — no separate isolation-testing story is needed
  for retrieval data.
- No second vendor relationship, and no second data-residency question distinct from the one the
  primary database already carries (see
  [`docs/technical/00-overview.md`](../technical/00-overview.md)'s stated assumption and
  [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7)) — embeddings
  reside wherever the primary Postgres instance resides, by construction.
- Operationally simpler: one database to run, back up, and restore, rather than two systems that
  must be kept consistent with each other (e.g., a `knowledge_documents` row deletion needing to
  reach a second store reliably).
- Retrieval performance and scaling headroom are bounded by what pgvector supports inside this
  product's expected per-clinic knowledge-base size (services, pricing, hours, policies, per
  [`docs/01-project-plan.md`](../01-project-plan.md)) — adequate at that scale, but this decision
  would need revisiting, by a superseding ADR, if a clinic's knowledge base grows far beyond that
  scope.
- [`docs/technical/06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md)'s
  "requirement, not a decided architecture" framing for retrieval-time storage is now resolved by
  this ADR; the requirements it states (never return chunks from a non-`ready` document; always
  scoped to one `clinic_id`) are unchanged and are exactly what the RLS policy above enforces.

## Alternatives considered

- **Dedicated vector database.** Rejected: isolation there would depend entirely on that service's
  own `clinic_id`-filtering being applied correctly on every query — re-creating, in a second
  system, precisely the "remembering to add `WHERE clinic_id = ...` everywhere, forever" failure
  mode [ADR-0003](./0003-multi-tenancy-model.md) was written to remove from the primary database.
  It would also add a second vendor relationship and a second data-residency question on top of the
  one this product already carries, for retrieval-performance headroom this product's expected
  per-clinic knowledge-base size does not currently need.
