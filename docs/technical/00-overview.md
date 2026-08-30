# Deliverable C — Technical Design

## What this covers

Deliverable C answers, for each of the five things
[Deliverable B](../domain/00-overview.md) named and deferred: _how_ the domain model is realized.
Concretely, this deliverable is the seven files in this directory:

- [`01-database-schema.md`](./01-database-schema.md) — illustrative DDL: tables, columns,
  constraints, and how each of B's invariants is enforced (constraint, trigger, transaction, or
  RLS policy).
- [`02-tenant-isolation-testing.md`](./02-tenant-isolation-testing.md) — an illustrative test that
  fails if a tenant-isolation RLS policy is removed.
- [`03-api-contracts.md`](./03-api-contracts.md) — endpoints, request/response shapes, status
  codes.
- [`04-auth-implementation.md`](./04-auth-implementation.md) — sessions, password hashing, role
  enforcement, invitation acceptance.
- [`05-ai-pipeline.md`](./05-ai-pipeline.md) — retrieval, grounding, escalation triggers,
  generation, behind a provider-agnostic interface.
- [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) — file storage,
  processing lifecycle, retrieval storage requirements.
- [`07-open-questions.md`](./07-open-questions.md) — one-way-door choices this design work
  surfaced, for Ahmed's decision per [charter §10](../governance/project-charter.md).

This is documentation only. Nothing under `src/`, no migration files, no dependency or
configuration changes.

## What this does not do

- **It does not re-decide anything Deliverable B or an Accepted ADR already settled.** Where B
  states an invariant ("no double-booking," "Conversation always has ≥1 message," "a StaffMember
  has exactly one Role"), this deliverable says how that invariant is enforced, never whether it
  holds. [ADR-0003](../adr/0003-multi-tenancy-model.md) (multi-tenancy: shared database,
  `clinic_id`, Row Level Security) and [ADR-0004](../adr/0004-staff-role-model.md) (four staff
  roles) are both **Accepted** as of this writing and are treated as fixed inputs throughout.
- **It does not decide data residency.** See "Stated assumptions" below.
- **It does not silently decide a one-way-door choice this design work surfaces.** Three came up
  while writing this deliverable — the mechanism by which a request's `clinic_id` reaches
  PostgreSQL for Row Level Security to key on, the AI provider behind the pipeline's interface,
  and where Knowledge Document embeddings are stored. Per
  [charter §10](../governance/project-charter.md), none of these is decided here; each is written
  up in [`07-open-questions.md`](./07-open-questions.md) with candidate options, for Ahmed's
  decision and its own ADR before the roadmap phase that needs it (P1/P2/P5 respectively).
- **It invents no entity absent from `docs/domain/`.** Every table in
  [`01-database-schema.md`](./01-database-schema.md) maps to exactly one entity in
  [`docs/domain/01-entities.md`](../domain/01-entities.md); B's value objects
  ([`03-value-objects.md`](../domain/03-value-objects.md)) become columns or embedded types, never
  their own tables. Two exceptions are addressed explicitly, not silently: auth needs some
  persisted session/credential structure, and Knowledge Document retrieval needs some persisted
  representation of a document's content for similarity search. Neither is a new *domain* entity —
  B's own overview names "Authentication implementation (sessions, tokens, password hashing)" and
  "Storage details for Knowledge Documents (file storage, embeddings)" as exactly what it defers to
  C. They are infrastructure detail supporting an existing aggregate (StaffMember's sign-in;
  KnowledgeDocument's Ready-state content), not a new thing a user flow requires. They're
  introduced in [`04-auth-implementation.md`](./04-auth-implementation.md) and
  [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) respectively, flagged as
  such where they appear.

## Stated assumptions

**Data resides in the EU, and GDPR is the sole governing privacy regime.** This is not decided by
this deliverable — it restates [charter §7](../governance/project-charter.md) ("Data resides in
the EU") and the assumption [ADR-0005](../adr/0005-patient-erasure-strategy.md) already states
explicitly ("This ADR assumes GDPR is the sole governing privacy regime... It does NOT cover
jurisdictions with mandatory minimum health-data retention or data localisation requirements").

[Issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7) tracks whether
that assumption continues to hold once the roadmap reaches Gulf markets, and is explicitly **open
and blocking P2, not this deliverable**. Nothing in Deliverable C commits to a specific cloud
region or provider for that reason: [`01-database-schema.md`](./01-database-schema.md) and
[`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) describe storage
requirements generically (a Postgres instance; an object store) and leave the concrete region/
vendor unspecified pending issue #7's resolution, rather than assuming a value that issue #7 might
later invalidate.

## Enforcement approach, in one sentence per mechanism

Deliverable B's invariants are enforced by whichever mechanism actually guarantees them, not by
convention:

| Mechanism                    | Used for                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `NOT NULL` / `CHECK` / `UNIQUE` (single table) | Simple structural rules (StaffMember's one Role, Message's one sender). |
| Partial unique index          | "At most one Pending Invitation per (clinic, email)."                                  |
| `EXCLUDE` constraint (GiST)   | Appointment no-double-booking — the one invariant that spans multiple rows of the same table and must be atomic. |
| Trigger                       | Invariants spanning two tables that a `CHECK` constraint cannot see (Conversation/Escalation status agreement). |
| Explicit transaction boundary | Invariants that are about *when* things become visible together, not a structural rule (Clinic's Service list + WorkingHours; Conversation's first Message). |
| Row Level Security policy     | Tenant isolation itself (ADR-0003) — the one guarantee that must hold even if application code has a bug. |

Each is named again, against the specific invariant it protects, in
[`01-database-schema.md`](./01-database-schema.md).

## Relation to Deliverable B

This document must not contradict [`docs/domain/`](../domain/) or any Accepted ADR. Where this
deliverable adds detail Deliverable B didn't specify (the physical `clinic_id` column choice
below, the specific enforcement mechanism per invariant), it is additive — implementing what B and
ADR-0003 already required, not amending either.

One deliberate implementation choice, stated here because it's a genuine "how," not silently
assumed: [`docs/domain/06-multi-tenancy.md`](../domain/06-multi-tenancy.md) describes Conversation
and Appointment's tenant ownership as *transitive* (inherited through Patient) at the conceptual
level. This deliverable gives every tenant-scoped table — Conversation, Message, Escalation, and
Appointment included — its own physical `clinic_id` column rather than relying on a join through
Patient at query time. This is not a contradiction of B: B describes what must be true
conceptually ("inherits its Conversation's Clinic"), not how a table is physically shaped, and
ADR-0003 is explicit that "any table holding data that belongs to a specific clinic... carries a
`clinic_id` foreign key." Denormalizing the column onto every table is what makes a single,
uniform RLS policy shape possible across all tenant-scoped tables (see
[`01-database-schema.md`](./01-database-schema.md)), and matches ADR-0003's own stated
consequence that application code benefits from `clinic_id` being present for index usage even
where RLS is the actual safety net. Same-clinic *consistency* between an Appointment and the
Patient/Service/StaffMember it references is then enforced structurally (composite foreign keys),
not left to be re-derived by a join.
