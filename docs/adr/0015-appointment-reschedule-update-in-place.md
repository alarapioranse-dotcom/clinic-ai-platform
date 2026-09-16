# 0015 — Appointment rescheduling is update-in-place, not a new appointment

## Status

Accepted — 2026-09-16. Approved by the owner in a comment on [PR #53](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/53).

## Date

2026-09-16

## Phase

P4 — Appointments (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Context

[ADR-0014](./0014-appointment-no-double-booking-invariant.md) (Accepted) fixes the appointment
lifecycle — `booked`, `rescheduled`, `cancelled`, `completed` — and the no-double-booking invariant
governing which intervals may coexist for a practitioner. It states that rescheduling "moves it to
the `rescheduled` state and assigns it a new interval," and that "the invariant is re-evaluated
against that new interval exactly as it would be for a new booking"
([`0014-appointment-no-double-booking-invariant.md`](./0014-appointment-no-double-booking-invariant.md),
Decision point 5). ADR-0014 deliberately leaves open _how_ an appointment's interval is replaced
during a reschedule: its own Consequences section lists this among what "P4 migration design must
still resolve separately"
([`0014-appointment-no-double-booking-invariant.md`](./0014-appointment-no-double-booking-invariant.md),
Consequences).

Two materially different mechanisms would each satisfy ADR-0014's invariant as written: (a)
updating the existing `appointments` row's `starts_at`/`ends_at` in place, or (b) treating a
reschedule as canceling the existing appointment and creating a new one with its own identity.
ADR-0014's own language — "the appointment's prior interval stops participating... an appointment
never conflicts with its own earlier interval" — describes one appointment's interval changing, not
one appointment being superseded by another, but it does not itself commit to a data-layer
mechanism. The two mechanisms carry different, consequential implications: which row a
conversation's optional appointment link
([`docs/domain/04-relationships.md`](../domain/04-relationships.md)) continues to point at across a
reschedule, whether appointment identity is stable for anything that references it, and whether a
prior interval remains recoverable after a reschedule. This decision resolves that mechanism before
P4's first migration is designed, consistent with the charter's requirement that a costly-to-reverse
decision be recorded before the code that depends on it
([`docs/governance/project-charter.md`](../governance/project-charter.md), §10).

## Decision

1. Rescheduling an appointment is performed as an `UPDATE`-in-place on the existing `appointments`
   row. No new row is created, and no existing row is deleted, as part of a reschedule.
2. The appointment retains its identity across a reschedule. Its `id` — and any reference to that
   `id`, including an appointment referenced from a conversation — continues to identify the same
   appointment, unchanged, before and after any number of reschedules.
3. The existing active time interval is replaced by the new interval atomically: `starts_at` and
   `ends_at` are overwritten in the same statement that moves `status` to `rescheduled`, within a
   single transaction. This replacement is subject to the no-double-booking invariant already
   Accepted in ADR-0014. This ADR does not restate, redefine, or alter that invariant, its
   half-open interval semantics, or its enforcement mechanism in any way — it fixes only that the
   row checked against that invariant, on reschedule, is the same row being updated, not a newly
   inserted one.
4. P4 does not persist historical appointment intervals. No table, column, or log records the
   interval an appointment held before a reschedule replaced it.
5. Consequently, a previous interval replaced by rescheduling is not recoverable from the
   `appointments` table, or from any other structure P4 introduces. Once a reschedule commits, the
   only interval associated with that appointment's row is its current one.
6. The appointment lifecycle remains exactly the lifecycle already Accepted in ADR-0014 — `booked`,
   `rescheduled`, `cancelled`, `completed`, with the same legal transitions. This decision introduces
   no additional state and no additional transition.

## Consequences

Easier:

- Appointment identity is stable across rescheduling by construction: anything holding an
  appointment `id` — a conversation link, a URL, a detail page — never needs to resolve "which
  appointment is this now"; it is always the same row.
- The no-double-booking constraint's self-exclusion behavior on reschedule (an appointment's new
  interval never conflicting with its own immediately-prior interval) falls out of ordinary
  `UPDATE`/exclusion-constraint semantics with no additional application logic, because there is
  only ever one row per appointment for the constraint to compare against.

Harder:

- No part of the system can answer "what times has this appointment been rescheduled from" after
  the fact. A clinic wanting to know how often, or how late, a given practitioner's appointments
  are moved has no data to answer that from within P4.

Forecloses:

- Recovering a pre-reschedule interval for any purpose (dispute resolution, no-show analysis tied
  to an original booking time, undoing a reschedule) without a future ADR introducing a
  history-bearing mechanism. This is a deliberate, named tradeoff of this decision, not an
  oversight — see Alternatives considered.
- Modeling a reschedule as a new appointment identity. Reversing this later would need to
  reconcile every existing reference to appointment identity introduced during P4 — in particular,
  any conversation-to-appointment link — rather than simply adding a column.

Explicitly out of scope for this decision, unaffected by it and not decided here: how available
slots are computed or persisted; how a clinic's or practitioner's schedule is modeled; clinic-local
timezone representation; whether a services reference belongs on the appointment; the wording of
any API error response; any hospital, organization, or multi-clinic hierarchy. None of these are
assumed, addressed, or foreclosed by this ADR.

## Alternatives considered

- **Cancel-and-recreate on reschedule** (insert a new `appointments` row; transition the prior row
  to `cancelled` or a reschedule-specific terminal state). Would give a natural, structural place to
  keep the prior interval — the old row itself, untouched — without a dedicated history mechanism.
  Rejected for P4: it would require inventing a way to link the old and new rows as "the same
  logical appointment" for anything that references appointment identity (a conversation's link in
  particular); it reintroduces exactly the kind of state ADR-0014 declined to add ("no `no_show`,
  `pending`, or `confirmed`... is introduced,"
  [`0014-appointment-no-double-booking-invariant.md`](./0014-appointment-no-double-booking-invariant.md),
  Lifecycle) unless a new terminal state is invented for the superseded row; and it produces two
  rows per rescheduled appointment for every downstream listing/counting/filtering query to reason
  about correctly. `UPDATE`-in-place avoids all of this by construction.
- **`UPDATE`-in-place plus a separate reschedule-history table or audit log.** Would keep this
  decision's identity and atomicity benefits while also making prior intervals recoverable.
  Rejected for P4 specifically — not because it is a bad idea, but because nothing in P4's roadmap
  acceptance criteria ([`docs/03-roadmap.md`](../03-roadmap.md)) requires reschedule history, and a
  history-bearing table is new scope this decision is not the occasion to add. If the owner later
  decides history must be retained, that is a decision for a future ADR, weighed against its own
  cost — not a default assumed here.
- **Event sourcing over appointment state changes.** Would make every interval an appointment ever
  held reconstructable from an event log. Rejected for the same reason as the history table, at
  considerably larger cost: it would replace the `appointments` table's role as the ADR-0014
  exclusion constraint's authority with a derived-state model — a materially larger architecture
  change than P4's acceptance criteria call for.
