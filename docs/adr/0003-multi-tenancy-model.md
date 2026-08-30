# 0003 — Multi-tenancy model

## Status

Accepted — 2026-08-30. Approved by the owner in a comment on this pull
request.

## Context

Clinic AI Platform is multi-tenant: many clinics share the same application
and, most likely, the same database. A patient-data product cannot tolerate a
bug that leaks one clinic's records to another, so the isolation model needs
to be decided deliberately rather than emerging from ad hoc `WHERE` clauses
scattered across the codebase.

## Decision (proposed)

- **Shared database, not database-per-tenant.** One Postgres database serves
  all clinics. This keeps operations (migrations, backups, connection
  pooling) simple at the scale this product expects, at the cost of needing
  strict row-level isolation.
- **`clinic_id` on every tenant-scoped table.** Any table holding data that
  belongs to a specific clinic (patients, conversations, appointments,
  knowledge-base entries, etc.) carries a `clinic_id` foreign key. Tables that
  are genuinely global (e.g. platform-level configuration) are the only
  exception, and should be rare.
- **Postgres Row Level Security (RLS) enforces isolation at the database
  layer**, keyed on `clinic_id`, rather than relying solely on application
  code to remember a `WHERE clinic_id = ...` on every query. The database
  connection sets the current clinic context (e.g. via a session variable)
  per request, and RLS policies deny access to rows outside that context by
  default.

## Consequences (anticipated)

- Every migration that adds a tenant-scoped table must also add its
  `clinic_id` column and RLS policy — this should become a checklist item in
  P1's migration tooling.
- Application code still benefits from including `clinic_id` in queries for
  performance (index usage) even though RLS is the actual safety net, not
  just an optimization.
- This decision is revisited if operational needs change (e.g. a large clinic
  needing dedicated infrastructure), but shared-database-with-RLS is the
  starting default.
