# CLAUDE.md

Clinic AI Platform lets Arab-world clinics answer patient messages in seconds using an
AI assistant grounded in that clinic's own data. It turns those conversations into
booked appointments instead of a human receptionist doing it manually.

## Status

P1, P2, P3-A, P3-B and P3-C are complete and merged on main. Production runs migrations 0001-0010: patient conversations, the staff conversation list and detail views, and staff replies to a conversation. ADRs 0001-0009 are Accepted; ADR-0009 (EU/EEA-only residency, GDPR as the sole governing regime, Gulf markets deferred) resolves issue #7. P3's acceptance criteria in docs/03-roadmap.md are now met. Next: P4 — Appointments.

Two limitations are recorded rather than resolved. Production has no active staff identity by design, so the authenticated production click-through for P3-B and P3-C is deferred — a limitation of the validation surface, not an open implementation defect. docs/operations/production-rebuild-runbook.md is written but has never been executed or rehearsed.

## Hard rules

- Nothing gets built before the roadmap phase that calls for it.
- No ADR changes status (Proposed → Accepted, etc.) without a human comment in the
  pull request saying so.
- Humans merge. Agents open pull requests; they never merge them.
- No real patient or clinic data anywhere — not in the repo, fixtures, issues, Notion,
  or an AI prompt.
- A one-way-door decision gets its own ADR, with Ahmed's approval, before code.

## Authoritative docs

- [`docs/governance/project-charter.md`](docs/governance/project-charter.md) — governs
  everything else; amendments only by pull request.
- [`docs/01-project-plan.md`](docs/01-project-plan.md) — goal, users, out-of-scope.
- [`docs/03-roadmap.md`](docs/03-roadmap.md) — phases and acceptance criteria.
- [`docs/adr/`](docs/adr/) — architecture decision records.
- [`docs/product/`](docs/product/), [`docs/domain/`](docs/domain/) — Deliverables A
  and B.
