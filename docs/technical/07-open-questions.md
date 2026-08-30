# Open Questions — One-Way-Door Choices for Ahmed's Decision

Per [charter §10](../governance/project-charter.md) (ADR Policy): "One-way door — Record required
before the code, plus Ahmed's approval." The three items below are one-way-door choices this
technical design surfaced while working out _how_ to build Deliverable B's domain model. None of
them is decided anywhere else in `docs/technical/` — every place in this deliverable that touches
one of them says so explicitly and points here instead of picking an answer.

Each needs its own ADR, written and Accepted, before the roadmap phase that depends on it: #1
before P1/P2 (it shapes both the database layer and the auth session model), #2 before P5, #3
before P5.

---

## 1. RLS tenant-context propagation mechanism

Resolved by ADR-0006.

**What's being decided:** how a request's `clinic_id` actually reaches PostgreSQL for the Row
Level Security policies in [`01-database-schema.md`](./01-database-schema.md) to key on.

**Why it's one-way-door:** this choice constrains the connection pooling architecture, the ORM/
query-layer choice, and the auth session model in
[`04-auth-implementation.md`](./04-auth-implementation.md) simultaneously. Once application code is
written assuming one mechanism, switching to another means touching every query path in the
codebase, not a config change — and getting it wrong has the specific failure mode this whole
deliverable exists to prevent: a connection reused across requests with a stale `clinic_id` context
is a cross-tenant data leak, silently, in production.

**Candidates:**

| Option                                                                                   | How it works                                                                                                                                                                                  | Tradeoffs                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-request session variable** (illustrative default used throughout this deliverable) | `SET LOCAL app.current_clinic_id = $1` at the start of each request's transaction; RLS policies read it via `current_setting(...)`.                                                           | Simple, requires no schema for identity beyond `staff_sessions`. Fails unsafely (leaks data) if a pooler in _transaction_ mode reuses a connection between two requests without resetting the setting — requires either session-mode pooling or explicit reset-on-release, which has real throughput cost.                                |
| **Postgres role per clinic**                                                             | Each clinic gets its own database role; RLS policies (or `GRANT`s) key on `current_user`.                                                                                                     | Isolation guarantee moves from "an app-level SET was correct" to "the connection itself cannot see other clinics," which is stronger. Doesn't scale cleanly to hundreds/thousands of clinics (role management, connection-pool sizing per role) — real cost at this product's target scale (small/mid clinics, potentially many of them). |
| **JWT-claim-checked policy function**                                                    | RLS policy calls a function that verifies a signed JWT (passed via a setting or extension) and extracts `clinic_id` from a verified claim, rather than trusting an unsigned session variable. | Removes "did the app remember to SET the right value" as a trust boundary entirely — the policy verifies cryptographically. Adds a JWT verification dependency inside the database layer and a key-rotation story that doesn't exist with the simpler options.                                                                            |

**Interacts with:** the auth session model in
[`04-auth-implementation.md`](./04-auth-implementation.md) (a Postgres-role-per-clinic option would
mean `staff_sessions` maps to a database role, not just an app-level record) and, per that
document's role-enforcement section, could additionally let Practitioner's read-only restriction be
enforced with a Postgres `GRANT`/`REVOKE` rather than API-layer logic alone, if the chosen mechanism
supports role granularity below the clinic level.

---

## 2. AI provider

Resolved by ADR-0007.

**What's being decided:** which LLM vendor(s) implement the `AssistantProvider` interface in
[`05-ai-pipeline.md`](./05-ai-pipeline.md).

**Why it's one-way-door:** Conversation and Message content is GDPR Article 9 Special Category
Data by default ([`docs/domain/01-entities.md`](../domain/01-entities.md)) — sending it to a
vendor is a data-processing relationship that needs a Data Processing Agreement suitable for
special-category health-adjacent data, and unwinding that relationship later (re-papering DPAs,
migrating prompt/eval infrastructure, re-validating output quality) is expensive even though the
pipeline's _interface_ (P5, already fixed in `05-ai-pipeline.md`) makes swapping the
_implementation_ technically straightforward. The one-way cost here is legal/operational, not code
structure.

**Candidates:** not enumerated here by name — this is deliberately left open rather than presented
as a shortlist, since the deciding factors (Arabic-language quality specifically, since the product
is Arabic-first and RTL-first per [charter §3](../governance/project-charter.md); per-conversation
cost against the standing risk "AI cost per conversation exceeding the plan price"
([`docs/01-project-plan.md`](../01-project-plan.md)); DPA terms for Article 9-adjacent data) are
evaluation criteria for Ahmed to weigh, not a technical tradeoff this document can resolve the way
the other two questions' candidate tables do.

**Interacts with:** the standing risk "AI cost per conversation exceeding the plan price"
([`docs/01-project-plan.md`](../01-project-plan.md), Standing risks) — the vendor choice is the
direct lever on that risk.

---

## 3. Embeddings storage

Resolved by ADR-0008.

**What's being decided:** where the retrieval-time chunk/embedding representation described in
[`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) physically lives.

**Why it's one-way-door:** the two candidates carry meaningfully different isolation guarantees
(see below) and different data-residency footprints — a dedicated vector store is very likely a
separate vendor/service with its own hosting region, which the EU-residency assumption in
[`00-overview.md`](./00-overview.md) would then apply to as well, doubling the surface issue #7
eventually needs to resolve. Migrating a production knowledge base's embeddings from one storage
architecture to the other later means re-embedding and re-validating retrieval quality for every
live clinic simultaneously, not a schema migration.

**Candidates:**

| Option                                             | Isolation guarantee                                                                                                                                                                                                                                                        | Tradeoffs                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Co-located (pgvector in the existing Postgres)** | Identical to every other table in [`01-database-schema.md`](./01-database-schema.md) — RLS, `clinic_id`, same guarantees, same test in [`02-tenant-isolation-testing.md`](./02-tenant-isolation-testing.md) covers it "for free" if included in that suite's table list.   | Simplest operationally (one database to run and back up); vector search inside Postgres is adequate at this product's expected per-clinic knowledge-base size, but may need revisiting if a clinic's knowledge base grows far beyond "services, pricing, hours, policies" ([`docs/01-project-plan.md`](../01-project-plan.md)). |
| **Dedicated vector database**                      | Depends entirely on that service's own `clinic_id`-filtering being applied correctly on every query — a second, independent place the "always remember the tenant filter" discipline ADR-0003 was written to remove from application code would need to be re-established. | Purpose-built retrieval performance and scaling headroom; adds a second vendor relationship, a second data-residency question, and a second system that must be kept in sync with `knowledge_documents` row deletions.                                                                                                          |

**Interacts with:** the data-residency assumption in
[`00-overview.md`](./00-overview.md) and, transitively, [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7)
— not decided or reopened here, only noted as downstream of whichever option is chosen.
