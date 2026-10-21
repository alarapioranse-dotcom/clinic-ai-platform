# Operations Note — Separate Demo Environment (Option C)

**Date:** 2026-10-21
**Status:** Proposed — approved when the Owner merges this pull request
**Type:** Operations note (not an ADR — reversible: the whole environment can be deleted; no code, schema, RLS or ADR change)
**Decision:** Run a separate demo environment on Render — web service `clinic-ai-demo` and database `clinic-ai-demo-db` — fully isolated from production, holding synthetic data only, operated by the Owner only until a separate approval allows external demos.

## Context

Production has no active staff identity by design (CLAUDE.md, Status), so the authenticated click-through of P3-B, P3-C and P5 Slice 1B/1C cannot be shown or exercised there. The Owner ruled against creating a production test identity. A separate environment lets the Owner exercise the authenticated product with synthetic data without changing that production rule.

## What exists (reported by the Owner, 2026-10-21)

| Item           | Value                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Database       | `clinic-ai-demo-db` (`dpg-dbb8jbjrjlhs73crqcdg-a`), PostgreSQL 16, Frankfurt, 0.1c-256mb, 1 GB                                    |
| Schema         | Migrations 0001-0019 applied as `clinic_ai_demo_user` from main; 4 roles NOSUPERUSER NOBYPASSRLS; 8 FORCE RLS tables              |
| Web service    | `clinic-ai-demo` (`srv-dbbtnd0m7kps73d7id5g`), `https://clinic-ai-demo-54if.onrender.com`, Frankfurt, Starter, branch `main`      |
| Web env        | `NODE_VERSION=22`, `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_APP_URL` (demo URL), `APP_DATABASE_URL` (internal URL, `app_user`) |
| Not set on web | `DATABASE_URL`, `APP_USER_PASSWORD`, all Scaleway variables, `PORT`                                                               |

## Rules

1. **Isolation.** The demo shares no database, role, credential, secret, bucket or environment variable with production. Production (`clinic-ai-platform`, `clinic-ai-db`) is never touched by any demo operation.
2. **Synthetic data only.** No real patient, clinic or staff data. Every clinic name carries "(synthetic)". Owner and contact addresses are Owner-controlled plus-addresses.
3. **Owner-only access.** Until a separate Owner approval, only the Owner signs in. No prospect, design partner or third party receives a link, an account or a screen to type into. External demos require, at minimum, a visible "demo environment — no real patient data" notice in the UI, delivered through the normal change workflow.
4. **No AI readiness claim.** ADR-0019 is Proposed; no AI provider, key or call exists in the demo. The demo must not be presented as answering patients automatically.
5. **No relaxation.** ADR-0009 (EU/EEA residency), RLS, FORCE RLS and every Accepted ADR apply unchanged. The demo is not used to test anything that production governance forbids.
6. **No object storage.** The demo has no storage bucket, so knowledge-document upload is expected to fail there. Adding storage requires a separate approval and its own bucket and credentials.
7. **Secrets.** The demo database credentials and the demo owner's password live only in the Owner's password manager, are never reused in production, and are never pasted into chat, files, commits or screenshots. Invitation links are one-time secrets and are opened directly, never shared.
8. **Database network access.** The web service uses the internal URL. External access (needed only for operator scripts from Termux) is restricted through the database's Networking inbound rules once administrative operations are done, and reopened only for a specific operation.
9. **Not evidence for production.** Results in the demo do not change any production verification statement in CLAUDE.md (for example, that `scripts/provision-clinic.ts` is not proven in production), and the demo clinic does not satisfy the "synthetic demo clinic" item of `restore-drill-plan.md`, which refers to the production database.

## Cost and ownership

- Web service Starter: $7/month. Database 0.1c-256mb: $6/month (the price recorded for the same plan in `2026-09-12-database-plan-decision.md`; to be confirmed on the invoice).
- Cost owner and the person responsible for shutdown: the Owner.
- Shutdown criteria: delete the demo environment if it has not been used for 60 days, or when a production pilot clinic replaces it, whichever comes first.

## Disposal

Disposal deletes, in this order: the web service, the database, the demo entries in the password manager. There is no object storage and no external service to clean up. Render-side logs follow Render's retention; the application code has no `console` logging at main `0f7680b`, though Next.js itself may log unhandled errors.

## Out of scope of this note

- Running `scripts/provision-clinic.ts` for real (separate Owner approval).
- The demo notice in the UI (separate change, Gate 1 first).
- Any brand name: none is decided on main.
