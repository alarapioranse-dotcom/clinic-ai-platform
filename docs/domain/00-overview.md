# Deliverable B — Domain Model

## What this covers

Deliverable B translates Deliverable A (`docs/product/*`) into a conceptual domain model: the
entities, aggregates, value objects, relationships, and tenancy rules the product's behavior
implies. It answers "what kind of thing is a Conversation, and what must always be true about
it" — never "what table stores it."

Every entity, relationship, and rule in this deliverable is derived from a user flow or
acceptance criterion in `docs/product/`, principally
[`03-user-flows.md`](../product/03-user-flows.md) and
[`06-acceptance-criteria.md`](../product/06-acceptance-criteria.md). Nothing here was invented
without a flow requiring it, and nothing a flow depends on has been left out — see
[`01-entities.md`](./01-entities.md) for the "which flow requires it" column on every entity.

## What this defers to Deliverable C

Deliverable C owns everything about _how_ this model is realized:

- Database schema, tables, columns, indexes, migrations.
- API contracts: endpoints, request/response shapes, status codes.
- The AI pipeline: retrieval, prompting, grounding, model choice.
- Authentication implementation (sessions, tokens, password hashing).
- Storage details for Knowledge Documents (file storage, embeddings).

Where this document says a rule must hold (e.g., "no two overlapping Appointments for one
Practitioner"), it is a statement of what Deliverable C's implementation must enforce, not a
statement of how it enforces it.

## Modelling conventions

- **Entity vs. Value Object**: an Entity has identity that persists across changes (two
  Appointments with identical times are still two different Appointments); a Value Object has no
  identity of its own — two instances with equal attributes are interchangeable. Full definitions
  in the [Domain Glossary](./07-glossary.md).
- **Aggregate**: a cluster of entities and value objects treated as one consistency unit, entered
  and modified only through its Aggregate Root. Other aggregates reference it by identity only,
  never by reaching into its internals.
- **Actors**: every lifecycle transition below names the actor that causes it, from a fixed set:
  Patient, Receptionist, Practitioner, Owner, Admin, Assistant, System. "System" means an
  automated transition with no human or assistant decision behind it (e.g., an invitation
  expiring with the passage of time).
- **Tenant ownership**: every entity states which Clinic (tenant) it belongs to, and how. This is
  the conceptual counterpart to `clinic_id` in [ADR-0003](../adr/0003-multi-tenancy-model.md) —
  see [`06-multi-tenancy.md`](./06-multi-tenancy.md) for the full treatment.
- **Data classification**: every entity is classified as **Operational Data**, **Personal Data**,
  or **GDPR Article 9 Special Category Data** (charter §7). Classification here is conceptual —
  it states what must be protected, not how (encryption, access control implementation, etc. are
  Deliverable C).

## Modelling decisions that are expensive to reverse

These are decisions this document had to make to produce a coherent model, even though Deliverable
A doesn't settle them. Each is also listed under **Candidate ADRs** below, because a decision
expensive to reverse should not become architecture by accident.

1. **A Patient record is scoped to exactly one Clinic.** A person who messages two different
   clinics on the platform is two separate, unlinked Patient records. This was chosen because it
   is the only option that cannot leak data across tenants by construction — a shared/global
   patient identity would require every read of patient data to additionally filter by clinic
   correctly, every time, forever, which is exactly the class of bug ADR-0003 exists to prevent.
   Reversing this later (merging patient identities across clinics) is a data migration with
   privacy implications, not a schema tweak.
2. **Escalation is modeled as a persistent, auditable Entity, not a transient status flag on
   Conversation.** Charter §3 and §6 (an agent's refusal to guess, and "agent output is untrusted
   until a human reviews it") both imply that _why_ a conversation was escalated must be
   recoverable after the fact, not just _that_ it currently needs staff. A status flag alone
   loses that history the moment the status changes again.
3. **Working hours are modeled at the Clinic level, not per Practitioner**, because that is the
   only granularity Deliverable A's sign-up flow collects
   (`docs/product/03-user-flows.md`, "clinic profile: hours, services, prices, location"). This is
   flagged, not settled — see Questions Remaining below, since the Appointment invariant
   (no double-booking _per Practitioner_) sits uneasily next to clinic-wide-only hours.

## Candidate ADRs

Decisions this deliverable surfaced that should get their own ADR before or during P1/P2
implementation, rather than being inherited from this document as precedent:

| #   | Decision                                                                                                                  | Why it's costly to reverse                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Patient identity is per-clinic, never platform-global.                                                                    | Changing it later means migrating and re-linking patient data across tenant boundaries.                                                                                      |
| 2   | A Staff Member belongs to exactly one Clinic.                                                                             | Supporting multi-clinic staff later requires reshaping the identity model, not just adding a field.                                                                          |
| 3   | Escalation is a persistent Entity with its own history, not a status field.                                               | Retroactively adding history to past conversations that only ever had a status isn't possible.                                                                               |
| 4   | Patient data erasure (GDPR Article 17): full deletion vs. anonymize-and-retain for the clinic's operational/legal record. | Whichever is chosen shapes every entity's deletion behavior; changing course after real patient data exists is a migration under legal pressure.                             |
| 5   | Whether the no-double-booking invariant on Appointment is a hard rule or an overridable-by-staff warning.                 | Weakening a hard invariant later is easy; adding one after staff have relied on being able to override it is a behavior change users will notice.                            |
| 6   | Working hours: Clinic-wide only vs. per-Practitioner.                                                                     | Per-Practitioner hours change the Appointment aggregate's invariant and the shape of availability computation; adding it later touches every screen that shows availability. |

## Questions Remaining

Uncertainties this document did not resolve. None of the model above silently assumes an answer
to these beyond what's stated as an explicit, flagged assumption in the relevant file.

1. Can a natural person be a Staff Member at more than one Clinic? Assumed no (see Candidate ADR
   2); not confirmed by Deliverable A.
2. Are working hours Clinic-wide only, or does each Practitioner need independent hours? (Candidate
   ADR 6.)
3. What retention period applies to Patient, Conversation, Message, and Appointment data after a
   patient's last activity, or after an erasure request? Charter §7 requires this be designed
   before launch; it is not designed yet, only scaffolded conceptually in
   [`06-multi-tenancy.md`](./06-multi-tenancy.md).
4. On a GDPR Article 17 erasure request, are a patient's Appointments and Conversations deleted
   outright, or anonymized and retained for the clinic's legitimate business/legal record-keeping?
   (Candidate ADR 4.)
5. Can a Patient have more than one open Conversation at a time, or exactly one? Deliverable A's
   flows only ever show a single linear conversation.
6. Once a Conversation is escalated, can the Assistant ever resume handling it automatically, or
   must a human always explicitly close the loop?
7. Is a cancelled Appointment's TimeSlot released immediately, or held for a grace period? Flow 3
   only specifies release behavior for rescheduling, not plain cancellation.
8. If a Staff Member who sent a pending Invitation is deactivated before the invitee accepts, what
   happens to that Invitation?

## Relation to prior deliverables

This document must not contradict [`docs/governance/project-charter.md`](../governance/project-charter.md),
[`docs/adr/0003-multi-tenancy-model.md`](../adr/0003-multi-tenancy-model.md), or
[`docs/adr/0004-staff-role-model.md`](../adr/0004-staff-role-model.md). No contradiction was found
during modelling; where this document adds detail those three didn't specify (e.g., Patient
identity scope, Escalation as an entity), it is additive and flagged above as a candidate ADR, not
a silent amendment to an existing one.
