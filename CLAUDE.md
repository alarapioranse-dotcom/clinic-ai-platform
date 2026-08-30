# CLAUDE.md

Clinic AI Platform lets Arab-world clinics answer patient messages in seconds using an
AI assistant grounded in that clinic's own data. It turns those conversations into
booked appointments instead of a human receptionist doing it manually.

## Status

Deliverable B (P1-B domain model) merged via PR #4. Next up is Deliverable C —
Technical Design (schema, API contracts, AI pipeline, auth implementation). Issue #7
(data residency ADR) is open and blocks P2, not C. PR #6 stays draft.

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
