# 0017 — Clinic working-hours behavior at DST gap/overlap transitions

## Status

Proposed

## Date

2026-09-18

## Phase

P4 — Appointments (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — per the charter's ADR policy,
this class of decision requires an ADR and Ahmed's approval, recorded as a human comment on the pull
request, before dependent code is merged. This is a domain/business-rule decision, not a technical
one: it decides what a clinic's published availability _means_ on the small number of calendar days
each year its working-hours boundary coincides with a DST transition in its own IANA timezone. Once
real clinic schedule data and real booking activity exist under one interpretation of these days,
changing that interpretation later is not a code change alone — a clinic's staff and patients will
already have experienced (or been denied) specific appointment slots under whatever rule shipped
first. That is the same class of cost [ADR-0016](./0016-clinic-working-hours-iana-timezone.md)'s own
Impact section describes for the underlying timezone decision, applied one level down to the
transition edge case ADR-0016 itself left open.

## Context

[ADR-0016](./0016-clinic-working-hours-iana-timezone.md) (Accepted) establishes that
`clinics.working_hours` `HH:MM` values are clinic-local wall-clock times, converted to absolute
`timestamptz` instants using the clinic's own IANA timezone attribute
(`clinics.timezone`, `db/migrations/0012_clinic_timezone.sql`) and the platform's own tzdata — never
a fixed numeric offset, never a hand-rolled DST engine.

ADR-0016 does not decide what happens when that conversion has no single well-defined answer. An
IANA timezone that observes DST has, twice a year, a period where the mapping from clinic-local
wall-clock time to an absolute instant breaks down in one of two distinct ways:

- **Spring-forward gap.** Local clocks jump forward, and some wall-clock times on that date simply
  never occur. Example, verified directly against this platform's own tzdata rather than assumed:
  Africa/Cairo's clock jumps from 2026-04-23 23:59:59 directly to 2026-04-24 01:00:00 local time —
  every wall-clock value from `00:00` up to (but not including) `01:00` on 2026-04-24 does not exist
  in that zone. A `working_hours` entry whose `start` or `end` falls in that range names a time of
  day that literally never happens on that date.
- **Fall-back overlap.** Local clocks move backward, and some wall-clock times on that date occur
  twice, at two different absolute instants, under two different UTC offsets. Example, same
  verification: Africa/Cairo's clock reaches 2026-10-29 23:59:59, then immediately becomes
  2026-10-29 23:00:00 again — every wall-clock value from `23:00` up to (but not including) `24:00`
  on 2026-10-29 occurs once under daylight offset (UTC+3) and again, one hour later in absolute time,
  under standard offset (UTC+2). A `working_hours` entry whose `start` or `end` falls in that range
  names a time of day that corresponds to two different valid instants, not one.

Neither case is a malformed `working_hours` value in the sense
[`src/features/appointments/schedule.ts`](../../src/features/appointments/schedule.ts)'s
`getWindowForDate` already handles (bad `HH:MM` format, or `start` not strictly before `end`). The
JSON is perfectly well-formed; it is the _specific calendar date's_ interaction with the clinic's own
DST rule that makes the boundary undefined (gap) or double-valued (overlap). No prior ADR, and
nothing in ADR-0016's Decision or Consequences sections, says what a clinic's published availability
should be for a working-hours window whose boundary lands on one of these two calendar days.

**Currently implemented behavior is provisional only, not an established rule.** [PR
#56](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/56) (draft, not merged, stacked
on [PR #54](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/54)) contains a
`schedule.ts` implementation (`resolveZonedInstant`) that, on detecting either case, returns no
absolute instant, which in turn means `computeAvailableSlots` produces no available slots for that
practitioner on that date for the affected window. This was a decision made by the implementer alone,
in order to have some deterministic, testable behavior while writing that PR — not a decision this
ADR, ADR-0016, or any other Accepted record made or reviewed. It remains in PR #56's code only so
that branch stays internally testable; it must not be read as this ADR's answer, and PR #56 will not
be merged while this ADR remains Proposed.

## Decision

**Not decided by this record.** This ADR exists to put the DST gap/overlap question in front of the
owner for a ruling, per charter §10's one-way-door process — it does not select an answer itself. The
options below are presented as alternatives, not a recommendation. Once the owner rules on this
(recorded the same way ADR-0016 was: a human comment on this ADR's pull request), a follow-up edit to
this ADR's Decision section — or a superseding record — states the actual rule, and only then is
implementing it (beyond PR #56's current provisional behavior) authorized.

At minimum, the ruling needs to independently settle, for each of the gap case and the overlap case
(they need not receive the same answer):

1. Whether the two cases are even required to behave the same way as each other.
2. What a patient- or staff-facing availability read returns for a working-hours window whose
   boundary falls in the affected range on the affected date — see Alternatives below.
3. Whether this is purely a read-time/availability-computation concern, or whether
   `clinics.working_hours` / `staff_members.working_hours` configuration itself should be validated
   or rejected at write time for containing a boundary that could someday coincide with a transition
   (note: DST transition dates are typically not the same every year and are set by each country's
   own tzdata rule, so a window that is safe this year is not guaranteed to stay safe in a future
   year without re-checking).

## Consequences

Deferred until the Decision section above is filled in — the consequences of each alternative below
differ enough (silently narrower availability vs. a hard configuration error vs. shifted appointment
times) that stating them generically here would not be meaningful. This section is completed as part
of accepting this ADR.

## Alternatives considered

No alternative is selected. Recorded here as the candidate answers found while drafting this ADR, for
the owner to choose among, combine, or reject in favor of something else entirely:

- **No availability for the affected window on the affected date ("fail closed").** What PR #56
  currently, provisionally, does. Simple, and consistent with `getWindowForDate`'s existing
  fail-closed handling of actually-malformed data — but conflating "malformed data" with "well-formed
  data that happens to name an undefined or double-valued moment" is exactly the framing this ADR
  exists to not assume silently. A clinic offering, say, `00:00`–`08:00` hours would lose that entire
  window on one specific date a year, with nothing in the product surfacing why.
- **Reject the configuration outright.** Validate `working_hours` at write time (or at
  availability-computation time, returning an error rather than an empty result) whenever a boundary
  could coincide with a known or future transition, forcing the clinic (or its administrator) to pick
  different hours. Removes the silent-narrowing problem above, but requires deciding how far in
  advance transitions must be knowable (tzdata does not always have next year's exact dates yet — see
  Decision item 3), and turns an availability read into a potential hard failure for configuration
  that was valid every other day of the year.
- **Normalize or shift the boundary to the nearest valid instant.** E.g., a nonexistent start time
  snaps forward to the first instant that exists after the gap; an ambiguous time resolves to a fixed
  choice (always the earlier occurrence, or always the later one). Preserves the window's approximate
  duration and never silently loses the whole day, but invents a specific business rule about what a
  clinic "meant" that nothing today records the clinic having agreed to, and picking "earlier" vs.
  "later" for the overlap case is itself arbitrary without a stated rationale.
- **Do nothing differently per date; let the instant resolve however the single-offset conversion
  happens to land.** I.e., drop the ambiguity/nonexistence detection entirely and let whichever offset
  a naive conversion picks stand, even if it silently produces a wrong-by-one-hour or a
  doesn't-really-exist instant. Simplest to implement, but reintroduces exactly the kind of silent,
  invisible-until-real-data-exists wrongness ADR-0016's own Context section named as the reason a
  UTC-literal interpretation needed an ADR in the first place — almost certainly not acceptable for
  the same reason, but recorded here for completeness.
