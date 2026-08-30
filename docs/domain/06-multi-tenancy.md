# Multi-Tenancy (Conceptual)

This document refines [ADR-0003](../adr/0003-multi-tenancy-model.md) at the domain-model level. It
does not implement it — no schema, no RLS policy syntax, no migration appears here. It restates
ADR-0003's data-layer decision ("every tenant-scoped table carries a `clinic_id` column") in
domain terms and works through what that means for the entities in this deliverable.

## `clinic_id` propagation, conceptually

In domain terms, "carries a `clinic_id`" means "references its owning Clinic, directly or
transitively." Propagation works two ways in this model:

- **Direct ownership** — Service, StaffMember, Invitation, Patient, and KnowledgeDocument each
  reference their Clinic directly; the reference is assigned once, at creation, from the actor's
  own clinic context (the Owner/Admin doing the inviting, the Clinic itself during sign-up).
- **Transitive ownership** — Conversation and Appointment don't hold a Clinic reference of their
  own; they inherit it from the Patient they belong to. Message and Escalation inherit it again
  from the Conversation that contains them. A Message can never be created "for" a different
  Clinic than its Conversation, because it has no independent way to specify one — this is
  [`04-relationships.md`](./04-relationships.md)'s "safe by construction" claim restated as a
  propagation rule.

## Tenant-scoped entities

Every entity in [`01-entities.md`](./01-entities.md) except Clinic itself: Service, StaffMember,
Invitation, Patient, Conversation, Message, Escalation, Appointment, KnowledgeDocument.

## Global entities

**None exist in this model.** Clinic is the tenant, not a global entity above the tenant level —
there is no platform-wide entity (a cross-clinic admin construct, a shared template library, and
so on) that any flow in Deliverable A requires. If one is ever needed, it should arrive with its
own ADR, since introducing the first genuinely global entity changes what "tenant-scoped" means
for everything else by contrast.

## GDPR Article 17 (erasure), conceptually

Article 17 gives a Patient the right to have their personal data erased. This model's entities most
directly implicated are Patient, Conversation, Message, and Appointment. The erasure strategy is
decided in [ADR-0005](../adr/0005-patient-erasure-strategy.md) (Accepted): irreversible
anonymisation, applied per entity, with deletion as the default wherever anonymisation cannot be
demonstrated — neither full deletion of everything referencing the Patient, nor retaining
everything behind access controls. In brief (see ADR-0005 for the full decision and its
safeguards):

- **Patient** — identifying attributes are irreversibly anonymised; no reversible mapping or
  recoverable key survives.
- **Appointment** — retained in de-identified form only where the Clinic has an independent legal
  and operational basis under Article 17(3); otherwise deleted.
- **Conversation and Message** — deletion is the default; retained only where irreversible
  anonymisation of that specific record can be demonstrated, which free text is presumed unable to
  satisfy on identifier-scrubbing alone.

See [`01-entities.md`](./01-entities.md) for the erasure behaviour recorded against every entity,
including the ones ADR-0005 does not address directly (Clinic, Service, StaffMember, Invitation,
KnowledgeDocument).

Because a Clinic is scoped per-tenant and a Patient is scoped per-Clinic (Candidate ADR 1), an
erasure request made to one Clinic structurally cannot and does not affect any record the same
real person may have at a different clinic on the platform — each is a fully separate Patient
record. This is a direct consequence of tenant isolation, not a separate mechanism.

## Entities containing Article 9 data

Per [`01-entities.md`](./01-entities.md)'s classification: Conversation, Message, and Escalation
are all treated as GDPR Article 9 Special Category Data by default. Conversation and Message
because their content is Patient-authored free text the product cannot constrain, regardless of
the Assistant being restricted to administrative topics (charter §3). Escalation because its
`reason` field, for the `clinical-question` and `medical-emergency` values specifically, states
that a health-related topic was raised even more directly than the free text it accompanies — and
because, as an internal entity of the Conversation aggregate with no independent existence outside
it, its classification cannot be looser than its containing Conversation's. Appointment is
classified as ordinary Personal Data but can be elevated in a specific case — an Appointment
referencing a health-revealing Service name (e.g., a psychiatric or sexual-health service)
indicates a health category by association. This elevation is not modeled as a different entity —
it's a handling note, since splitting "sometimes-sensitive Appointment" into two entity types
isn't required by any flow.

## Retention, conceptually

Charter §7 requires retention and erasure to be designed before the first clinic goes live. This
document does not complete that design — it states the concept a future ADR must resolve: data
should be retained only as long as it serves the purpose it was collected for (answering patients,
running the clinic's schedule), and no entity in this model currently has an assigned retention
period. That is Question Remaining #3 in [`00-overview.md`](./00-overview.md), and it is a
precondition for launch, not an optional refinement.
