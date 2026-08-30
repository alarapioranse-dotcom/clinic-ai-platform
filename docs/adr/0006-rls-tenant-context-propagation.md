# 0006 — RLS tenant-context propagation

## Status

Accepted — 2026-08-30. Approved by the owner in a comment on this pull request.

## Date

2026-08-30

## Phase

P1 — Multi-tenancy and data (shapes P2 — Authentication and authorization as well; see
[`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — this choice constrains the
connection-pooling architecture and the auth session model simultaneously, and every RLS policy
and API request path built on top of it from P1 onward assumes it.

## Context

[`docs/technical/01-database-schema.md`](../technical/01-database-schema.md) gives every
tenant-scoped table a Row Level Security policy keyed on
`current_setting('app.current_clinic_id', true)`, used there only as an illustrative default.
[`docs/technical/07-open-questions.md`](../technical/07-open-questions.md) (Open Question 1)
named the actual mechanism — how a request's `clinic_id` reaches PostgreSQL for that policy to
key on — as a one-way-door choice this design work surfaced rather than a detail to decide
silently, per [charter §10](../governance/project-charter.md). This ADR resolves it.

## Decision

**Per-request session variable.** `SET LOCAL app.current_clinic_id = <clinic_id>` runs inside the
same transaction as the request's queries, immediately after the request's `clinic_id` is resolved
from the session (see [`docs/technical/04-auth-implementation.md`](../technical/04-auth-implementation.md)).
Every RLS policy in [`docs/technical/01-database-schema.md`](../technical/01-database-schema.md)
reads it via `current_setting(...)`, exactly as already illustrated there.

This decision includes the following as mandatory conditions, not optional hardening:

- **Connection pooling runs in session mode, or resets the setting on connection release.**
  Transaction-mode pooling that reuses a connection across requests without resetting
  `app.current_clinic_id` is forbidden — it is the specific failure mode (a connection carrying a
  stale `clinic_id` context serving a different clinic's query) this whole mechanism exists to
  prevent.
- **A CI check fails if the pooler configuration is transaction-mode without reset.** This is a
  required, automated gate on the pooler configuration itself, not a rule stated in documentation
  and left to be remembered.
- **The tenant-isolation test gains a case for a query path that opens no transaction.** Any code
  path that runs a query without first opening the transaction `SET LOCAL` depends on (a
  connection-pool health check, a raw query helper someone adds later bypassing the normal request
  path) must be proven to fail closed — return zero rows, not another clinic's rows — exactly as
  [`docs/technical/02-tenant-isolation-testing.md`](../technical/02-tenant-isolation-testing.md)'s
  Test 2 already demonstrates for an unset session variable. This case is added to that suite
  alongside the existing ones, not as a replacement for them.

## Consequences

- **Stated plainly:** the guarantee this mechanism provides is "the application set the value
  correctly on this connection, for this transaction" — not "the connection itself cannot see
  other clinics." That distinction is the entire reason the three conditions above are part of the
  decision and not left to operational discipline: a correct implementation still depends on every
  code path that touches the database going through the same `SET LOCAL` step, and pooling
  configuration is the one part of that chain application code cannot itself verify at runtime,
  hence the CI check.
- Every RLS policy already written in
  [`docs/technical/01-database-schema.md`](../technical/01-database-schema.md) and the
  auth-session note in
  [`docs/technical/04-auth-implementation.md`](../technical/04-auth-implementation.md) are
  confirmed as the mechanism to build against — no schema or endpoint contract in
  `docs/technical/` needs to change as a result of this ADR.
- This forecloses building the request/database layer around Postgres roles or JWT-verified
  policies later without a further ADR superseding this one; see Alternatives considered.
- Does not by itself close the gap
  [`docs/technical/04-auth-implementation.md`](../technical/04-auth-implementation.md) names in
  its role-enforcement section (Practitioner's read-only restriction is not independently enforced
  at the database level) — that gap was already noted as depending on this decision, and a
  per-clinic-only session variable does not resolve it. Enforcing it would require role granularity
  this mechanism doesn't provide; left as a candidate strengthening for a future ADR, not solved
  here.

## Alternatives considered

- **Postgres role per clinic.** Rejected: does not scale to hundreds of clinics — role management
  and connection-pool sizing per role become real operational costs at exactly the scale this
  product targets (small/mid clinics, potentially many of them), for an isolation guarantee that is
  stronger than what this product currently needs.
- **JWT-claim-checked policy function.** Rejected: moves a verification dependency and a
  key-rotation story inside the database layer itself, for a guarantee this ADR achieves more
  simply — the CI check on pooler configuration and the additional isolation-test case — without
  that added machinery.
