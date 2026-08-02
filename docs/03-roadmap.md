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
