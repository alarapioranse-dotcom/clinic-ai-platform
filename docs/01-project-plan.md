# 01 — Project Plan

## Product goal

Clinic AI Platform is a multi-tenant SaaS for medical clinics. It will
eventually:

- Receive and reply to patient messages.
- Match patient requests to available slots and book appointments.
- Ground automated replies in a clinic's own knowledge base (services,
  pricing, hours, policies).

## Target users

Small and mid-sized medical clinics that want to offload routine patient
communication and appointment booking without hiring additional front-desk
staff. Each clinic operates independently within the platform (multi-tenant),
with no visibility into other clinics' data.

## Phase 0 scope

Phase 0 is a **foundation-only scaffold**. It exists to lock in the stack,
folder conventions, design tokens, and CI gates before any product feature is
built.

**In scope:**

- Next.js App Router project structure (`src/app`, `src/components`,
  `src/features`, `src/config`, `src/lib`, `src/types`).
- The public marketing landing page (Arabic, RTL).
- An empty, intentionally unbuilt signed-in app shell and dashboard page.
- A health check API route.
- Design tokens and typography.
- Tooling: TypeScript strict mode, ESLint, Prettier, CI.
- Documentation: this plan, the architecture doc, the roadmap, and ADRs.

**Explicitly out of scope for Phase 0:**

- Database and data persistence.
- Authentication and authorization.
- Any AI/LLM integration.
- Payments/billing.
- Any of the four product features (`appointments`, `patients`,
  `knowledge-base`, `conversations`) beyond a README stating their future
  purpose.

See [03-roadmap.md](./03-roadmap.md) for how these land in later phases.
