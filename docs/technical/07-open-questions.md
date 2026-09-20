# Open Questions — One-Way-Door Choices for Ahmed's Decision

Per [charter §10](../governance/project-charter.md) (ADR Policy): "One-way door — Record required
before the code, plus Ahmed's approval." The three items below were one-way-door choices this
technical design surfaced while working out _how_ to build Deliverable B's domain model, at the
time this document was first written. Two of the three — RLS tenant-context propagation and
embeddings storage — have since been resolved by an ADR; each entry below points at the ADR that
resolved it instead of restating its reasoning. The third, AI provider selection, remains open in
substance: ADR-0007 fixes the constraints any provider must satisfy but explicitly defers the
vendor choice itself to a separate ADR that does not yet exist.

Each needs its own ADR, written and Accepted, before the roadmap phase that depends on it: #1
before P1/P2 (it shapes both the database layer and the auth session model), #2 before P5, #3
before P5.

---

## 1. RLS tenant-context propagation mechanism

Resolved by ADR-0006.

**What was being decided:** how a request's `clinic_id` actually reaches PostgreSQL for the Row
Level Security policies in [`01-database-schema.md`](./01-database-schema.md) to key on.

**Why it was one-way-door:** this choice constrains the connection pooling architecture, the ORM/
query-layer choice, and the auth session model in
[`04-auth-implementation.md`](./04-auth-implementation.md) simultaneously. Once application code is
written assuming one mechanism, switching to another means touching every query path in the
codebase, not a config change — and getting it wrong has the specific failure mode this whole
deliverable exists to prevent: a connection reused across requests with a stale `clinic_id` context
is a cross-tenant data leak, silently, in production.

**Resolution:** [ADR-0006](../adr/0006-rls-tenant-context-propagation.md) (Accepted) chose the
per-request session variable — `SET LOCAL app.current_clinic_id = <clinic_id>` inside the same
transaction as the request's queries, with every RLS policy reading it via `current_setting(...)`
— over a Postgres role per clinic or a JWT-claim-checked policy function. The rejected alternatives
and the mandatory conditions attached to this choice (session-mode pooling or reset-on-release, a
CI gate on pooler configuration, an added tenant-isolation test case) are recorded in ADR-0006
itself, not repeated here.

**Interacts with:** the auth session model in
[`04-auth-implementation.md`](./04-auth-implementation.md) (a Postgres-role-per-clinic option would
mean `staff_sessions` maps to a database role, not just an app-level record) and, per that
document's role-enforcement section, could additionally let Practitioner's read-only restriction be
enforced with a Postgres `GRANT`/`REVOKE` rather than API-layer logic alone, if the chosen mechanism
supports role granularity below the clinic level.

---

## 2. AI provider

Constraints fixed by ADR-0007 (Accepted); vendor selection itself remains open — no
vendor-selection ADR exists yet.

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

**What ADR-0007 fixed, and what it left open:** [ADR-0007](../adr/0007-ai-provider-constraints.md)
(Accepted) fixes four constraints any provider adopted in P2 must satisfy — an EU-region inference
endpoint, a signed Data Processing Agreement covering Article 9 data, a contractual
no-training-on-customer-data term, and no patient identifiers in prompts — but does not choose a
vendor. In ADR-0007's own words: "This ADR itself does not select a vendor" and "No vendor is
named at this phase." Per that ADR, "Vendor selection itself is a separate ADR, written before P2,
that cites this ADR and states how the selected vendor satisfies each of the four constraints
above" — and that ADR does not yet exist. This question is still open in substance, not merely
undocumented.

**Candidates:** not enumerated here by name — this is deliberately left open rather than presented
as a shortlist, since the deciding factors (Arabic-language quality specifically, since the product
is Arabic-first and RTL-first per [charter §3](../governance/project-charter.md); per-conversation
cost against the standing risk "AI cost per conversation exceeding the plan price"
([`docs/01-project-plan.md`](../01-project-plan.md)); DPA terms for Article 9-adjacent data) are
evaluation criteria for Ahmed to weigh, not a technical tradeoff this document resolves the way
Questions 1 and 3 were.

**Interacts with:** the standing risk "AI cost per conversation exceeding the plan price"
([`docs/01-project-plan.md`](../01-project-plan.md), Standing risks) — the vendor choice is the
direct lever on that risk.

---

## 3. Embeddings storage

Resolved by ADR-0008.

**What was being decided:** where the retrieval-time chunk/embedding representation described in
[`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) physically lives.

**Why it was one-way-door:** the candidates carried meaningfully different isolation guarantees and
different data-residency footprints — a dedicated vector store would likely have been a separate
vendor/service with its own hosting region, which the EU-residency assumption in
[`00-overview.md`](./00-overview.md) would then have applied to as well. Migrating a production
knowledge base's embeddings from one storage architecture to another later means re-embedding and
re-validating retrieval quality for every live clinic simultaneously, not a schema migration.

**Resolution:** [ADR-0008](../adr/0008-embeddings-storage.md) (Accepted) chose co-located storage —
a `knowledge_document_chunks` table in the same PostgreSQL database, using the `pgvector` extension
for similarity search, `clinic_id`-scoped and RLS-protected like every other table in
[`01-database-schema.md`](./01-database-schema.md). The rejected alternative (a dedicated vector
database) and the full reasoning are recorded in ADR-0008 itself, not repeated here. See
[`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) for how this plays out at
the retrieval step.

**Interacts with:** the data-residency assumption in
[`00-overview.md`](./00-overview.md) and, transitively, [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7)
— not reopened here. Because the chosen option is co-located, embeddings carry no data-residency
footprint separate from the primary database's own, per ADR-0008's Consequences.
