# Entities

Every entity below uses the same nine-part structure. "Actor" values are drawn from the fixed set:
Patient, Receptionist, Practitioner, Owner, Admin, Assistant, System.

## Clinic

1. **Why it exists** — the tenant boundary; every other entity in this model exists because a
   Clinic exists first.
2. **Which user flow requires it** — "Clinic sign-up and first-run setup"
   (`docs/product/03-user-flows.md`); every screen in `docs/product/04-sitemap.md` is scoped to one.
3. **Aggregate owner** — Aggregate Root of the Clinic aggregate (see [`02-aggregates.md`](./02-aggregates.md)).
4. **Tenant ownership** — is the tenant; not owned by another Clinic.
5. **Lifecycle** — Onboarding → Active → (not addressed: suspended/closed — no flow requires it).
6. **Actor responsible for every lifecycle transition** — Owner creates it (sign-up flow); no
   other actor transitions it within Deliverable A's scope.
7. **Validation rules** — must have a name and at least one contact channel before onboarding can
   complete (sign-up flow requires "clinic name, contact, owner email").
8. **Business rules** — a Clinic's working hours and service list are edited only as an owner/admin
   action (`/dashboard/settings/clinic`, `/dashboard/knowledge-base` is separate — services aren't
   knowledge documents).
9. **Data classification** — Operational Data. (Clinic contact details are the clinic's own
   business information, not a natural person's personal data in the GDPR sense relevant here.)

## Service

1. **Why it exists** — appointments are booked _for_ something; "select service and practitioner"
   is an explicit step with no other entity to attach it to.
2. **Which user flow requires it** — "Creating and rescheduling an appointment"
   (`docs/product/03-user-flows.md`).
3. **Aggregate owner** — owned inside the Clinic aggregate (referenced by identity from Appointment).
4. **Tenant ownership** — belongs to exactly one Clinic.
5. **Lifecycle** — Active → Retired. (Retired, not deleted, so past Appointments referencing it
   remain meaningful — this is an assumption; see Questions Remaining in
   [`00-overview.md`](./00-overview.md).)
6. **Actor responsible for every lifecycle transition** — Owner or Admin.
7. **Validation rules** — must have a name, a ServiceDuration, and a Money price before it can be
   selected on `/dashboard/appointments/new`.
8. **Business rules** — a Retired Service can no longer be selected for a new Appointment, but
   existing Appointments referencing it are unaffected.
9. **Data classification** — Operational Data as a rule, but see the risk noted in this
   deliverable's PR description: a Service's name can itself reveal a sensitive health category
   (e.g., a psychiatric or sexual-health service name), which taints any Appointment referencing
   it for a specific Patient.

## StaffMember

1. **Why it exists** — every role-restricted screen in `docs/product/04-sitemap.md` and
   `docs/adr/0004-staff-role-model.md` requires a signed-in person with exactly one of four roles.
2. **Which user flow requires it** — "Clinic sign-up and first-run setup" (the Owner is the first
   StaffMember) and "Inviting a staff member".
3. **Aggregate owner** — Aggregate Root of its own aggregate (see [`02-aggregates.md`](./02-aggregates.md)).
4. **Tenant ownership** — belongs to exactly one Clinic (Candidate ADR 2 in `00-overview.md`).
5. **Lifecycle** — Active → Deactivated. (Created directly for the Owner at sign-up; created via
   Invitation acceptance for everyone else.)
6. **Actor responsible for every lifecycle transition** — System creates the Owner's StaffMember
   record as part of sign-up; the invitee themself completes their own StaffMember creation by
   accepting an Invitation; Owner or Admin deactivates a StaffMember (not explicitly in Deliverable
   A's flows, but implied by `/dashboard/staff` existing as a management screen — flagged as an
   assumption).
7. **Validation rules** — exactly one Role from {owner, admin, practitioner, receptionist}
   (ADR-0004); exactly one email.
8. **Business rules** — a Clinic must always have at least one Owner (no flow addresses removing
   the last owner; treated here as forbidden by default, since nothing describes clinic
   ownership transfer).
9. **Data classification** — Personal Data (an identifiable staff member's name, email, role).

## Invitation

1. **Why it exists** — a StaffMember cannot exist before the invitee has accepted; the period
   between "Owner/Admin sends an invite" and "invitee sets a password" needs its own identity,
   because it can expire or be duplicated independently of any StaffMember record.
2. **Which user flow requires it** — "Inviting a staff member" (`docs/product/03-user-flows.md`);
   `/dashboard/staff` explicitly lists "pending invite" as distinct from an active staff member.
3. **Aggregate owner** — Aggregate Root of its own aggregate.
4. **Tenant ownership** — belongs to exactly one Clinic (the inviting one).
5. **Lifecycle** — Pending → Accepted, or Pending → Expired.
6. **Actor responsible for every lifecycle transition** — Owner or Admin creates it (Pending);
   the invitee transitions it to Accepted; System transitions it to Expired with the passage of
   time.
7. **Validation rules** — single-use: cannot be Accepted twice; cannot be Accepted once Expired.
   Must specify exactly one Role for the invitee-to-be.
8. **Business rules** — an email already invited or already a StaffMember of the same Clinic
   cannot receive a second Pending Invitation (flow's "already invited/member" branch).
9. **Data classification** — Personal Data (an invitee's email and assigned role).

## Patient

1. **Why it exists** — the subject of every Conversation and Appointment; explicitly a record,
   never an authenticated user (charter §7, `docs/product/01-personas.md`).
2. **Which user flow requires it** — every patient-facing flow in `docs/product/03-user-flows.md`;
   `/dashboard/patients` and `/dashboard/patients/[id]`.
3. **Aggregate owner** — Aggregate Root of its own aggregate.
4. **Tenant ownership** — belongs to exactly one Clinic (Candidate ADR 1 in `00-overview.md`) — the
   same real person messaging two clinics on the platform is two separate Patient records.
5. **Lifecycle** — Created (on first message or first staff-entered booking) → Active. No flow
   describes archiving a Patient; erasure is addressed conceptually in
   [`06-multi-tenancy.md`](./06-multi-tenancy.md), not as a lifecycle state here.
6. **Actor responsible for every lifecycle transition** — System creates a Patient record the
   first time a message arrives from a previously unknown contact (per the booking/escalation
   flows); Receptionist, Admin, or Owner can also create one directly ("select or create patient
   record" in the appointment flow).
7. **Validation rules** — must have at least one contact channel (a PhoneNumber, per the WhatsApp-
   oriented flows) before a Conversation or Appointment can reference it.
8. **Business rules** — a Patient record is never granted a session or credentials, under any
   circumstance (charter §7; this is a hard constraint, not a default).
9. **Data classification** — Personal Data at minimum; see
   [`06-multi-tenancy.md`](./06-multi-tenancy.md) for why a Patient's associated Conversations may
   escalate this to GDPR Article 9 Special Category Data in practice.

## Conversation

1. **Why it exists** — the unit of patient communication the assistant and staff both act on; every
   escalation and booking-via-chat flow is expressed as something happening _within_ one.
2. **Which user flow requires it** — "A patient conversation ending in a booking" and "A patient
   conversation that must escalate to a human" (`docs/product/03-user-flows.md`);
   `/dashboard/conversations` and `/dashboard/conversations/[id]`.
3. **Aggregate owner** — Aggregate Root of its own aggregate; contains Message and Escalation as
   internal entities (see [`02-aggregates.md`](./02-aggregates.md)).
4. **Tenant ownership** — belongs to exactly one Clinic, via its Patient.
5. **Lifecycle** — Assistant-handling → Needs-staff → Resolved, with Needs-staff reachable again
   after Resolved if the Patient writes again (assumption; see Questions Remaining #6 in
   `00-overview.md` about whether this can also happen automatically).
6. **Actor responsible for every lifecycle transition** — Assistant transitions Assistant-handling
   → Needs-staff (an Escalation is always raised at the same time, see Escalation below);
   Receptionist, Admin, or Owner transitions Needs-staff → Resolved by replying and closing it out;
   Patient's message is what can reopen a Resolved conversation.
7. **Validation rules** — belongs to exactly one Patient; must contain at least one Message at all
   times once created (`06-acceptance-criteria.md`: "always ≥1 message").
8. **Business rules** — status must always agree with Escalation history: never Needs-staff with no
   open Escalation, never Resolved while an Escalation is still open (this is the aggregate's
   invariant — see `02-aggregates.md`).
9. **Data classification** — GDPR Article 9 Special Category Data by default. Even though the
   product principle restricts the Assistant to administrative topics (charter §3), the Patient is
   free-text and may describe symptoms or conditions regardless of what's asked; the model treats
   Conversation content as potentially health-related unless proven otherwise, not the reverse.

## Message

1. **Why it exists** — a Conversation is a sequence of individual messages; "read the full
   conversation" (`06-acceptance-criteria.md`) requires an ordered, attributable history.
2. **Which user flow requires it** — every conversation flow; `/dashboard/conversations/[id]`.
3. **Aggregate owner** — internal entity of the Conversation aggregate; has no independent identity
   outside it.
4. **Tenant ownership** — inherits its Conversation's Clinic; never referenced or queried across
   Conversations from a different Clinic.
5. **Lifecycle** — Sent. (Messages are not edited or withdrawn in any flow; once sent, immutable.)
6. **Actor responsible for every lifecycle transition** — Patient, Assistant, Receptionist, Admin,
   or Owner (whoever sends it); Practitioner never sends a Message
   (`docs/adr/0004-staff-role-model.md`: read-only on conversations).
7. **Validation rules** — must have exactly one sender and non-empty content.
8. **Business rules** — immutable once created; a failed send (backend unavailable) never produces
   a persisted Message — the acceptance criteria are explicit that an unsent message is not lost
   from the sender's input, meaning it was never recorded as sent.
9. **Data classification** — GDPR Article 9 Special Category Data by default, for the same reason
   as Conversation: content is unconstrained free text from a Patient.

## Escalation

1. **Why it exists** — charter §3's clinical refusal and charter §6's "agents propose, humans
   decide" both require that _why_ a Conversation needed a human survive as evidence, not just
   that it currently does (see Modelling decision 2 in `00-overview.md`).
2. **Which user flow requires it** — "A patient conversation that must escalate to a human"
   (`docs/product/03-user-flows.md`); the Clinical-refusal acceptance criteria in
   `06-acceptance-criteria.md`.
3. **Aggregate owner** — internal entity of the Conversation aggregate.
4. **Tenant ownership** — inherits its Conversation's Clinic.
5. **Lifecycle** — Raised → Acknowledged → Closed.
6. **Actor responsible for every lifecycle transition** — Assistant raises it (clinical question,
   medical emergency, ungroundable answer, or explicit patient request for a human — the four
   reasons named in the escalation flow); Receptionist, Admin, or Owner acknowledges and closes it
   by replying; for the medical-emergency reason specifically, the flow shows the Assistant acting
   alone (directing to emergency services) with no staff acknowledgement step before the Patient
   gets a response — this Escalation is Raised and immediately informational, not blocking a reply.
7. **Validation rules** — must record exactly one reason from the fixed set: clinical-question,
   medical-emergency, ungroundable-answer, patient-requested-human (assumption; see Questions
   Remaining — no flow names a fifth reason, but none guarantees these four are exhaustive either).
8. **Business rules** — a Conversation cannot be Resolved while it has an open (Raised or
   Acknowledged, not yet Closed) Escalation.
9. **Data classification** — Personal Data at minimum, since the reason field alone can indicate a
   Patient asked a clinical question; treated the same as Conversation for handling purposes.

## Appointment

1. **Why it exists** — the object every booking flow, journey, and screen is ultimately building
   toward; see the Domain Glossary for how this model distinguishes "Appointment" (the entity)
   from "Booking" (the act of creating one).
2. **Which user flow requires it** — "Creating and rescheduling an appointment" and "A patient
   conversation ending in a booking" (`docs/product/03-user-flows.md`); every
   `/dashboard/appointments*` screen.
3. **Aggregate owner** — Aggregate Root of its own aggregate.
4. **Tenant ownership** — belongs to exactly one Clinic; references a Patient, a Service, and a
   StaffMember (as practitioner) that must all belong to that same Clinic (see
   [`04-relationships.md`](./04-relationships.md)).
5. **Lifecycle** — Booked → Rescheduled (returns to Booked with a new TimeSlot) → Cancelled, or
   Booked → Completed. (Completed is implied by the practitioner's schedule-checking journey but
   not an explicit flow step — flagged as an assumption.)
6. **Actor responsible for every lifecycle transition** — Receptionist, Admin, or Owner create and
   modify it directly from the dashboard; Assistant creates it on a Patient's behalf during a
   booking conversation; Practitioner never transitions it (view-only, ADR-0004).
7. **Validation rules** — references exactly one Patient, one Service, one Practitioner
   (StaffMember with role practitioner), and one TimeSlot.
8. **Business rules** — no two non-Cancelled Appointments for the same Practitioner may have
   overlapping TimeSlots (the aggregate's invariant, protecting against the double-booking every
   practitioner persona fears); a Cancelled or past Appointment cannot be rescheduled
   (`06-acceptance-criteria.md`).
9. **Data classification** — Personal Data (links an identifiable Patient to a time, a service,
   and a practitioner); the Service referenced may elevate this to GDPR Article 9 Special Category
   Data when the service name itself is health-revealing (see Service, above, and this
   deliverable's PR description).

## KnowledgeDocument

1. **Why it exists** — "the documents the assistant is allowed to answer from"
   (`docs/product/05-screen-inventory.md`) must be something staff manage as a first-class thing,
   not an attribute of Clinic.
2. **Which user flow requires it** — "Uploading a knowledge document" (`docs/product/03-user-flows.md`);
   `/dashboard/knowledge-base` and `/dashboard/knowledge-base/upload`.
3. **Aggregate owner** — Aggregate Root of its own aggregate.
4. **Tenant ownership** — belongs to exactly one Clinic; never shared across clinics (no flow
   suggests a template/shared-library concept, so none is modeled).
5. **Lifecycle** — Processing → Ready, or Processing → Failed (rejected file type/size are caught
   before this lifecycle begins, per the upload flow's validation branches).
6. **Actor responsible for every lifecycle transition** — Owner or Admin uploads it (Processing);
   System transitions it to Ready or Failed.
7. **Validation rules** — file type and size must be within limits before upload is accepted (flow's
   pre-upload validation branches).
8. **Business rules** — the Assistant may only draw on a document while it is Ready
   (`docs/product/03-user-flows.md`: "assistant can draw on this document" only after Ready).
9. **Data classification** — Operational Data as a rule, with a standing risk (see this
   deliverable's PR description) that a clinic could upload a document containing patient
   information by mistake, which this model cannot prevent structurally — only flag.
