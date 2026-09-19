# P5 Architecture Audit (read-only)

**Date:** 2026-09-19
**Scope:** Compare what `docs/03-roadmap.md` actually requires for P5 against what already
exists in the repository at `main` (237b9cf). No code, migration, or ADR-status changes were
made to produce this document.

This audit exists because a previous phase was scoped from a descriptive label instead of the
code, and the resulting work turned out to already be shipped. Every claim below is checked
against the repository at HEAD, including claims made in this audit's own prompt.

---

## 1. The P5 roadmap section, quoted verbatim

From `docs/03-roadmap.md`:

> ## P5 — Knowledge base and AI
>
> **Acceptance criteria:**
>
> - Each clinic can maintain its own knowledge base (services, pricing, hours,
>   policies).
> - Automated replies to patients are grounded in that clinic's knowledge base.
> - The `knowledge-base` feature owns retrieval logic behind its public entry
>   point; AI/LLM calls are isolated behind an interface so the provider can
>   change without touching call sites.

That is the entire section. There is no separate "services and pricing" bullet.

## 2. Resolving the knowledge-base-vs-services contradiction

**"Knowledge base and AI" is correct. "Services and pricing enter the system" is not a P5
requirement — it is a misreading of the parenthetical in the first bullet.**

Evidence:

- `docs/03-roadmap.md` P5 bullet 1 reads "knowledge base (**services, pricing, hours,
  policies**)" — a parenthetical listing *examples of unstructured knowledge-base content*, not
  a distinct feature.
- `docs/01-project-plan.md:10-11`: "Ground automated replies in a clinic's own knowledge base
  (services, pricing, hours, policies)." Identical framing, same source phrase.
- ADR-0008 (Accepted, Phase: P5) repeats the same parenthetical when describing expected
  knowledge-base *size* ("services, pricing, hours, policies"), consistent with content inside
  documents, not a structured pricing entity.
- Separately, `docs/domain/01-entities.md` defines a structured **Service** entity (name,
  `ServiceDuration`, `Money` price, Active/Retired lifecycle) referenced by the **Appointment**
  aggregate — this is real, but it belongs to the domain model for **Appointments (P4)**, not to
  P5. Its own product-doc screen, `/dashboard/settings/clinic` ("Set clinic profile (hours,
  services, prices)"), is tagged **P1 (data) / P2 (editable once authenticated)** in
  `docs/product/05-screen-inventory.md:26` — not P5.

So there are two unrelated things that both use the word "services":
1. Unstructured mentions of services/pricing/hours/policies *as knowledge-base document
   content* — this is P5, per the roadmap, and is what "Knowledge base and AI" means.
2. A structured `Service` entity with a price, referenced by `Appointment` — this is P4/domain
   scope per the docs that define it, already excluded from the P4 migration (see §7 below), and
   not mentioned anywhere in the P5 roadmap section.

Do not treat (2) as authorized by P5. The roadmap text does not say it.

## 3. Requirement-by-requirement: code / docs-only / absent

| P5 requirement | Status | Evidence |
| --- | --- | --- |
| Clinic can maintain its own knowledge base | **Docs only.** No code. | `docs/technical/01-database-schema.md:519` defines `knowledge_documents` (CREATE TABLE, RLS policy). `docs/technical/06-knowledge-document-storage.md` defines upload/processing lifecycle and object storage. `docs/technical/03-api-contracts.md:117-129` defines the `/api/knowledge-documents*` routes. **None of this exists in `db/migrations/` (0001-0012) or `src/app/api/`** — confirmed by directory listing, no `knowledge_document` string anywhere in `db/migrations/*.sql`, no route under `src/app/api/`. `src/features/knowledge-base/` exists only as a placeholder README ("Empty by design in Phase 0"). |
| Automated replies grounded in the knowledge base | **Docs only.** No code. | `docs/technical/05-ai-pipeline.md` fully specifies the pipeline (INTAKE → PRE-CHECK → RETRIEVE → CLASSIFY+GENERATE → REPLY/ESCALATE) and the `AssistantProvider` interface, explicitly marked "documentation, not a src/ file." No `AssistantProvider`, no retrieval code, no AI/LLM call of any kind exists in `src/` — a repo-wide search for `openai`, `anthropic`, `assistantprovider` in `src/` returns zero matches. `src/features/conversations/index.ts` explicitly states "staff replies, AI, escalations, and status are explicitly out of scope" for the shipped P3 slice, and "no AI/assistant sender type" exists yet. |
| `knowledge-base` feature owns retrieval behind a public entry point | **Absent.** | `src/features/knowledge-base/README.md` is the only file in that directory — no `index.ts`, no public entry point, no retrieval logic. |
| AI/LLM calls isolated behind an interface | **Docs only.** | The `AssistantProvider` interface is fully designed in `docs/technical/05-ai-pipeline.md` but is explicitly labeled illustrative/documentation-only. No corresponding TypeScript interface exists in `src/`. |

