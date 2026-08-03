# 0004 — Staff role model

## Status

Proposed

## Date

2026-08-03

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

Costly to reverse (see [charter §10](../governance/project-charter.md)) — this becomes the basis
of every row-level security policy from P2 onward.

## Context

[`docs/03-roadmap.md`](../03-roadmap.md)'s P2 acceptance criterion states only that "roles exist
for at least 'clinic admin' and 'staff'" — a floor of two. Deliverable A
([`docs/product/04-sitemap.md`](../product/04-sitemap.md) and
[`05-screen-inventory.md`](../product/05-screen-inventory.md)) needs enough role granularity to
express real access differences: who can change what the assistant is allowed to say, who can
manage who has access to the clinic's account, and who can edit the schedule versus only view it.
Two roles can't express those differences without giving "staff" either more or less access than
any single day-to-day job should have by default (charter §5, least privilege by default). Because
this decision becomes the basis of every row-level security policy built in and after P2, it is
costly to reverse once accounts and permission checks exist against it.

## Decision

Adopt four roles: **owner**, **admin**, **practitioner**, **receptionist**.

- Owner and admin: full access, including staff management, knowledge base, and clinic settings.
- Receptionist: full access to conversations, patients, and appointments (view and manage); no
  access to staff management, knowledge base, or clinic settings.
- Practitioner: read-only access to conversations and appointments; no access to staff management,
  knowledge base, or clinic settings.

Practitioners are read-only on conversations specifically: a practitioner's job is clinical care,
not managing patient communication, and reply access would blur who is accountable for what a
clinic told a patient.

## Consequences

- Every P2 permission check has four cases instead of two — more implementation surface, but it
  matches what Deliverable A already specifies staff need to do.
- Adding a fifth role later (e.g., billing-only) is an ordinary reversible change; merging or
  removing one of these four once clinics have staff assigned to it is not — it requires a
  migration and a decision about what those staff members become.
- Deliverable A's `04-sitemap.md`, `05-screen-inventory.md`, and `06-acceptance-criteria.md` already
  assume this model. If this ADR is rejected or amended before P2 ships, those three documents need
  a corresponding update.

## Alternatives considered

- **Two roles with per-feature permissions** (matches P2's stated floor exactly): keeps the role
  list minimal and pushes granularity into a permissions matrix instead. Rejected for now — it adds
  a second axis of configuration (role × permission) before any clinic has asked for custom
  permissions, and Deliverable A's screens need a fixed, predictable set of job functions, not
  per-clinic customization.
- **Three roles, merging admin into owner**: fewer roles to reason about, but every clinic in
  scope (small and mid-sized, per [`docs/01-project-plan.md`](../01-project-plan.md)) is expected
  to eventually want to delegate admin work without handing over full ownership. Rejected because
  it would need re-splitting later — exactly the cost this ADR exists to avoid paying twice.
- **Fully custom permissions per clinic**: maximum flexibility, but the highest implementation cost
  and the hardest to reason about for tenant isolation (charter §5). Rejected as disproportionate
  to a product still in its Phase 0–1 foundation, where a fixed role model is easier to build
  correct row-level security around.
