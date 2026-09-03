# Clinic AI Platform — resume here (2026-09-03, evening)

## Where we are
P1 and P2a are both merged to main. The database, tenant isolation, and
staff authentication are now real code, not documentation.

- PR #25 (P1 Postgres + RLS tenant isolation) → merged as 2e0875c
- PR #29 (P2a staff auth + sessions) → merged as 6a8a95b
- PR #30 (regression tests for the ROLLBACK failure path) → merged
- All branches deleted. CI green on main.
- PR #6 (docs/project-memory templates) closed as superseded by this file.
- docs/STATUS.md is in .prettierignore — it is hand-edited from the browser.

ChatGPT is no longer available (free tier exhausted), so it no longer acts
as architect/challenger. That role now falls to Claude in chat. Claude Code
still implements; the human still decides and merges.

## Immediate open question
ADR-0012's status line may still say Proposed in docs/adr/. The human
approval comment was posted on PR #29 (satisfying CLAUDE.md hard rule 2),
but the file text itself may not have been updated. Check
docs/adr/0012-*.md and fix the status line if needed — one-line PR.

## Verified security properties (do not re-derive these)
From P1 (PR #25):
- app_user is NOSUPERUSER NOBYPASSRLS, asserted unconditionally outside the
  DO block so a pre-existing elevated role is corrected, not accepted
- patients has ENABLE + FORCE ROW LEVEL SECURITY, policy has USING and
  WITH CHECK
- tenant context via set_config('app.current_clinic_id', $1, true) inside
  the transaction; bind parameter, never interpolated
- no tenant context → NULL predicate → zero rows (fail-closed)
- clinics deliberately has no RLS: a clinic must find its own row before
  tenant context exists
- app_user's password is not in any committed file; scripts/migrate.ts sets
  it via set_config bind parameter + format(..., %L) inside EXECUTE

From P2a (PR #29):
- auth_bootstrap role is BYPASSRLS + NOLOGIN + NOSUPERUSER; the bypass is
  confined to two SECURITY DEFINER plpgsql functions it owns, search_path
  pinned, PUBLIC has no EXECUTE, only app_user does
- direct table access on staff_members / staff_sessions with no tenant
  context still fails closed for app_user
- clinic_id never taken from request input
- password_hash and raw tokens never in a response body
- session validity enforced in the DB query, not re-derived in the app layer
- no dynamic or interpolated SQL

## Open follow-ups (none blocking, none yet filed as issues — verify before
## opening, the issue count moved 4 → 7 during the session)
1. clinics: GRANT SELECT on the whole table exposes every tenant's name,
   owner_email, contact_email, contact_phone to any app_user connection —
   personal data under GDPR. Proposed fix:
   GRANT SELECT (id, name, status, working_hours) ON clinics TO app_user.
   GRANT INSERT also lets the runtime role create tenants, which is an
   administrative operation.
2. ADR-0006's mandatory pooler CI check is implemented as a code-level
   guard, not a real pooler-config check. The ADR condition is NOT met.
3. 3 pre-existing high-severity npm audit advisories in next's transitive
   postcss/sharp deps.
4. No dedicated sign-in page yet — the (app) guard redirects to /.
5. 0003_clinics.sql: comment describes clinics_id_key UNIQUE (id) as a
   composite FK target, but it is single-column and redundant given the PK.
6. Operational, for the hosting decision record: app_user's password is
   visible in pg_stat_activity while migrate runs, and would be captured
   under log_statement='all'.
7. CLAUDE.md stale lines: ADR-0009 listed as Proposed (it is Accepted); the
   P1-complete claim is now actually true post-merge but was written when it
   covered docs only.

Closed during the 2026-09-04 session: old 2 and 3 (db.ts ROLLBACK and
withoutTenantContext) were already fixed in #29; old 10 (README phase table)
is fixed.

## Roadmap (docs/03-roadmap.md is authoritative, P0-P5 only)
- P0 Foundation — done
- P1 Multi-tenancy and data — done (2e0875c)
- P2 Authentication and authorization — P2a done (6a8a95b); roles and
  permissions per ADR-0004 still to do
- P3 Conversations — planned
- P4 Appointments — planned
- P5 Knowledge base and AI — planned, hard criteria E1-E7 from ADR-0011

## Hard rules (CLAUDE.md)
1. Phase gating. 2. No ADR status change without a human comment on the PR.
3. Humans merge, agents only open PRs. 4. No real patient data. 5. One-way
door choices get their own ADR before code.

## Decisions still to make
- Post-operative instructions: may the AI quote clinic-authored aftercare
  text at all, or only via a labelled document lookup? Gates P5 knowledge
  base content policy. Cheap now, expensive to retrofit.
- Hosting choice — reversible, record as an issue, NOT an ADR.
- AI vendor undecided; shortlist on #18 is Mistral La Plateforme and AWS
  Bedrock eu-central-1, planning candidates only. ADR-0007 requires EU
  endpoint, DPA, no training on customer data, no patient identifiers in
  prompts.
- External EU regulatory review required before the first paying clinic
  (ADR-0011 §5).

## Working constraints
Solo, mobile-only. Docs edited via the GitHub web UI, code via Claude Code.
Repo: alarapioranse-dotcom/clinic-ai-platform (public).
Stack: Next.js 16 App Router, TypeScript strict, Tailwind v4, PostgreSQL
with RLS, pgvector in the same DB, `pg` client, Vitest. No ORM. No
supabase-js/PostgREST for tenant-scoped access.

Mobile notes: renaming a file in the GitHub web editor moves it to the repo
root unless the full path is typed. Prettier fails on hand-aligned markdown
tables — use bullet lists. To read a file quickly, open the raw URL and
Select all → Copy rather than pasting screenshots.

## My question for the new session
Two candidates for the next slice: finish P2 (roles and permissions per
ADR-0004), or clear the follow-up issues above first. Which, and why?
