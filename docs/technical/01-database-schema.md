# Database Schema

Illustrative PostgreSQL DDL only. No migration files are introduced by this deliverable, and
nothing here is meant to be run as-is — it is the shape a real migration should take once P1's
migration tooling exists. Every table below maps to exactly one entity in
[`docs/domain/01-entities.md`](../domain/01-entities.md); no table exists that isn't named there.

Extensions assumed available: `pgcrypto` (for `gen_random_uuid()`) and `btree_gist` (required by
the Appointment no-double-booking constraint below).

## Tenant isolation, applied uniformly

Per [ADR-0003](../adr/0003-multi-tenancy-model.md) and the denormalization choice recorded in
[`00-overview.md`](./00-overview.md), every table below except `clinics` itself carries a
`clinic_id uuid NOT NULL REFERENCES clinics(id)`, has `ROW LEVEL SECURITY` enabled, and carries the
same policy shape:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY; -- applies even to the table owner
CREATE POLICY tenant_isolation ON <table>
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

`current_setting('app.current_clinic_id', true)` is the illustrative mechanism used throughout
this document for "the current request's clinic, as PostgreSQL sees it." **How that session
variable actually gets set per request (and whether a session variable is the right mechanism at
all) is not decided by this deliverable** — see Open Question 1 in
[`07-open-questions.md`](./07-open-questions.md). If it is unset, `current_setting(..., true)`
returns `NULL`, `clinic_id = NULL` is never true, and the policy denies all rows — the fail-closed
behavior the isolation test in
[`02-tenant-isolation-testing.md`](./02-tenant-isolation-testing.md) relies on.

`FORCE ROW LEVEL SECURITY` matters specifically because the application's database role should
never be the table owner in production — but stating that intent here doesn't replace deciding it;
it's restated as part of Open Question 1.

## `clinics`

```sql
CREATE TABLE clinics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  contact_email    text,
  contact_phone    text,
  owner_email      text NOT NULL,
  status           text NOT NULL DEFAULT 'onboarding'
                     CHECK (status IN ('onboarding', 'active')),
  working_hours    jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clinic_has_contact_channel
    CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL),

  -- Composite unique target for other tables' composite foreign keys (see below).
  CONSTRAINT clinics_id_key UNIQUE (id)
);
```

