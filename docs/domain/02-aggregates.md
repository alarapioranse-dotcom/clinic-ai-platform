# Aggregates

Every aggregate below states the invariant(s) it protects, per the review constraint that no
aggregate may exist without one. Where an aggregate's invariant is thin, that is argued
explicitly rather than left implicit. Where an invariant's true consistency scope is broader than
a single aggregate instance, that is argued explicitly too, rather than overstating what the
boundary actually protects.

## Clinic aggregate

- **Aggregate Root** — Clinic.
- **Boundary** — Clinic itself, plus its Service list and its WorkingHours value object.
- **What lives inside** — Service (internal entity); WorkingHours (value object).
- **What is referenced by identity only** — StaffMember, Invitation, Patient, Conversation,
  Appointment, KnowledgeDocument all reference their owning Clinic by identity; none of them live
  inside this aggregate.
- **Business invariant protected** — a Clinic's working hours and its service list are read and
  written as one consistent unit: the booking and assistant-answering paths never see a Service
  that belongs to a half-saved settings update, and never see working hours that are partially
  applied (e.g., five days written, two pending). This matters because both `docs/product/03-user-flows.md`
  ("Owner enters clinic profile") and the Assistant's grounding principle (charter §3) depend on
  the clinic's own data being internally consistent at the moment anyone reads it.

## StaffMember aggregate

- **Aggregate Root** — StaffMember.
- **Boundary** — StaffMember alone (email, role, status).
- **What lives inside** — nothing further; this is a single-entity aggregate.
- **What is referenced by identity only** — Clinic (owner), and it is itself referenced by
  identity from Appointment (as practitioner) and from Conversation/Message (as replier).
- **Business invariant protected** — a StaffMember has exactly one Role at any time, and that Role
  is always one of the four in `docs/adr/0004-staff-role-model.md` — never zero, never more than
  one, never a value outside the set. This is thin on its own, which is why it's paired with the
  Invitation aggregate below rather than merged into it: a StaffMember's invariant is about being
  _correct once it exists_, while Invitation's is about the _process of it coming to exist_, and
  those two concerns have different lifecycles (an Invitation can expire and be reissued any
  number of times before a StaffMember is ever created).

## Invitation aggregate

- **Aggregate Root** — Invitation.
- **Boundary** — Invitation alone (email, role, expiry, status).
- **What lives inside** — nothing further.
- **What is referenced by identity only** — Clinic (issuer). Not referenced by StaffMember once
  accepted — acceptance creates a new StaffMember; it does not convert the Invitation record into
  one.
- **Business invariant protected** — an Invitation can be Accepted at most once, and only while
  Pending — never both Expired and Accepted, never accepted twice. This directly implements the
  invite flow's "already invited/member" and "invite no longer valid" branches
  (`docs/product/03-user-flows.md`).

## Patient aggregate

- **Aggregate Root** — Patient.
- **Boundary** — Patient alone (contact info).
- **What lives inside** — nothing further.
- **What is referenced by identity only** — Clinic (owner); referenced by identity from
  Conversation and Appointment.
- **Business invariant protected** — a Patient belongs to exactly one Clinic for its entire
  lifetime — it is never reassigned or merged into another Clinic's Patient list. This is the
  domain-level expression of Candidate ADR 1 in [`00-overview.md`](./00-overview.md): the
  invariant exists specifically to make cross-tenant patient data leakage structurally impossible
  at the model level, not just at the database RLS level (ADR-0003).

## Conversation aggregate

- **Aggregate Root** — Conversation.
- **Boundary** — Conversation, its Message history, and its Escalation history.
- **What lives inside** — Message (internal entity, ordered list); Escalation (internal entity,
  zero or more over the Conversation's life).
- **What is referenced by identity only** — Patient and Clinic (both referenced, not contained).
- **Business invariant protected** — the Conversation's status always agrees with its Escalation
  history: it cannot be "needs staff" with no open Escalation recorded, and it cannot be
  "resolved" while an Escalation is still open (Raised or Acknowledged, not Closed). This is the
  single most safety-relevant invariant in the model — it is what makes charter §3's escalation
  principle checkable rather than aspirational: an Escalation that silently disappears without a
  Closed record would be indistinguishable from one that was never raised.

## Appointment aggregate

- **Aggregate Root** — Appointment.
- **Boundary** — Appointment alone, including its TimeSlot value object.
- **What lives inside** — TimeSlot (value object).
- **What is referenced by identity only** — Clinic, Patient, Service, StaffMember (as
  practitioner) — all referenced, none contained.
- **Business invariants protected** —
  1. **No double-booking (hard invariant).** No two non-Cancelled Appointments for the same
     Practitioner — the only schedulable resource this model recognizes; a distinct Resource
     concept (e.g., a room or piece of equipment, schedulable independently of a Practitioner) is
     new scope this document does not assume — within the same Clinic may have overlapping
     TimeSlots. Approved by Ahmed as a hard domain invariant: a conflicting Appointment is
     rejected outright at the point of creation or reschedule, never merely flagged as a warning a
     staff member can override. This is the direct domain answer to the practitioner persona's
     named fear ("being double-booked", `docs/product/01-personas.md`) and to the acceptance
     criterion that a concurrently-taken slot must be caught, not silently overwritten
     (`06-acceptance-criteria.md`).
  2. **Same-Clinic references.** An Appointment's Patient, Service, and practitioner StaffMember
     must all belong to the same Clinic as the Appointment itself (`04-relationships.md`) — an
     Appointment can never be assembled from parts belonging to different clinics.
- **A boundary note on invariant 1** — unlike every other invariant in this document, the
  no-double-booking rule cannot be protected by a single Appointment aggregate instance acting
  alone: it constrains the relationship between _two different_ Appointment instances that share a
  Practitioner. Its true consistency scope is "all Appointments for one Practitioner within one
  Clinic," not one Appointment. This document states the rule as a hard invariant that must hold at
  all times; Deliverable C is responsible for guaranteeing it holds atomically at the moment a
  conflicting Appointment would otherwise be created or a conflicting reschedule would otherwise be
  saved — this document does not say how (no database or application-code mechanism is specified
  here).

## KnowledgeDocument aggregate

- **Aggregate Root** — KnowledgeDocument.
- **Boundary** — KnowledgeDocument alone (status, file metadata).
- **What lives inside** — nothing further.
- **What is referenced by identity only** — Clinic (owner). Not referenced by Conversation or
  Message — grounding a specific reply in a specific document is Deliverable C's concern
  (the AI pipeline), not this model's.
- **Business invariant protected** — a KnowledgeDocument's status only ever moves forward:
  Processing → Ready or Processing → Failed, never backward (a document does not return to
  Processing from Ready or Failed — a corrected file is a new upload, producing a new
  KnowledgeDocument). This is the aggregate's own internal-consistency invariant, and the guarantee
  behind the upload flow's explicit Processing → Ready transition (`docs/product/03-user-flows.md`).
- **Not an aggregate invariant** — "the Assistant may only draw on a KnowledgeDocument whose status
  is Ready" is a real rule (`docs/product/03-user-flows.md`: "assistant can draw on this document"
  only after Ready), but it constrains how a _different_ system — the AI pipeline — may consume
  this aggregate's state; it is not something the KnowledgeDocument aggregate itself enforces about
  its own transitions. Deliverable C's retrieval logic is responsible for checking status before
  use.