## 4. pgvector and AI vendor status

**pgvector: not installed anywhere.** `db/migrations/0001_extensions.sql` installs only
`pgcrypto`. `db/migrations/0011_appointments.sql` installs `btree_gist` (for the appointments
no-double-booking EXCLUDE constraint). No migration creates the `pgvector` extension, and no
migration creates `knowledge_document_chunks` or any embedding column/table. A full-repo search
for `pgvector` and `vector(` outside `docs/` returns zero matches.

ADR-0008 *decides* pgvector-in-Postgres as the embeddings-storage architecture ("Accepted —
2026-08-30"), and that decision is real and correctly recorded — but it is a decision on paper
only. It has not been executed against any migration, and it is therefore **not trusted on the
production catalog** (production is at migrations 0001-0012, none of which touch pgvector or any
knowledge/embedding table).

**AI vendor: none selected.** ADR-0007 (Accepted) is explicit that it fixes *constraints* a
future vendor must meet (EU-region inference endpoint, Article-9-scoped DPA, no training on
customer data, no patient identifiers in prompts) and explicitly states "**No vendor is named at
this phase**" and that vendor selection is deferred to a future, separate ADR. No such
vendor-selection ADR exists (ADR index tops out at 0017, none titled vendor selection), and no
vendor SDK, API key handling, or provider implementation exists anywhere in `src/`.

## 5. ADR-0011 E1-E7 status

Quoted verbatim from `docs/adr/0011-regulatory-scope-boundaries.md` §6:

> - **E1 Closed intent schema.** Model output MUST validate against a closed enum of intents:
>   book, reschedule, cancel, hours, price, location, quote, escalate. Any output failing
>   validation is discarded and replaced by the escalation response. No intent representing
>   assessment, ranking, or advice may exist.
> - **E2 Verbatim-span check.** A quote response MUST be a contiguous span of a clinic-authored
>   source document, verified by exact match against the stored source, with the source id
>   returned. Non-matching spans are blocked.
> - **E3 Pre-model input gate.** A deterministic detector routes symptom and emergency signals
>   to a fixed non-generated message plus escalation before the model is invoked.
> - **E4 Transport-level disclosure.** The AI disclosure required by Art. 50(1) is emitted by the
>   channel adapter as the first message of every patient session. A session cannot open without
>   it. Emission is logged with a timestamp and retained as compliance evidence.
> - **E5 CI boundary suite.** A red-team corpus of patient messages attempting to elicit triage,
>   dosage, diagnosis, or urgency ranking MUST pass in CI. A failing case blocks merge.
> - **E6 Change control.** The intent enum and the boundary policy files are under CODEOWNERS. A
>   diff touching them without an ADR reference fails CI.
> - **E7 Observability.** Every boundary-triggered escalation is counted as a metric. A sustained
>   rise is treated as a product-drift signal, not noise.
>
> E1-E4 are acceptance criteria for P5. E5-E7 ship with it, not after.

**None of E1-E7 exist in code.** Verified:
- No intent-enum type/validator exists in `src/` (grep for "intent" in `src/` matches only prose
  comments in `src/features/conversations/index.ts` and its README, unrelated to a closed schema).
- No verbatim-span-matching logic exists (no knowledge-document quoting code exists at all yet —
  §3 above).
- No pre-model input gate / deterministic emergency detector exists — there is no model call to
  gate in front of.
- No disclosure-emission code exists in the conversations feature or any channel adapter.
- No red-team corpus, no CODEOWNERS entry referencing an intent enum or boundary policy file
  (repo has no `CODEOWNERS` file at all — confirmed absent), and no escalation metric emission
  code.

This means **all four P5 acceptance-blocking mechanisms (E1-E4) are unbuilt**, in addition to the
roadmap's own three P5 bullets being unbuilt. E1-E4 are additive requirements on top of the
roadmap text, not alternatives to it — both sets are gaps.

## 6. Services and pricing: repository's own model, if P5 ever touches them

The roadmap does not put a structured services/pricing feature in P5 (§2). These questions are
recorded for whoever eventually scopes that separate, not-yet-scheduled work — not decided here:

- **What does "service" mean today?** `docs/domain/01-entities.md` §"Service" (Deliverable B,
  docs-only, not built): an entity with a name, `ServiceDuration`, `Money` price, Active/Retired
  lifecycle, owned inside the Clinic aggregate, referenced by identity from Appointment. No
  `services` table exists in any migration; `clinics.working_hours` is the only clinic-editable
  structured column that exists today (`db/migrations/0003_clinics.sql`) — no `services` or
  `prices` column on `clinics` either.
- **Where would pricing belong?** Undecided in the repository. The domain doc models it as its
  own `Service` entity (not a `clinics` column), which is one candidate; the product screen
  inventory's `/dashboard/settings/clinic` tags it as part of clinic profile settings, which
  reads as a different candidate. The two docs are not reconciled with each other.
- **Are prices mutable?** Not addressed anywhere found. `docs/domain/01-entities.md` describes
  Service as Active/Retired but says nothing about whether an existing Service's `Money` price
  can change in place versus requiring a new Service record.
- **Would an appointment need a historical price snapshot?** Not addressed anywhere found. The
  Appointment entity's validation rules reference "one Service" by identity
  (`docs/domain/01-entities.md:245`), which — if a Service's price can mutate — would mean a past
  Appointment's price at booking time is not independently recoverable. This is a real, open
  question the domain docs do not raise or answer.

These are open questions, not settled positions — reported here for scoping, not resolved.

## 7. Would `service_id` on `appointments` be a one-way-door decision?

**Yes, confirmed from the existing accepted record — this is already established, not new.**
ADR-0014 (Accepted, P4), §Consequences, states explicitly:

> This ADR does not decide, and P4 migration design must still resolve separately: ... whether a
> `services` reference belongs in P4 at all ...

And the shipped migration confirms the exclusion was carried through: `db/migrations/0011_appointments.sql`'s
`appointments` table has `patient_id`, `practitioner_id`, `conversation_id` — **no `service_id`
column, no foreign key to any services table** (verified directly against the `CREATE TABLE
appointments` block). `src/features/appointments/index.ts`'s own doc comment repeats the same
P4-scope boundary implicitly by never mentioning a service.

This is a live contradiction worth flagging (§11): `docs/domain/01-entities.md:236,245`
(Deliverable B, Accepted-adjacent design doc) states as a *validation rule* that Appointment
"references exactly one Patient, one Service, one Practitioner" — stated as if already decided —
while the actual accepted ADR-0014 and the shipped P4 migration both leave it explicitly
unresolved and unimplemented. The domain doc is ahead of what was actually decided and built.

Given that context, adding `service_id` to `appointments` now would indeed be the kind of
one-way-door decision requiring its own ADR per charter §10: it's a schema change to an
already-shipped, production table (`appointments`, live since migrations 0001-0012), touches the
existing no-double-booking invariant's shape not at all but does touch the Appointment aggregate's
validation contract, and — per §6 above — has at least one unresolved downstream question (price
mutability / historical snapshot) that would need to be settled in the same ADR or explicitly
deferred by it.

## 8. Minimum UI the roadmap actually requires for P5

From `docs/product/05-screen-inventory.md` (the two rows explicitly tagged phase `P5`):

- `/dashboard/knowledge-base` — "Manage the documents the assistant may answer from"; action
  "Upload a document"; roles owner/admin; empty state "No knowledge documents yet — the assistant
  can't answer questions until you add one."
- `/dashboard/knowledge-base/upload` — "Add a new knowledge document"; action "Submit."

Neither screen exists in `src/app/` today (confirmed: no `knowledge` or `service` path under
`src/app`). No other screen in the inventory is tagged P5. Specifically,
`/dashboard/settings/clinic` (hours/services/prices) is tagged P1/P2, not P5 — reinforcing §2's
resolution that a services/pricing settings UI is not part of P5's minimum surface.

## 9. Tenant/RLS boundaries new P5 entities would need

- `knowledge_documents`: already fully specified with RLS in
  `docs/technical/01-database-schema.md:544-546` (`ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL
  SECURITY`, `tenant_isolation` policy keyed on `current_setting('app.current_clinic_id', true)`)
  — same shape as every existing tenant-scoped table, consistent with ADR-0006. Not yet migrated.
- Embedding/chunk storage (whatever table ADR-0008's decision is finally executed as, e.g.
  `knowledge_document_chunks`): ADR-0008 itself specifies the same RLS shape, tenant-scoped by
  `clinic_id`, `NOT NULL`. Not yet migrated.
- Test coverage convention: `docs/technical/02-tenant-isolation-testing.md` describes an
  aspirational "parameterize over every tenant-scoped table" CI suite, but the actual test code
  (`tests/db/tenant-isolation.test.ts`, `tests/db/conversations-isolation.test.ts`) is hand-written
  per table today, not table-list-driven. Whoever builds P5 will need to add a new hand-written
  isolation test per new table, following the existing pattern — this is normal, not a P5-specific
  gap, but it is manual work that must not be skipped.

## 10. What existing P4 behavior must remain unchanged

- The `appointments_no_double_booking` EXCLUDE constraint and the four-state lifecycle
  (`booked`/`rescheduled`/`cancelled`/`completed`) fixed by ADR-0014/0015 — nothing in P5's actual
  roadmap text touches appointments at all, so P5 work should not need to touch
  `db/migrations/0011_appointments.sql` or `src/features/appointments/*`.
- `src/features/appointments/index.ts`'s public-entry-point boundary (only `index.ts` is a valid
  import target for other features) — if a future AI pipeline ever needs to check availability or
  book on a patient's behalf, it must go through this existing public entry point, not reach into
  `./repository` or `./schedule` directly.
