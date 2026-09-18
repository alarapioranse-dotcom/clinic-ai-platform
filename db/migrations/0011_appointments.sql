-- Roadmap P4 Slice 1 ("persisted schedule -> compute available slots at read
-- time -> select a slot -> book appointment -> persist appointment ->
-- optionally link to its originating conversation -> return the booked
-- appointment"). Implements the invariant ADR-0014 (Accepted) requires and
-- the reschedule mechanism ADR-0015 (Accepted) requires, plus the P4 design
-- decisions the owner closed on top of both (see this PR's description):
-- reschedule is UPDATE-in-place (no new migration concern beyond what
-- ADR-0015 already describes — this migration just needs to allow ordinary
-- UPDATE on the row); the appointments <-> conversations relationship is a
-- structural composite FK, not an application-level check; the EXCLUDE key
-- is scoped to (clinic_id, practitioner_id, overlapping active interval);
-- and this table's own starts_at/ends_at remain plain UTC timestamptz
-- instants regardless of any clinic-local timezone (ADR-0016, implemented in
-- db/migrations/0012_clinic_timezone.sql, only changes how a clinic's
-- working_hours wall-clock values are converted into those instants at
-- availability-computation time — it does not touch this table's storage).
--
-- No new "schedule" table: docs/domain/03-value-objects.md's WorkingHours
-- value object is already persisted, per-clinic, on `clinics.working_hours`
-- (0003_clinics.sql, NOT NULL DEFAULT '{}'::jsonb) with an optional
-- per-practitioner override on `staff_members.working_hours`
-- (0005_staff_members.sql, nullable = "clinic default applies",
-- docs/domain/01-entities.md's StaffMember #8). Both columns already carry
-- the `app_user` grants this slice's availability read needs
-- (`clinics`: `GRANT SELECT (id, name, status, working_hours), ...` in
-- 0008_revoke_clinics_insert.sql's predecessor 0003; `staff_members`:
-- `GRANT SELECT, INSERT, UPDATE` in 0005) — reusing this existing schedule
-- persistence is "the existing repository architecture," not inventing a
-- parallel one. No `available_slots` table: availability is computed at
-- read time by src/features/appointments (schedule.ts + repository.ts),
-- never persisted.
--
-- S1 (timestamp representation): every timestamp column below is
-- timestamptz, matching migrations 0001-0010 without exception, so the
-- EXCLUDE constraint's range function is tstzrange, not tsrange —
-- docs/technical/01-database-schema.md's illustrative `appointments` DDL
-- uses tsrange against timestamptz columns, which is a pre-existing type
-- mismatch in that doc; that section is corrected in this same PR to match
-- this migration, per the charter's Definition of Done.
--
-- S3 (extension placement): btree_gist is required only starting with this
-- migration (the no-double-booking EXCLUDE constraint below), so it is
-- created here, not added to the already-shipped 0001_extensions.sql.
-- Verified trusted on the target production PostgreSQL 16 host, so no
-- superuser is required for this CREATE EXTENSION and no fallback mechanism
-- exists in this design (owner-approved P4 Design Gate).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- S5 (altering a shipped table): `conversations` is live in production
-- (P3-A/P3-B/P3-C are merged and running migrations 0001-0010 per
-- CLAUDE.md's Status section). This adds a second UNIQUE constraint
-- alongside the existing `conversations_id_key UNIQUE (id, clinic_id)`
-- (0009_conversations.sql) — it does not replace or narrow that one.
-- `conversations.patient_id` is `NOT NULL` (0009_conversations.sql), and
-- `id` is already globally unique via the PRIMARY KEY, so `(id, patient_id)`
-- is trivially unique for every existing row: this ALTER TABLE cannot reject
-- any row already committed and requires no backfill or cleanup.
-- Owner decision 2 (P4 Design Gate): a structural composite FK
-- `appointments (conversation_id, patient_id) -> conversations (id,
-- patient_id)` is what makes "an appointment's optional conversation
-- belongs to the same patient" a database-enforced impossibility to violate
-- rather than an application-level check — this UNIQUE constraint is the
-- target that composite FK (below) requires to exist.
ALTER TABLE conversations ADD CONSTRAINT conversations_id_patient_key UNIQUE (id, patient_id);

CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  patient_id       uuid NOT NULL,
  practitioner_id  uuid NOT NULL,
  -- Nullable: an appointment need not originate from a conversation (owner
  -- decision 2). S2 (nullable composite FK): the composite FK below uses
  -- PostgreSQL's default MATCH SIMPLE semantics (no MATCH FULL/PARTIAL
  -- keyword is specified), under which the FK is not checked at all when
  -- conversation_id IS NULL — MATCH FULL would incorrectly reject every
  -- appointment booked without a conversation, since patient_id is NOT NULL
  -- but conversation_id would be NULL in that case, and MATCH FULL requires
  -- either all or none of a composite FK's columns to be NULL.
  conversation_id  uuid,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  -- ADR-0014's four-state lifecycle exactly: booked (initial), rescheduled
  -- (booked/rescheduled -> rescheduled, interval replaced in place per
  -- ADR-0015), cancelled (terminal), completed (terminal). No no_show,
  -- pending, or confirmed state — ADR-0014 explicitly rules those out.
  status           text NOT NULL DEFAULT 'booked'
                     CHECK (status IN ('booked', 'rescheduled', 'cancelled', 'completed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Reschedule (ADR-0015) is UPDATE-in-place: starts_at/ends_at/status
  -- change on the same row, so unlike conversations/messages/patients this
  -- table is mutated after creation — updated_at follows the same explicit
  -- `updated_at = now()` convention docs/technical/01-database-schema.md's
  -- Clinic aggregate section already uses (no trigger, set by the
  -- application in the same UPDATE statement that moves status).
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- ADR-0014 point 6, independent of and in addition to the EXCLUDE
  -- constraint below: zero-duration appointments are never valid, even for
  -- a moment. ADR-0014 point 7: half-open [start, end) — expressed by the
  -- EXCLUDE constraint's tstzrange(..., '[)'), not by this CHECK.
  CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at),

  -- Same-clinic references, same structural pattern as
  -- conversations_patient_same_clinic (0009) and
  -- messages_sender_staff_same_clinic (0010): a cross-clinic patient_id or
  -- practitioner_id is rejected by the database itself, not trusted from
  -- application code.
  CONSTRAINT appointments_patient_same_clinic
    FOREIGN KEY (patient_id, clinic_id) REFERENCES patients (id, clinic_id),
  CONSTRAINT appointments_practitioner_same_clinic
    FOREIGN KEY (practitioner_id, clinic_id) REFERENCES staff_members (id, clinic_id),

  -- Owner decision 2 + S2: structural "conversation belongs to the same
  -- patient" enforcement. MATCH SIMPLE (default, no keyword needed): a NULL
  -- conversation_id skips this check entirely, exactly the nullable case
  -- Slice 1 must support (an appointment with no originating conversation).
  -- This does not separately need a same-clinic check: patient_id already
  -- structurally ties this appointment to clinic_id (above), and a Patient
  -- belongs to exactly one Clinic for its lifetime
  -- (docs/technical/01-database-schema.md's `patients` section) — so a
  -- conversation whose patient_id matches this appointment's patient_id is
  -- transitively guaranteed to be the same clinic's conversation too.
  CONSTRAINT appointments_conversation_same_patient
    FOREIGN KEY (conversation_id, patient_id) REFERENCES conversations (id, patient_id)
);

-- Same rationale as every other clinic_id-prefixed index in this schema:
-- Postgres does not automatically index foreign-key columns, and every
-- RLS-filtered query on this table filters by clinic_id; the appointments
-- feature's own queries (availability's busy-interval read, and any future
-- per-practitioner listing) additionally filter by practitioner_id.
CREATE INDEX appointments_clinic_practitioner_idx ON appointments (clinic_id, practitioner_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- ADR-0014's hard invariant, the one piece of DDL here doing genuine work no
-- application-level check-then-insert could do safely (ADR-0014 point 8):
-- two concurrent booking requests for the same practitioner/overlapping
-- interval can both pass an application-level availability check before
-- either commits — this EXCLUDE constraint is what PostgreSQL itself
-- rejects the second write with, atomically, and it is what the appointments
-- feature's booking path (src/features/appointments/repository.ts) catches
-- and translates to HTTP 409.
--
-- Owner decision 3 (P4 Design Gate): the exclusion key includes clinic_id
-- (not just practitioner_id) — the invariant is scoped to "same clinic +
-- same practitioner + overlapping active interval," expressed explicitly in
-- terms of clinic_id rather than relying on staff_members.id's global
-- uniqueness (id is that table's PRIMARY KEY, so it already is globally
-- unique) to imply the same scoping incidentally. staff_members_id_key
-- UNIQUE (id, clinic_id) exists for a different reason: it is the composite
-- target appointments_practitioner_same_clinic (above) references, the same
-- "safe by construction" composite-FK pattern used throughout this schema —
-- not evidence that id itself could collide across clinics.
--
-- Active states are exactly 'booked' and 'rescheduled' (ADR-0014 points 2-4):
-- 'cancelled' and 'completed' appointments never conflict with anything,
-- regardless of what interval they held. Rescheduling (ADR-0015) is
-- UPDATE-in-place on this same row, so the constraint is re-checked against
-- the new interval by ordinary UPDATE/EXCLUDE semantics with no special
-- casing — the row's own prior interval is never compared against its own
-- new one (there is only one row).
--
-- tstzrange(..., '[)') is spelled out explicitly (S1) even though '[)' is
-- already PostgreSQL's default two-argument bound — ADR-0014 point 7's
-- half-open semantics is exactly this: an appointment ending at a given
-- instant does not conflict with another starting at that same instant.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking
  EXCLUDE USING gist (
    clinic_id WITH =,
    practitioner_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'rescheduled'));

-- Least-privilege grants for the application role. No DELETE: cancellation
-- and completion are status UPDATEs on the existing row (ADR-0014's
-- lifecycle, ADR-0015's update-in-place reschedule), matching the existing
-- architecture's pattern of never granting DELETE unless a slice explicitly
-- needs it (patients, conversations, messages all withhold it too).
GRANT SELECT, INSERT, UPDATE ON appointments TO app_user;
