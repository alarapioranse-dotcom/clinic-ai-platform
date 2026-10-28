# 03 — Roadmap

Each phase below is planned scope, not built, unless marked done. Acceptance
criteria describe what "done" means for that phase.

## P0 — Foundation (done)

Scaffold the project: stack, folder conventions, design tokens, tooling, and
CI, with no database, auth, AI, or payments.

**Acceptance criteria:**

- Next.js App Router project builds, lints, type-checks, and formats cleanly.
- Public Arabic RTL landing page renders the hero, how-it-works, capabilities,
  and launch-status sections.
- `(app)` shell and `/dashboard` exist but are intentionally empty.
- `GET /api/health` returns status, environment, and timestamp.
- `src/features/*` exist as README-only placeholders.
- CI runs `format:check`, `lint`, `typecheck`, and `build` on every push.

## P1 — Multi-tenancy and data

Introduce persistence with tenant isolation as a first-class concern rather
than bolted on later.

**Acceptance criteria:**

- A Postgres database is provisioned and migration tooling is in place.
- Every tenant-scoped table carries a `clinic_id` column.
- Row Level Security policies enforce clinic isolation at the database layer
  (see [adr/0003-multi-tenancy-model.md](./adr/0003-multi-tenancy-model.md)).
- At least one feature (`patients`) has real, tenant-scoped read/write
  operations behind its public entry point.

## P2 — Authentication and authorization

**Acceptance criteria:**

- Clinic staff can sign in and are scoped to their own clinic.
- The `(app)` shell enforces a session check before rendering `/dashboard`.
- Roles exist for at least "clinic admin" and "staff."

## P3 — Conversations (patient replies)

**Acceptance criteria:**

- Inbound patient messages are received and persisted as conversation
  threads, scoped to a clinic.
- Staff can view and reply to a conversation from the `(app)` shell.
- The `conversations` feature owns this logic behind its public entry point.

## P4 — Appointments

**Acceptance criteria:**

- Clinic schedules and available slots are modeled and persisted.
- A conversation can be turned into a booked appointment.
- The `appointments` feature owns slot-matching and booking logic behind its
  public entry point.

## P5 — Knowledge base and AI

**Acceptance criteria:**

- Each clinic can maintain its own knowledge base (services, pricing, hours,
  policies).
- Automated replies to patients are grounded in that clinic's knowledge base.
- The `knowledge-base` feature owns retrieval logic behind its public entry
  point; AI/LLM calls are isolated behind an interface so the provider can
  change without touching call sites.

## Staff UI localization (pilot readiness)

Not part of P5's acceptance criteria. Decided by
[ADR-0027](./adr/0027-staff-ui-localization.md) (Proposed); no slice starts before the Owner accepts
it. Delivered in three slices, each with its own Owner approval.

**Acceptance criteria:**

- Every staff screen, the login and invitation-acceptance pages, the app navigation, the environment
  notice, `error.tsx` and `not-found.tsx` render in Arabic, Greek or English.
- The language is chosen per staff member from a switcher on every in-scope screen, kept in a
  `locale` cookie, with `Accept-Language` and then Greek as the fallback; no database change.
- `<html lang dir>`, fonts and date and number formatting follow the active language; Arabic renders
  right-to-left, Greek and English left-to-right.
- A missing dictionary key fails `npm run typecheck`.
- An Arabic user sees no change after the first slice.
- Greek text is reviewed by a native Greek speaker, recorded in the pull request, before any Greek
  screen is shown to a clinic.
