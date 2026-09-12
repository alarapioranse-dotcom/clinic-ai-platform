# Operations Note — clinic-ai-db Compute Plan

**Date:** 2026-09-12
**Type:** Operations note (not an ADR — reversible, not materially security-relevant)
**Decision:** Upgrade `clinic-ai-db` to the smallest paid Render compute plan
(0.1c-256mb — 256 MB RAM, 100 connections, 1 GB storage included, $6/month).

## Context

The database was created 2026-09-06 on Render's Free compute plan. The
dashboard banner read verbatim:

> Your database will expire on October 6, 2026. The database will be deleted
> unless you upgrade to a paid compute plan.

Render's public documentation describes a 14-day grace period after expiry.
The banner does not mention it. Planning treats 6 October 2026 as the hard
date; the grace period is not relied upon.

## Rationale

- No irreplaceable production data, but preserving the established environment
  removes unnecessary operational churn.
- Phone-only operation makes provider migration disproportionately costly.
- Only one Free Postgres may be active per workspace, so the rebuild runbook
  cannot be rehearsed against a parallel target before it would be needed.
- Storage was at 6.55% of 1 GB; the smallest paid tier is ample.
- The upgrade is not a substitute for backup — off-platform dumps were taken
  first.

## Explicitly not part of this decision

- **Workspace plan stays Hobby.** Upgrading the workspace does not remove Free
  *instance* limits, so Pro at $25/month would not solve this problem.
- **Web service Free → paid ($7/month).** Separate future decision. It governs
  Pre-Deploy Command, Shell and One-Off Jobs — a manual-deployment convenience,
  not a P3-C prerequisite.

## Related

- `docs/operations/production-rebuild-runbook.md` remains **written but not
  executed or rehearsed**. This upgrade preserves the current environment; it
  does not verify the runbook. The runbook's role shifts from immediate
  continuity mechanism to disaster-recovery documentation.

## Backup assets (locations only — no credentials, no dumps in this repo)

- Git: reconstructible migration chain 0001–0010 (0010 merged in PR #48, not applied to production).
- Off-platform `pg_dump` (schema-only + custom format), taken 2026-09-12 while
  production was at 0009. Schema dump verified to contain 7 `CREATE TABLE` and
  14 `POLICY` statements. Held outside Git and outside Render; treated as
  sensitive operational material.