- Clinic-local IANA timezone handling (ADR-0016) and DST-transition behavior (ADR-0017) — not
  reopened, not touched by anything found in scope for P5.

## 11. Contradictions found between docs, or between docs and code

1. **`docs/domain/01-entities.md` states the Service-on-Appointment reference as settled; the
   accepted ADR-0014 and shipped migration leave it explicitly unresolved and unbuilt.** See §7.
   This is the sharpest one — a Deliverable-B design doc reads as if a decision was made that the
   project's own ADR record says was deliberately deferred.
2. **`docs/technical/06-knowledge-document-storage.md` (§"Retrieval-time storage") still reads as
   if the co-located-vs-dedicated-vector-store choice is open** ("Neither is chosen here... Open
   Question 3"), but ADR-0008 accepted the co-located/pgvector answer on 2026-08-30. Lower
   severity than #1 — this is a documentation staleness issue (the design doc wasn't updated after
   its own named ADR resolved the question it raises), not a scope or decision conflict, and
   `docs/technical/07-open-questions.md` was correctly updated with "Resolved by ADR-0008." Only
   `06-knowledge-document-storage.md` itself lags.
3. **The prompt/summary claim "P5 is where services and pricing enter the system" does not match
   the roadmap text.** See §2. Not a repository-internal contradiction, but exactly the kind of
   claim this audit was commissioned to catch before it drives scoping.