- **No `clinic_id` column** — `clinics` is the tenant itself (per B: "is the tenant; not owned by
  another Clinic"). No RLS policy either: a clinic must be able to find its own row before any
  `app.current_clinic_id` context exists (e.g., during sign-up).
- **`clinic_has_contact_channel`** enforces B's validation rule ("must have a name and at least one
  contact channel before onboarding can complete") at the row level, not only in application code.
- `working_hours` holds the WorkingHours value object
  ([`docs/domain/03-value-objects.md`](../domain/03-value-objects.md)) as JSONB — a value object
  with no identity of its own is naturally embedded, not given its own table with a foreign key
  back to one clinic row.
- `timezone` is a standard IANA timezone identifier (e.g. `Africa/Cairo`), never a fixed numeric UTC
  offset, per [ADR-0016](../adr/0016-clinic-working-hours-iana-timezone.md) (Accepted):
  `working_hours`'s `HH:MM` values are clinic-local wall-clock times, interpreted in this zone. `NOT
NULL` with no `DEFAULT` — every clinic must explicitly supply its own
  (`db/migrations/0012_clinic_timezone.sql`), scoped to the Clinic only (no per-practitioner, -site,
  or historical timezone).

## `services`

```sql
CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  name             text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_amount     numeric(10, 2) NOT NULL CHECK (price_amount >= 0),
  price_currency   text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT services_id_key UNIQUE (id, clinic_id)
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- `duration_minutes` and `(price_amount, price_currency)` are ServiceDuration and Money
  ([`docs/domain/03-value-objects.md`](../domain/03-value-objects.md)) inlined as columns — both
  value objects with no independent identity, so no separate table.
- `services_id_key UNIQUE (id, clinic_id)` exists solely so `appointments` (below) can enforce
  "an Appointment's Service belongs to the same Clinic as the Appointment" with a composite foreign
  key, not a trigger.
- A Retired service is never deleted (B: "existing Appointments referencing it are unaffected") —
  enforced simply by there being no `DELETE` in the API contract for services, not a schema rule.

## `staff_members`

```sql
CREATE TABLE staff_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  email            text NOT NULL,
  role             text NOT NULL
                     CHECK (role IN ('owner', 'admin', 'practitioner', 'receptionist')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  working_hours    jsonb, -- NULL = clinic default applies; see docs/domain/01-entities.md
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_members_id_key UNIQUE (id, clinic_id),
  CONSTRAINT staff_members_email_key UNIQUE (email) -- global, not per-clinic; see note below
);

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_members
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- `role CHECK` enforces ADR-0004's fixed four-value set directly at the database layer — a
  StaffMember cannot exist with zero, two, or an out-of-set role, matching the StaffMember
  aggregate's stated invariant.
- `working_hours` nullable JSONB implements the Ahmed-approved override rule
  ([`docs/domain/01-entities.md`](../domain/01-entities.md)): `NULL` means "clinic default
  applies," not "invalid" — there is deliberately no `NOT NULL` here.
- "A Clinic must always have at least one Owner" (B, business rules) is **not** enforced by this
  schema — it constrains a _deletion/deactivation_ action, not a row's shape, and is enforced at
  the API layer (see [`03-api-contracts.md`](./03-api-contracts.md)): the deactivate-staff endpoint
  rejects deactivating the last active `owner` for a clinic inside the same transaction that would
  perform it.
- Credential storage (password hash, sessions) is **not** on this table — see
  [`04-auth-implementation.md`](./04-auth-implementation.md) for why that's kept separate and what
  it looks like.
- `staff_members_email_key` is a **global** `UNIQUE (email)`, not `UNIQUE (clinic_id, email)` —
  amended by [ADR-0012](../adr/0012-authentication-bootstrap-security-definer.md) (Decision 1,
  human-approved). The documented sign-in flow below resolves `{ email, password }` alone, with no
  clinic selector anywhere in the product; a per-clinic-only constraint would let the same email
  exist at two different clinics and make that lookup ambiguous.

## `invitations`

```sql
CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  email            text NOT NULL,
  role             text NOT NULL
                     CHECK (role IN ('owner', 'admin', 'practitioner', 'receptionist')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_by       uuid NOT NULL REFERENCES staff_members(id),
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invitation_accepted_at_matches_status
    CHECK (accepted_at IS NULL OR status = 'accepted')
);

-- At most one Pending invitation per (clinic, email) at a time — B: "an email already invited...
-- cannot receive a second Pending Invitation."
CREATE UNIQUE INDEX invitations_one_pending_per_email
  ON invitations (clinic_id, email)
  WHERE status = 'pending';

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- The partial unique index is the enforcement mechanism for B's "single-use... cannot be Accepted
  twice; cannot be Accepted once Expired" combined with the "no duplicate Pending invite" rule: a
  new Pending row for the same (clinic, email) can only be inserted once the prior one has moved to
  `accepted` or `expired`, because only `pending` rows compete for the index.
  Accept/expire transitions themselves (`pending → accepted`, `pending → expired`) are enforced at
  the API layer by only ever updating a row matched with `WHERE status = 'pending'` — an attempt to
  accept an already-`expired` or already-`accepted` row simply matches zero rows and the API
  returns a conflict, per [`03-api-contracts.md`](./03-api-contracts.md).
- "An email already... a StaffMember of the same Clinic cannot receive a second Pending
  Invitation" (the other half of the same business rule) is enforced at the API layer by checking
  `staff_members` for an existing active row with that email before inserting — not a schema
  constraint, since `invitations` and `staff_members` are separate aggregates by design (B,
  Invitation entity) and a cross-table `UNIQUE` constraint can't express "unique across two
  different tables."

## `patients`

```sql
CREATE TABLE patients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  phone_number          text,
  display_name          text,
  anonymised_at         timestamptz, -- set on ADR-0005 erasure; identifying columns nulled at the same time
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT patients_id_key UNIQUE (id, clinic_id),
  CONSTRAINT patient_has_contact_channel
    CHECK (anonymised_at IS NOT NULL OR phone_number IS NOT NULL)
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- No UPDATE grant on clinic_id is exposed anywhere in the API layer: B's "a Patient belongs to
-- exactly one Clinic for its entire lifetime" (Patient aggregate invariant) is enforced by there
-- being no code path that ever writes a different clinic_id onto an existing row, not by a
-- database trigger — see docs/domain/02-aggregates.md.
```

- `phone_number` holds the PhoneNumber value object as a plain column (format validation is
  application-layer, per B: "exact format validation is Deliverable C" — deferred further, to the
  API contract's request validation in [`03-api-contracts.md`](./03-api-contracts.md), not decided
  here).
- `anonymised_at` and the loosened `patient_has_contact_channel` check together implement
  [ADR-0005](../adr/0005-patient-erasure-strategy.md): on erasure, identifying columns
  (`phone_number`, `display_name`) are set to `NULL` and `anonymised_at` is stamped in the same
  transaction — the row survives (so `conversations`/`appointments` foreign keys stay valid for
  whichever of them are retained per ADR-0005's per-entity rules) but carries no identifying data
  and no reversible mapping back to it, matching ADR-0005's "no recoverable key... retained
  anywhere."

## `conversations`

```sql
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  patient_id       uuid NOT NULL,
  status           text NOT NULL DEFAULT 'assistant_handling'
                     CHECK (status IN ('assistant_handling', 'needs_staff', 'resolved')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversations_id_key UNIQUE (id, clinic_id),
  -- Added by db/migrations/0011_appointments.sql (P4 Slice 1), alongside the
  -- UNIQUE above, not replacing it: the target `appointments (conversation_id,
  -- patient_id) -> conversations (id, patient_id)` composite foreign key
  -- requires this. patient_id is NOT NULL and id is already globally unique
  -- via the PRIMARY KEY, so this addition rejects no existing row.
  CONSTRAINT conversations_id_patient_key UNIQUE (id, patient_id),
  -- Same-clinic reference: a Conversation's Patient must belong to the same Clinic
  -- (docs/domain/04-relationships.md: "safe by construction").
  CONSTRAINT conversations_patient_same_clinic
    FOREIGN KEY (patient_id, clinic_id) REFERENCES patients (id, clinic_id)
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- The composite foreign key `(patient_id, clinic_id) REFERENCES patients (id, clinic_id)` is what
  makes "a Conversation's Patient belongs to the same Clinic" a structural impossibility to violate
  rather than an application-code discipline: inserting a Conversation whose `clinic_id` doesn't
  match its Patient's `clinic_id` fails at the database, full stop.
- "Always contains at least one Message" is a cross-table invariant about _when_ a row becomes
  valid, not about this table's own columns — see the deferred trigger under `messages`, below.

## `messages`

```sql
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  conversation_id  uuid NOT NULL,
  sender_type      text NOT NULL
                     CHECK (sender_type IN ('patient', 'assistant', 'staff')),
  sender_staff_id  uuid, -- set iff sender_type = 'staff'; Practitioner never appears here (ADR-0004)
  content          text NOT NULL CHECK (length(content) > 0),
  sent_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_conversation_same_clinic
    FOREIGN KEY (conversation_id, clinic_id) REFERENCES conversations (id, clinic_id),
  CONSTRAINT messages_staff_id_matches_sender_type
    CHECK (
      (sender_type = 'staff' AND sender_staff_id IS NOT NULL) OR
      (sender_type <> 'staff' AND sender_staff_id IS NULL)
    )
  -- Messages are immutable once sent (B, business rules): no UPDATE grant is exposed on this
  -- table by the API layer beyond insert; there is no application code path that modifies a
  -- persisted Message.
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Enforces "a Conversation always has >= 1 Message" without forbidding the ordinary two-statement
-- flow (INSERT conversation, INSERT its first message) from happening in that order within one
-- transaction: the check runs once at COMMIT, not after each individual statement.
CREATE CONSTRAINT TRIGGER conversation_has_at_least_one_message
  AFTER INSERT OR DELETE ON messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_conversation_has_message();
-- assert_conversation_has_message() (illustrative body):
--   SELECT 1 FROM messages WHERE conversation_id = <affected id> LIMIT 1;
--   RAISE EXCEPTION if no row found.
```

- `sender_type` collapses B's five possible senders (Patient, Assistant, Receptionist, Admin,
  Owner) into `patient` / `assistant` / `staff`, with `sender_staff_id` pointing at the specific
  StaffMember for the `staff` case — this is a schema-normalization choice, not a domain one:
  which specific staff role sent a message is exactly what `staff_members.role` already records via
  the foreign key, so repeating it here would be redundant, not more correct. Practitioner never
  appears as a sender because the API layer never accepts a send-message request from a
  Practitioner session (ADR-0004: read-only) — the same defense-in-depth pattern as elsewhere in
  this document (schema constraint plus API-layer role check, not a schema `CHECK` that would need
  to duplicate the role table's contents).
- The deferred constraint trigger is what makes "always ≥1 message" enforceable at all: a plain
  `CHECK` constraint can't reference another table, and an immediate (non-deferred) trigger would
  reject the ordinary "create conversation, then insert its first message" sequence at the first
  statement. Deferring to commit-time lets both statements run in the intended order inside one
  transaction while still rejecting a transaction that commits a Conversation with zero Messages.

## `escalations`

```sql
CREATE TABLE escalations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  conversation_id  uuid NOT NULL,
  reason           text NOT NULL
                     CHECK (reason IN (
                       'clinical_question', 'medical_emergency',
                       'ungroundable_answer', 'patient_requested_human'
                     )),
  status           text NOT NULL DEFAULT 'raised'
                     CHECK (status IN ('raised', 'acknowledged', 'closed')),
  raised_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES staff_members(id),
  closed_at        timestamptz,
  closed_by        uuid REFERENCES staff_members(id),

  CONSTRAINT escalations_conversation_same_clinic
    FOREIGN KEY (conversation_id, clinic_id) REFERENCES conversations (id, clinic_id),
  CONSTRAINT escalation_timestamps_match_status CHECK (
    (status = 'raised' AND acknowledged_at IS NULL AND closed_at IS NULL) OR
    (status = 'acknowledged' AND acknowledged_at IS NOT NULL AND closed_at IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL)
  )
);

ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalations
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

### Enforcing "Conversation status must agree with Escalation history"

B's single most safety-relevant invariant (Conversation aggregate: never `needs_staff` with no
open Escalation, never `resolved` while one is still open) spans two tables, so it cannot be a
`CHECK` constraint on either alone. It is enforced with a trigger on `conversations`:

