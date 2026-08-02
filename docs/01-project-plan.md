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

## Out of scope (v1)

- Clinical advice, diagnosis, and triage.
- Electronic medical records, prescriptions, and lab results.
- Insurance claims.
- Patient payments.
- Native mobile apps.

The clinical exclusion is a product decision, not a temporary limitation: it keeps the regulatory
surface small and the failure modes non-dangerous. See
[`docs/governance/project-charter.md`](./governance/project-charter.md), §3, for the principle
this enforces.

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

## Standing risks

How a risk is handled — severity, ownership, an S1 stopping other work — is governed by
[`docs/governance/project-charter.md`](./governance/project-charter.md), §17. This table is the
risks themselves.

| Risk                                              | Impact | Mitigation                                                                 |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| Wrong clinical answer                             | High   | Hard refusal and handoff to a human — see charter §3.                      |
| Patient data leaking across tenants               | High   | `clinic_id` enforced at the data layer (see ADR 0003), not only in the UI. |
| WhatsApp Business approval delayed or refused     | Medium | Web widget ships first and is independently valuable.                      |
| AI cost per conversation exceeding the plan price | Medium | Measured from the first day of the phase that introduces AI.               |
| Solo-founder bus factor                           | Medium | Every decision written down; nothing lives only in chat history.           |