No other contradictions between phase labels and shipped code were found. STATUS.md's own
roadmap summary ("P5 Knowledge base and AI — planned, hard criteria E1-E7 from ADR-0011") is
consistent with the roadmap and with ADR-0011, and matches what this audit independently found in
code.

---

## Gap analysis summary

| Area | Exists in code | Exists in docs only | Absent entirely |
| --- | --- | --- | --- |
| `knowledge_documents` table + RLS | | ✅ (`01-database-schema.md`) | |
| Object storage / upload lifecycle | | ✅ (`06-knowledge-document-storage.md`) | |
| `/api/knowledge-documents*` routes | | ✅ (`03-api-contracts.md`) | |
| `knowledge-base` feature public entry point | | | ✅ |
| pgvector extension | | ✅ (ADR-0008 decision) | ✅ (not migrated) |
| Embedding/chunk table | | ✅ (ADR-0008 shape) | ✅ (not migrated) |
| AI vendor selection | | | ✅ (ADR-0007 explicitly defers) |
| `AssistantProvider` interface | | ✅ (`05-ai-pipeline.md`, marked illustrative) | ✅ (no `src/` file) |
| E1 closed intent schema | | ✅ (ADR-0011) | ✅ |
| E2 verbatim-span check | | ✅ (ADR-0011) | ✅ |
| E3 pre-model input gate | | ✅ (ADR-0011) | ✅ |
| E4 transport-level disclosure | | ✅ (ADR-0011) | ✅ |
| E5-E7 (CI suite, CODEOWNERS, metrics) | | ✅ (ADR-0011) | ✅ |
| `/dashboard/knowledge-base` UI | | ✅ (screen inventory) | ✅ |
| Structured `Service`/pricing entity | | ✅ (domain doc, P4-adjacent, not P5) | ✅ (no table, no UI) |

