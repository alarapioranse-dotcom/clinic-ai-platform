# 0014 — Appointment no-double-booking invariant and lifecycle

## Status

Accepted — 2026-09-12. Approved by the owner in a comment on
[PR #52](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/52).

## Date

2026-09-12

## Phase

P4 — Appointments (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — per the
charter's ADR policy, this class of decision requires an ADR and Ahmed's
approval, recorded as a human comment on the pull request, before dependent
code is written. Per [charter §8](../governance/project-charter.md)'s
Definition of Ready, "any one-way-door decision [a phase] relies on is already
Accepted" is a precondition — this ADR is the record that criterion needs
before P4's first migration can depend on this invariant.

## Context

[`docs/03-roadmap.md`](../03-roadmap.md)'s P4 acceptance criteria are silent
on double-booking:

> - Clinic schedules and available slots are modeled and persisted.
> - A conversation can be turned into a booked appointment.
> - The `appointments` feature owns slot-matching and booking logic behind its
>   public entry point.

None of the three bullets says whether two overlapping bookings for the same
practitioner are permitted, discouraged, or rejected outright.

Deliverable B states the no-double-booking rule as if already decided:
[`docs/domain/02-aggregates.md`](../domain/02-aggregates.md) calls it a "hard
invariant... Approved by Ahmed," under which "a conflicting Appointment is
rejected outright at the point of creation or reschedule, never merely
flagged as a warning a staff member can override." But the same deliverable's
own bookkeeping, [`docs/domain/00-overview.md`](../domain/00-overview.md)
("Candidate ADRs," row 5), lists this exact question — "Whether the
no-double-booking invariant on Appointment is a hard rule or an
overridable-by-staff warning" — as a decision Ahmed "has... approved in
substance" but that "still need[s] a written ADR record of their own."
Approved-in-substance is not Accepted: no ADR currently records this decision,
so nothing yet satisfies the charter's Definition of Ready for it.

This ADR exists to give that already-substance-approved decision a written,
Accepted-or-rejected record before P4's first migration depends on it, per
charter §10 and §16.

## Decision

1. **Overlapping time for the same practitioner is forbidden.** No two
   Appointments for the same practitioner, within the same clinic, may have
   overlapping time intervals. This is a hard invariant: a conflicting
   Appointment is rejected outright at the point of creation or reschedule,
   never merely flagged as a warning a staff member can override.
2. **The invariant applies only to appointments in an active lifecycle
   state.** "Active" means `booked` or `rescheduled` (see Lifecycle, below) —
   the two non-terminal states. Only active appointments participate in the
   conflict set a new or rescheduled booking is checked against.
3. **Cancelled appointments are excluded from the conflict set.** A
   `cancelled` appointment never conflicts with anything, regardless of when
   it was cancelled or what interval it held.
4. **Completed appointments are excluded from the conflict set.** A
   `completed` appointment has already occurred and never conflicts with a
   new or rescheduled booking.
5. **Rescheduling replaces the interval it is checked against, not the
   appointment's identity.** Rescheduling an appointment moves it to the
   `rescheduled` state and assigns it a new interval; the invariant is
   re-evaluated against that new interval exactly as it would be for a new
   booking. The appointment's prior interval stops participating in the
   conflict set the moment the reschedule is accepted — an appointment never
   conflicts with its own earlier interval. A `rescheduled` appointment
   remains part of the active conflict set for any other booking or
   reschedule attempted afterward; it does not become inert.
6. **Zero-duration appointments are not allowed.** An appointment's interval
   must have its start strictly before its end, independent of and in
   addition to the conflict check.
7. **Intervals are half-open: `[start, end)`.** An appointment ending at a
   given instant does not conflict with another appointment for the same
   practitioner beginning at that same instant. Back-to-back bookings with a
   shared boundary are permitted.
8. **The database is the ultimate concurrency authority.** Application-level
   slot-matching may compute and present availability to staff or an
   automated assistant, but it is advisory only: it runs against a read that
   can be stale by the time a write commits. Because two concurrent booking
   requests can both pass an application-level check before either has
   written its row, the invariant in points 1–7 must be enforced by Postgres
   itself, atomically, at the moment a conflicting write would otherwise be
   committed — not solely by an application-level check-then-insert. The
   specific enforcement mechanism (as a class: a database constraint capable
   of atomically rejecting a write whose time range overlaps an existing
   active appointment for the same practitioner — for example, a
   range-overlap exclusion constraint) is a technical-design decision for the
   P4 migration once this ADR is accepted; this ADR fixes the requirement
   that such a constraint exists and is authoritative, not its exact
   definition.

### Lifecycle

Exactly four states: `booked`, `rescheduled`, `cancelled`, `completed`.

- `booked` — the initial state of every appointment on creation. Non-terminal.
- `rescheduled` — reached from `booked` or `rescheduled` when the
  appointment's interval is changed. Non-terminal.
- `cancelled` — terminal. No further transitions are legal.
- `completed` — terminal. No further transitions are legal.

Legal transitions: `booked → rescheduled`, `booked → cancelled`,
`booked → completed`, `rescheduled → rescheduled`, `rescheduled → cancelled`,
`rescheduled → completed`. No other state and no other transition — in
particular, no `no_show`, `pending`, or `confirmed` state — is introduced by
this ADR.

## Consequences

- Accepting this decision pulls a practitioner reference and a status (or
  equivalent lifecycle-state) column into P4's first migration: the
  invariant in points 1–5 has no resource to key its conflict check on
  without a persisted practitioner identity per appointment, and no way to
  exclude `cancelled`/`completed` appointments from the conflict set without
  a persisted lifecycle state. Neither column's exact design (type,
  constraint syntax, naming) is decided here — that is P4 migration design,
  gated on this ADR's acceptance, not this ADR's content.
- Once accepted, this ADR is a precondition (per charter §8's Definition of
  Ready) for P4's first migration to include double-booking enforcement at
  all. If this ADR is not accepted before P4 code starts, P4's first slice
  may still ship — the roadmap's own acceptance criteria do not require
  conflict enforcement — but it would ship without the invariant in points
  1–8, and this decision would remain an unresolved Candidate ADR exactly as
  it is today.
- This ADR does not decide, and P4 migration design must still resolve
  separately: whether an appointment references the conversation that
  produced it in addition to the patient; whether a `services` reference
  belongs in P4 at all; clinic-local time/`data_region` handling; or any
  HTTP API/UI surface for appointments. None of those are addressed or
  assumed by this decision.
- The four-state lifecycle fixed here becomes the shape any status column
  takes, if and when P4's migration adds one — but this ADR does not itself
  add a column, an enum, or a CHECK constraint.

## Alternatives considered

- **Overridable-by-staff warning instead of a hard invariant.** Lets a
  receptionist double-book deliberately (e.g., an urgent walk-in). Rejected:
  this is the exact question Deliverable B's own domain model already
  treated as settled in substance ("Approved by Ahmed as a hard domain
  invariant"), and a warning-only rule cannot later be tightened into a hard
  invariant without breaking any workflow that had come to rely on
  overriding it — the reverse (loosening a hard invariant later, if ever
  needed) is the safer direction to leave open.
- **Closed interval `[start, end]` instead of half-open `[start, end)`.**
  Simpler to state, but forbids the ordinary scheduling pattern of one
  appointment ending exactly when the next begins for the same practitioner —
  rejected as an unnecessary restriction with no correctness benefit.
- **Application-level check only, no database-level enforcement.** Simplest
  to build, and avoids naming any database mechanism before P4 migration
  design. Rejected per point 8: a check-then-insert has an unavoidable race
  window under concurrent requests, and this project has no
  request-serialization layer that would close it another way.
- **Fold `rescheduled` into `booked` (three states, not four).** Fewer
  states to reason about, and closer to Deliverable B's original framing
  where a reschedule returns an appointment to `booked` rather than
  introducing a distinct state. Rejected as out of scope for this ADR to
  redecide; `rescheduled` is retained as its own state per this ruling.
