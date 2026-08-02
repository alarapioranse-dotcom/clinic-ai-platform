# Deliverable A — Product Specification

## What this covers

Deliverable A answers, at the product level: who uses Clinic AI Platform, what they're trying to
do, where they do it, and how the system must behave when they do. Concretely, this deliverable
is the seven files in this directory:

- [`01-personas.md`](./01-personas.md) — who the four user types are and what they need.
- [`02-user-journeys.md`](./02-user-journeys.md) — the narrative shape of their experience.
- [`03-user-flows.md`](./03-user-flows.md) — the step-by-step mechanics, including failure paths.
- [`04-sitemap.md`](./04-sitemap.md) — the full route tree and who may reach each route.
- [`05-screen-inventory.md`](./05-screen-inventory.md) — every screen, one row each.
- [`06-acceptance-criteria.md`](./06-acceptance-criteria.md) — the observable behavior each screen
  must satisfy.

This is documentation only. Nothing under `src/`, no database schema, no API contract, and no CI
configuration changes with it.

## What it defers

Two things are deliberately absent, because they belong to work that comes after this one:

- **Deliverable B** — the data model and API design: tables, columns, endpoints, request and
  response shapes. This spec describes what a screen must be able to do, never how data is stored
  or transported to make that true.
- **Deliverable C** — the AI pipeline: retrieval, prompting, grounding, and model choice. Where a
  flow or acceptance criterion touches the assistant, it describes the user-visible outcome
  ("the assistant hands off" / "the assistant proposes a slot from the clinic's data") and nothing
  about how that outcome is produced.

Pixel positions, colors, and component names are also out of scope by instruction — every
acceptance criterion in `06-acceptance-criteria.md` is written as behavior, not layout.

## Relation to `docs/01-project-plan.md`

This deliverable operationalizes [`docs/01-project-plan.md`](../01-project-plan.md): the product
goal, target users, and out-of-scope (v1) list there are the constraints this spec was written
inside, not constraints it revisits. Where this spec names a persona, flow, or screen, it stays
inside that plan's scope — no clinical advice, no EMR/prescriptions/labs, no insurance claims, no
patient payments, no native mobile app.

## Contradictions and gaps flagged, not silently resolved

Per instruction, anything here that doesn't cleanly fit the existing plan or roadmap is named here
rather than quietly decided:

1. **This deliverable isn't in P1's acceptance criteria.** [`docs/03-roadmap.md`](../03-roadmap.md)
   defines P1 ("Multi-tenancy and data") purely in data-layer terms — Postgres, `clinic_id`, RLS,
   and the `patients` feature's backend contract. It does not list a product specification as
   something P1 produces. This document exists because the task that requested it named P1, not
   because the roadmap currently calls for it. The roadmap should be updated (or an ADR written)
   to say explicitly whether product specification is P1 scope, a prerequisite that precedes P1,
   or its own cross-cutting deliverable — this document does not settle that question.
2. **Four roles vs. two.** This spec uses four roles — owner, admin, practitioner, receptionist —
   because that's the granularity the sitemap and screen access rules need to be meaningful. P2's
   stated acceptance criterion is only "roles exist for at least 'clinic admin' and 'staff'" — a
   floor, not a ceiling, so four roles don't contradict it outright. But a role model is the kind
   of decision Deliverable B and P2's implementation will treat as costly to reverse once accounts
   exist, so it should get an ADR before P2 starts, not be inherited by default from this document.
3. **Screen-to-phase mapping is inferred, not specified.** The roadmap's phase acceptance criteria
   describe backend capability, not which screen ships with it. `05-screen-inventory.md` assigns
   each screen to the earliest phase whose acceptance criteria imply it must exist, and marks that
   assignment "(inferred)" wherever the roadmap doesn't say so explicitly — for example, a patient
   list/detail screen is placed at P3 because that's when conversations first make a patient
   record something staff need to look at, not because P1 or P3's written criteria mention a
   screen at all. These inferences are reasonable defaults, not settled scope.
