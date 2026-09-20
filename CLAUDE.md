# CLAUDE.md

Clinic AI Platform lets EU/EEA clinics (ADR-0020) answer patient messages in seconds using an
AI assistant grounded in that clinic's own data. It turns those conversations into
booked appointments instead of a human receptionist doing it manually.

## Status

P1, P2, P3-A, P3-B, P3-C and P4 are complete and merged on main. P5 Slice 1A and 1B (knowledge-document storage foundation, then upload initiation and completion, #68 and #70) are also merged, but P5 as a whole is not closed — retrieval and grounded automated replies are not yet built. Production runs migrations 0001-0014: patient conversations, the staff conversation list and detail views, staff replies to a conversation, clinic schedules/availability/booking with the no-double-booking invariant, and knowledge-document upload. ADRs 0001-0009, 0011-0012 and 0014-0018 are Accepted; ADR-0013 remains Proposed. ADR-0009 (EU/EEA-only residency, GDPR as the sole governing regime, Gulf markets deferred) resolves issue #7. P3's and P4's acceptance criteria in docs/03-roadmap.md are now met. Next: P5 — Knowledge base and AI, continuing from Slice 1B.

Three limitations are recorded rather than resolved. Production has no active staff identity by design, so the authenticated production click-through for P3-B and P3-C is deferred — a limitation of the validation surface, not an open implementation defect. Slice 1B's implementation and production migration gates are closed; its authenticated production click-through is a documented deferred verification gap for the same reason: scripts/seed.ts hardcodes `DEMO_STAFF_ROLE` as a fixed exported `'receptionist'` constant, while both Slice 1B endpoints (`POST /api/knowledge-documents`, `POST /api/knowledge-documents/:id/complete`) require `owner` or `admin`, so the documented deployment-validation seed cannot produce a usable test identity. The alternative — manual role elevation of a publicly-published identity, a new production credential, and two permanent artifacts the application has no path to delete — was ruled against by the owner on all three counts. The first legitimate clinic onboarding will be the real verification. What is proven instead: credentials were verified during provisioning; the bucket is private; CORS was verified by reading it back; there is no lifecycle rule; both endpoints return 401 unauthenticated in production; migration 0014's privilege state was verified (SELECT and INSERT true, UPDATE and DELETE false, RLS and FORCE RLS unchanged); 319 tests plus typecheck, lint, build and format:check are green; and the presigned Content-Type signature binding is covered by a regression test. docs/operations/production-rebuild-runbook.md is written but has never been executed or rehearsed.

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
