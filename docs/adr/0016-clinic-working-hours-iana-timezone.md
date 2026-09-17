# 0016 — Clinic working hours are interpreted in the clinic's IANA timezone

## Status

Proposed

## Date

2026-09-17

## Phase

P4 — Appointments (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — per the charter's ADR policy,
this class of decision requires an ADR and Ahmed's approval, recorded as a human comment on the pull
request, before dependent code is merged. `clinics.working_hours` and `staff_members.working_hours`
are bare `jsonb` columns (`db/migrations/0003_clinics.sql`, `0005_staff_members.sql`) with no
enforced shape and no timezone semantics defined anywhere before this ADR. [PR
#54](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/54) is the first code to give
that column's contents a concrete meaning, and it currently interprets each day's `HH:MM` window as
a literal UTC wall-clock time (`src/features/appointments/schedule.ts`). Once real clinic schedule
data is written under that interpretation, correcting it to a clinic-local interpretation later is
not a code change alone — it requires deciding, for every already-persisted `working_hours` value,
what wall-clock time was actually meant, and migrating or reinterpreting that data. That is exactly
the cost a one-way-door decision is supposed to be caught before, not after.

## Context

P4 Slice 1 needs to compute available appointment slots from a clinic's (and optionally a
practitioner's) working hours. Nothing before this phase ever read or wrote
`working_hours`, so no prior migration or shipped code constrains its JSON shape or how its
`HH:MM` values should be interpreted:

- `db/migrations/0003_clinics.sql`: `working_hours jsonb NOT NULL DEFAULT '{}'::jsonb` — a bare
  JSONB column, no CHECK constraint, no documented encoding.
- `db/migrations/0005_staff_members.sql`: `working_hours jsonb` (nullable, "clinic default
  applies") — same situation.
- [`docs/domain/03-value-objects.md`](../domain/03-value-objects.md)'s WorkingHours entry describes
  the value object in prose ("for each day, either a single open interval... or a marker that the
  Clinic is closed that day") but names no concrete JSON encoding and no timezone frame.

PR #54's `src/features/appointments/schedule.ts` is the first code to fill that gap, and it filled
it by treating a day's `{ start, end }` window as literal UTC wall-clock time — i.e., a clinic
whose `working_hours` says `{ thursday: { start: "09:00", end: "17:00" } }` is available
9:00–17:00 UTC, not 9:00–17:00 in the clinic's own local time. That was recorded in that PR as an
ordinary technical-design decision, on the reasoning that it only fixes how an already-described
value object is encoded, not a new business rule.

On inspection, that framing does not hold. A clinic's staff read and enter "9 AM to 5 PM" meaning
their own local wall-clock day, not UTC — this product's own domain language (`docs/domain/`) never
mentions UTC to a clinic user. A UTC-literal interpretation is silently wrong for almost every real
clinic (this platform's stated market is Arab-world clinics, per
[`docs/01-project-plan.md`](../01-project-plan.md) and [`CLAUDE.md`](../../CLAUDE.md), none of which
sit in UTC+0 year-round), and the error is not visible in code or tests — it only surfaces as staff
seeing available slots at the wrong hour once a real clinic's hours are entered. And per the Impact
section above, once real `working_hours` values exist under one interpretation, changing the
interpretation later silently changes what every existing value means. That combination — a
plausible-looking default that is wrong for the product's actual users, invisible until real data
exists, and expensive to correct after the fact — is a one-way-door decision, not a reversible
technical-design choice, and P4 must not depend on it without Ahmed's sign-off.

## Decision

1. **Clinic working hours are wall-clock schedule values**, not absolute instants. A `working_hours`
   entry such as `{ start: "09:00", end: "17:00" }` describes a time of day as clinic staff would
   read it off a clock on the wall of that clinic, not a UTC time.
2. **Wall-clock working-hour values are interpreted in the clinic's own IANA timezone.** The same
   `09:00` means a different absolute instant depending on which clinic it belongs to.
3. **The clinic therefore needs a persisted IANA timezone attribute**, as part of P4's schedule
   model. This ADR does not fix its exact column name, nullability, or migration mechanics — those
   are ordinary technical-design details for the implementing migration, not decided here — but it
   does fix that this attribute exists, is scoped to the Clinic (not to a Practitioner, a schedule
   entry, or any other resource), and is a first-class part of what "the clinic's schedule" means
   going forward.
4. **The attribute is a standard IANA timezone identifier** (e.g. `Africa/Cairo`, `Asia/Dubai`,
   `Europe/Istanbul`), never a fixed numeric UTC offset. A numeric offset cannot express DST
   transitions correctly and silently drifts wrong twice a year in any zone that observes them; an
   IANA identifier is unambiguous and lets the platform (PostgreSQL's own timezone database) resolve
   the correct offset for any given date.
5. **Appointment `starts_at`/`ends_at` remain exactly what P4 addendum S1 and this PR's migration
   already establish**: absolute instants stored as `timestamptz`, using the existing UTC/timestamptz
   convention every other timestamp column in this schema already follows
   (`db/migrations/0011_appointments.sql`). This ADR does not touch that — it only changes how a
   clinic's _working-hours_ wall-clock values are converted into those instants at availability-
   computation time. An Appointment's stored interval is never itself clinic-local; only the
   `working_hours` input to computing candidate slots is.
6. **Availability computation converts persisted clinic-local working hours into absolute
   appointment intervals** using the clinic's IANA timezone attribute and the platform/database's
   own timezone-conversion support (e.g., PostgreSQL's `AT TIME ZONE` / `timezone()` construct, or
   an equivalent standard-library IANA-aware conversion in application code) — never a custom-built
   offset table or hand-rolled DST calculation. DST transitions, and any other timezone-rule change,
   are handled by staying current with the platform's IANA timezone database (`tzdata`), not by this
   codebase inventing its own rules.
7. **Explicitly out of scope for this decision** (per the owner's ruling, unchanged from the
   original ask):
   - Practitioner-specific timezones. A practitioner's own `working_hours` override (already
     supported structurally by `staff_members.working_hours`, per
     [`docs/domain/01-entities.md`](../domain/01-entities.md)'s StaffMember #8) is interpreted in
     the _same clinic's_ IANA timezone, not a timezone of its own.
   - Timezone history (recording that a clinic changed its timezone at some point, or reinterpreting
     old data as of the timezone in effect when it was entered).
   - A custom timezone table, lookup service, or offset engine of any kind.
   - Hospital, multi-site, or organization-level timezone architecture (a clinic with locations in
     more than one timezone is not modeled — this platform's tenant is a single Clinic, per
     ADR-0003).
   - Multi-timezone scheduling workflows (e.g., letting one clinic view another clinic's slots
     converted to its own local time).

## Unresolved: what timezone existing clinics get

**This is not decided by this ADR and is not this ADR's author's to decide.** It is recorded here,
explicitly, as an open question for Ahmed, per the instruction that produced this draft: do not
assume a timezone for existing clinics merely because of where the current deployment happens to run.

The question: today, `clinics.working_hours` is `NOT NULL DEFAULT '{}'::jsonb`
(`db/migrations/0003_clinics.sql`) and no clinic in any environment has ever had a real value written
to it — no application code path writes it yet (confirmed by inspection: no migration after 0003,
and no `src/**` code before this PR, ever reads or writes `clinics.working_hours`). So this is not
strictly a data-migration problem in the sense of reinterpreting existing wall-clock values — no real
values exist yet in any deployed environment. It _is_ a design question of what a newly required
timezone attribute defaults to (or whether it is required at all, with no default) for a clinic row
that predates this ADR's schema change. Options, with their costs:

- **No default; the column is `NOT NULL` with no `DEFAULT`, and the migration backfills nothing.**
  Existing clinic rows (if any exist in a deployed environment by the time this migration runs) would
  fail the `NOT NULL` constraint unless backfilled first. Safest in the sense of forcing an explicit
  choice per clinic, but requires knowing, per environment, whether any clinic rows already exist
  before this migration can even be written safely — that fact is not known at ADR-drafting time and
  must be checked against each real deployment (production included) before implementation, not
  assumed.
- **A backfill to one specific IANA zone for all pre-existing rows** (e.g., the zone most of this
  platform's stated market sits in). Simplest to implement, but is exactly the "assume a timezone
  because of where the deployment happens to sit" reasoning this task was explicitly told not to do
  on its own initiative — silently wrong for any pre-existing clinic outside that zone, with no
  record that the value was guessed rather than entered.
- **Nullable column, `NULL` meaning "not yet configured," with availability computation refusing to
  compute slots (or falling back to some explicitly-labeled behavior) until a clinic's owner sets
  it.** Avoids guessing, but changes P4's own availability contract (what `GET
/api/appointments/availability` returns for a clinic with no timezone set) — a decision with its
  own consequences this ADR does not evaluate.

Whichever option is chosen, and the exact default/migration behavior for existing clinics, is
explicitly deferred to the owner and must be recorded (either as an addition to this ADR before it is
Accepted, or as its own follow-up decision) before the implementing migration is written.

## Consequences

Easier:

- Clinic staff enter and read working hours in the time they actually experience, matching how every
  other part of this product already talks to them (in their own language and, implicitly, their own
  day) — `GET /api/appointments/availability` returns slots that mean what a receptionist expects
  them to mean.
- Future practitioner-level or multi-site timezone needs, if ever required, build on a
  clinic-timezone concept that already exists, rather than retrofitting one onto data that assumed
  none.

Harder:

- Availability computation (`src/features/appointments/schedule.ts`,
  `getWindowForDate`/`computeAvailableSlots`) must convert clinic-local wall-clock windows to UTC
  instants using the clinic's IANA timezone before comparing against `appointments.starts_at`/
  `ends_at`, rather than the direct UTC-literal parsing PR #54 currently does — a real (if
  well-trodden) implementation surface, not a one-line change.
- Every place that reads `working_hours` needs the owning clinic's timezone attribute in scope, not
  just the JSON blob itself.

Forecloses:

- Treating `working_hours` values as directly comparable UTC instants anywhere in the codebase going
  forward — PR #54's current `schedule.ts` implementation and its header comment (which attributes
  the UTC-literal interpretation to "P4's addendum S1... no clinic-local timezone architecture in
  P4," and to a S1 addendum item that in fact only concerned `timestamptz`/`tstzrange` for
  `appointments`, not `working_hours`) must be corrected once this ADR is Accepted — tracked as a
  known documentation inaccuracy in PR #54, not fixed by this ADR itself (see that PR's own report
  for the exact locations).

## Alternatives considered

- **Keep the UTC-literal interpretation PR #54 shipped.** Simplest, no new column, no conversion
  logic. Rejected: silently wrong for every clinic not in UTC+0, invisible until real schedule data
  exists, and — per the Impact section — expensive to correct once real data does exist. This is the
  status quo this ADR exists to replace.
- **A fixed numeric UTC offset per clinic instead of an IANA identifier** (e.g., `+02:00`). Simpler
  to store and reason about than a named zone. Rejected per ruling item 4: it cannot express DST
  transitions, so a clinic in any zone that observes DST would have wrong availability for roughly
  half the year, silently, with no record that anything is wrong — exactly the class of failure this
  ADR exists to avoid.
- **Practitioner-level timezones instead of, or in addition to, a clinic-level one.** Would let a
  telehealth practitioner in a different zone from their clinic set their own hours correctly.
  Rejected for P4 per the owner's explicit ruling item 5 — out of scope; a practitioner's own
  `working_hours` override is interpreted in their clinic's timezone, not a timezone of its own. Left
  open for a future ADR if a real need for it appears.
- **A custom timezone/offset table or hand-written DST calculation.** Would avoid depending on the
  platform's `tzdata`. Rejected per ruling item 8: PostgreSQL (and every mainstream language runtime)
  already ships a maintained IANA timezone database; reimplementing that is pure risk with no
  benefit, and this codebase has no reason to become the source of truth for global DST rules.