**Bottom line:** every P5 roadmap requirement and every E1-E4 acceptance-blocking mechanism is
either design-doc-only or entirely absent from the codebase. Nothing found is "already shipped"
the way the prior mis-scoped phase turned out to be — P5, unlike that phase, genuinely has not
started.

## Decisions that must be made before any implementation

- Vendor selection ADR for the AI provider (gated by ADR-0007's four constraints) — blocks any
  real `AssistantProvider` implementation.
- Execution of ADR-0008's already-accepted pgvector decision into an actual migration — this is
  not a new decision, just unexecuted work, but it's a precondition for RETRIEVE stage code.
- Whether and how the structured `Service`/pricing entity is scoped at all, and to which phase
  (§6-7) — currently not owned by any roadmap phase's acceptance criteria in `docs/03-roadmap.md`.
  This should be resolved (even if the resolution is "still not in scope") before anyone
  interprets the P5 knowledge-base parenthetical as authorization to build it.
- Resolution of the two open items ADR-0011 §"Open questions" flags as needing resolution
  "before P5 ships": post-operative-instructions quoting policy, and Art. 50(2) machine-readable
  marking of synthetic content.
- The verification gate in ADR-0011 §5 (external EU regulatory adviser sign-off on MDR
  exclusion / AI Act classification) — a precondition on going live, not on writing code, but
  worth surfacing now since it is a schedule item per ADR-0011's own consequences.

## ADRs that would likely be required (named, not drafted)

- **AI vendor selection ADR** — already anticipated by ADR-0007 itself; cites ADR-0007 and states
  how the chosen vendor satisfies its four constraints.
- **Appointment-Service reference ADR** — if/when a `service_id` (or equivalent) is added to the
  `appointments` table, per §7's one-way-door analysis. Would need to resolve: whether the
  reference is required or optional, and the price-mutability/historical-snapshot question from
  §6, at minimum.
- Possibly a narrow **audit-log erasure strategy ADR** — this is ADR-0010, already reserved by
  name in `docs/adr/README.md` as a follow-up from ADR-0009, unwritten. Not strictly a P5 blocker
  on the evidence found, but flagged since P5 introduces new data (knowledge documents, embeddings)
  that a future audit-log design would need to cover.

No ADR is drafted here, per this audit's boundaries.

## Smallest implementable P5 slice

Based purely on the roadmap's own three bullets and ADR-0011's E1-E4, the smallest slice that
moves P5 forward without depending on the AI-vendor decision:

1. Migrate `knowledge_documents` (schema already fully specified in
   `docs/technical/01-database-schema.md`) with RLS, matching the existing tenant-scoped table
   pattern.
2. Build the `knowledge-base` feature's public entry point for document CRUD (list/upload
   metadata row/mark status) and the two P5 UI screens — this requires no AI vendor and no
   pgvector, only object storage for the raw file (per `06-knowledge-document-storage.md`).
3. Land E1 (closed intent schema) and E6 (CODEOWNERS + CI check on the intent enum/policy files)
   as structural work — these are enforceable without a model call existing yet, since E1 is a
   validator on model *output* shape and E6 is a repo-process control.

Retrieval (pgvector execution), `AssistantProvider`, and E2-E5/E7 all depend on the vendor
decision and/or the retrieval table existing first, so they sequence after the above.

## Anything contradicting a doc or phase label

Covered fully in §11. Summary: one real contradiction (Service-on-Appointment, domain doc vs.
ADR-0014 vs. shipped schema), one stale-but-harmless doc (`06-knowledge-document-storage.md` not
updated after ADR-0008), and one prompt-level claim not supported by the roadmap text
("services and pricing enter P5").