```sql
CREATE OR REPLACE FUNCTION assert_conversation_escalation_agreement()
RETURNS trigger AS $$
DECLARE
  open_escalation_count integer;
BEGIN
  SELECT count(*) INTO open_escalation_count
  FROM escalations
  WHERE conversation_id = NEW.id AND status <> 'closed';

  IF NEW.status = 'needs_staff' AND open_escalation_count = 0 THEN
    RAISE EXCEPTION 'conversation % cannot be needs_staff with no open escalation', NEW.id;
  END IF;

  IF NEW.status = 'resolved' AND open_escalation_count > 0 THEN
    RAISE EXCEPTION 'conversation % cannot be resolved with an open escalation', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER conversation_escalation_agreement
  AFTER INSERT OR UPDATE ON conversations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_conversation_escalation_agreement();
```

Deferred to commit-time for the same reason as the message-count trigger above: raising an
Escalation and moving its Conversation to `needs_staff` are two statements in one transaction, and
closing the last open Escalation and moving the Conversation to `resolved` are two more — the
invariant only needs to hold once the transaction is done, not between its individual statements.

## `appointments`

**This section now matches the real migration** — `db/migrations/0011_appointments.sql` (P4
Slice 1) — rather than only illustrating a future shape, per the charter's Definition of Done
("Documentation updated in the same pull request"). The DDL below was corrected in that same PR
from an earlier draft of this document that used `tsrange` against `timestamptz` columns, a
pre-existing type mismatch; the real migration always used `tstzrange` (P4 addendum S1: "every
timestamp column is `timestamptz`... without exception").

```sql
CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  patient_id       uuid NOT NULL,
  practitioner_id  uuid NOT NULL,
  conversation_id  uuid, -- nullable: an appointment need not originate from a conversation
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'booked'
                     CHECK (status IN ('booked', 'rescheduled', 'cancelled', 'completed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(), -- reschedule (ADR-0015) is UPDATE-in-place

  CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at), -- TimeSlot invariant

  -- Same-clinic references for every part the Appointment is assembled from
  -- (docs/domain/01-entities.md, Appointment #4 and #8). No `services` reference in P4
  -- (P4 Design Gate, owner decision 6: no service catalog in P4).
  CONSTRAINT appointments_patient_same_clinic
    FOREIGN KEY (patient_id, clinic_id) REFERENCES patients (id, clinic_id),
  CONSTRAINT appointments_practitioner_same_clinic
    FOREIGN KEY (practitioner_id, clinic_id) REFERENCES staff_members (id, clinic_id),

  -- Structural "conversation belongs to the same patient" enforcement (P4 Design Gate, owner
  -- decision 2), requiring `conversations` to expose `UNIQUE (id, patient_id)` in addition to its
  -- existing `UNIQUE (id, clinic_id)`. MATCH SIMPLE (the default — no keyword needed): a NULL
  -- conversation_id skips this check entirely, exactly the nullable case above requires (P4
  -- addendum S2) — MATCH FULL would incorrectly reject every appointment booked without a
  -- conversation.
  CONSTRAINT appointments_conversation_same_patient
    FOREIGN KEY (conversation_id, patient_id) REFERENCES conversations (id, patient_id)
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- No-double-booking: the hard invariant, approved by Ahmed (ADR-0014, Accepted) and refined by
-- ADR-0015 (Accepted, reschedule is UPDATE-in-place). Enforced atomically at the database layer
-- via an EXCLUDE constraint rather than an application-level "check then insert" (which has a
-- race window between the check and the insert under concurrent requests). btree_gist is created
-- in its own migration (P4 addendum S3), not in the already-shipped 0001_extensions.sql.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The exclusion key includes clinic_id (P4 Design Gate, owner decision 3): the invariant is
-- scoped to same clinic + same practitioner + overlapping active interval — practitioner_id alone
-- is only unique per-clinic (staff_members_id_key is a composite key), not globally exclusive to
-- one clinic. Active states are exactly 'booked' and 'rescheduled' (ADR-0014); 'cancelled' and
-- 'completed' never conflict.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking
  EXCLUDE USING gist (
    clinic_id WITH =,
    practitioner_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'rescheduled'));
```

- Two composite foreign keys tie the Appointment to its Clinic structurally — Patient and
  practitioner StaffMember must both match the Appointment's own Clinic — plus a third composite
  foreign key ties an optional Conversation to the same Patient; each reference is checked
  independently, structurally, rather than trusting that these inputs happened to come from the
  same clinic/patient context in application code.
- `ends_at > starts_at` is the TimeSlot value object's own invariant
  ([`docs/domain/03-value-objects.md`](../domain/03-value-objects.md): "start strictly before
  end"), inlined directly since TimeSlot has no identity of its own and lives entirely inside the
  Appointment aggregate boundary (B, Appointment aggregate: "Appointment alone, including its
  TimeSlot value object").
- The `EXCLUDE` constraint is the one piece of DDL in this document doing genuine, non-optional
  work no application-level check could replace safely: two concurrent requests both attempting to
  book the same practitioner for overlapping times will, without this constraint, both pass an
  application-level "is this slot free?" check before either has committed. It rejects the second
  `INSERT`/`UPDATE` outright, atomically, which is exactly "rejected outright at creation or
  reschedule time, never merely flagged as a warning" (B, Appointment business rules) — a
  reschedule is modeled as `UPDATE` on `starts_at`/`ends_at`/`status` in place (ADR-0015), and the
  same constraint covers it without separate logic: there is only ever one row per appointment for
  the constraint to compare against, so an appointment never conflicts with its own prior interval.
- Reflects [`docs/domain/02-aggregates.md`](../domain/02-aggregates.md)'s own boundary note: this
  invariant's true consistency scope is "all Appointments for one Practitioner within one Clinic,"
  which is exactly what an `EXCLUDE` constraint checks — across rows, not within one row — unlike
  every other constraint in this document.
- "A Cancelled or past Appointment cannot be rescheduled" (B, business rules) is enforced at the
  API layer, not here: it's a rule about which requests are accepted, not about what a stored row
  may look like (a cancelled Appointment's row is perfectly valid data; it's the reschedule
  _action_ that's refused). See [`03-api-contracts.md`](./03-api-contracts.md).
- No `available_slots` table: availability is computed at read time from `clinics.working_hours` /
  `staff_members.working_hours` plus this table's active rows — see
  `src/features/appointments/schedule.ts`. Per [ADR-0016](../adr/0016-clinic-working-hours-iana-timezone.md)
  (Accepted), those `working_hours` values are clinic-local wall-clock times, converted to the
  absolute `timestamptz` instants this table stores using the clinic's own `timezone`
  (`clinics.timezone`, `db/migrations/0012_clinic_timezone.sql`) — this table's own `starts_at`/
  `ends_at` remain plain UTC instants throughout; only that conversion step is clinic-local.

## `knowledge_documents`

```sql
CREATE TABLE knowledge_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  uploaded_by      uuid NOT NULL REFERENCES staff_members(id),
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  storage_key      text NOT NULL, -- see docs/technical/06-knowledge-document-storage.md
  status           text NOT NULL DEFAULT 'processing'
                     CHECK (status IN ('processing', 'ready', 'failed')),
  failed_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ready_at         timestamptz,

  CONSTRAINT knowledge_document_status_fields_match (
    (status = 'ready' AND ready_at IS NOT NULL) OR
    (status <> 'ready' AND ready_at IS NULL)
  ),
  CONSTRAINT knowledge_document_failed_reason_matches_status
    CHECK (status = 'failed' OR failed_reason IS NULL)
);

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_documents
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- Status only ever moves forward (`processing → ready` or `processing → failed`, never backward —
  B, KnowledgeDocument aggregate invariant) is enforced at the API layer: the status-transition
  endpoint only ever issues `UPDATE ... WHERE status = 'processing'`, so a document already `ready`
  or `failed` simply cannot be matched and moved again. A trigger could additionally guard this at
  the database layer (symmetric to the escalation-agreement trigger above); it's left to the API
  layer here because, unlike the Conversation/Escalation case, no other table's state depends on
  this one holding — a corrected file becomes a new row (B: "a corrected file is a new upload"),
  not an update path this schema needs to close off structurally.
- "The Assistant may only draw on a document while Ready" is explicitly **not** this table's
  invariant to enforce (B, KnowledgeDocument aggregate: "constrains how a _different_ system — the
  AI pipeline — may consume this aggregate's state") — see
  [`05-ai-pipeline.md`](./05-ai-pipeline.md), which filters retrieval to `status = 'ready'` at query
  time.
- Retrieval-time content storage (chunks, embeddings) is deliberately **not** a column or table
  here — see [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) for why that
  supporting structure is introduced separately, and Open Question 3 in
  [`07-open-questions.md`](./07-open-questions.md) for where it physically lives.

## Enforcing the Clinic aggregate's consistency invariant

Unlike every invariant above, "a Clinic's working hours and its service list are read and written
as one consistent unit" (B, Clinic aggregate) is not a structural rule about what a row may
contain — it's a rule about _when_ a change becomes visible to a reader. It is enforced by
transaction boundary, not schema:

```sql
BEGIN;
  UPDATE clinics SET working_hours = $1, updated_at = now() WHERE id = $2;
  -- any INSERT/UPDATE/status-change statements against `services` for the same clinic
  -- that are part of the same settings-save action
COMMIT;
```

Postgres's default `READ COMMITTED` isolation already guarantees that no other transaction can
observe the `clinics` row's new `working_hours` while a concurrent `services` write from the same
save action is still uncommitted (or vice versa) — the two writes become visible together, at
`COMMIT`, or not at all. This is stated explicitly here because it's easy to miss: nothing about
the table definitions above enforces it; the API layer's clinic-settings endpoint
([`03-api-contracts.md`](./03-api-contracts.md)) must wrap both writes in one transaction for the
guarantee to actually hold.
