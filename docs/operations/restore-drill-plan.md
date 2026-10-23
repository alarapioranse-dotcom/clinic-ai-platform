# Restore Drill Plan

**Date:** 2026-10-19
**Status:** Phase 1 (local rehearsal) done; Phase 2 (Render documentation) read; Phase 3 (Render
drill) not started and needs a separate Owner approval.
**Scope:** How to prove that the production database can be restored, and what has been proven so
far. This is an operations document, not an ADR.

## Why this exists

Backups are not proven (see the Status section of `CLAUDE.md`). No restore has ever been tested.
Production holds no real patient or clinic data today, so nothing is lost if this fails now, but a
restore path must be proven before the first real clinic goes live.

[`production-rebuild-runbook.md`](./production-rebuild-runbook.md) does not cover this. It rebuilds
an **empty** schema from Git; it does not restore data. It is also out of date: it describes the
Free database that expired on 2026-10-06, and its security checks do not cover the
`clinic_settings_writer` and `invitation_acceptor` roles or migration 0019. Updating it is a
separate change.

## Constraints

- RLS and FORCE RLS stay on. No role gets `BYPASSRLS` or `SUPERUSER`. No `NO FORCE ROW LEVEL
SECURITY`, including for backups.
- Synthetic data only, outside production.
- Nothing touches production, Render, PITR or a paid resource without the Owner's explicit approval
  for that step.
- Production steps run from Termux only: `read -rs DATABASE_URL`, `PGSSLMODE=require`, `unset`
  afterwards. No connection string or password in chat, files, commits or PR text.

## Why logical dumps are not the backup

Reproduced locally on 2026-10-19 (Phase 1 below), with the owner/migration role set up like
production's `clinic_ai_platform_user` (`NOSUPERUSER NOBYPASSRLS CREATEROLE CREATEDB`, migrations
0001-0019 applied as that role):

| Command run as the owner role       | Result                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_dump -Fc`                       | Fails with exit code 1 on `COPY public.appointments`, with the hint to use `NO FORCE ROW LEVEL SECURITY`.                                                                                                                                             |
| `pg_dump --enable-row-security -Fc` | Exits 0 but writes **0 rows** for all 8 tenant tables (`appointments`, `conversations`, `invitations`, `knowledge_documents`, `messages`, `patients`, `staff_members`, `staff_sessions`). Only `clinics` (2) and `schema_migrations` (19) carry rows. |

The second case is the dangerous one: it looks like a successful backup and is empty. Neither command
is an acceptable backup, and the fix it suggests is forbidden. Point-in-time recovery is therefore
the only restore path.

## Phase 1 — local rehearsal (done, 2026-10-19)

Local only, isolated PostgreSQL 16.15, synthetic data, deleted afterwards.

1. Created a non-superuser owner role matching production's attributes and a database it owns.
2. Applied migrations 0001-0019 with `npm run db:migrate` as that role. All 19 applied.
3. Loaded synthetic data for two clinics (`Drill Clinic A`, `Drill Clinic B`): per clinic 1 staff
   member, 1 session, 1 invitation, 1 knowledge document row, 5 patients, 5 conversations, 10
   messages, 5 appointments. Rows were inserted under each clinic's own tenant context, one
   transaction per clinic (the deferred conversation/message trigger checks at `COMMIT` under the
   active context).
4. Confirmed a query with an empty tenant context fails closed
   (`invalid input syntax for type uuid: ""`) rather than returning rows.
5. Took a physical base backup (`pg_basebackup -X stream`) into a second, separate cluster on another
   port. This is the closest local analogue to PITR, which also restores physically.
6. Ran a simple read-only comparison script on both clusters, as the owner role, inside
   `REPEATABLE READ READ ONLY` with `ROLLBACK`. It prints one md5 per catalog component (roles and
   their `rolsuper`/`rolbypassrls`/`rolinherit`, memberships with `INHERIT`/`SET`/`ADMIN`, RLS and
   FORCE RLS flags, policies, table and column grants, functions with owner, `SECURITY DEFINER`,
   `proconfig` and source, constraints, triggers, `schema_migrations`) and a count plus md5 per table
   per clinic, each read under that clinic's tenant context.
7. Result: all 27 lines identical between source and restored copy.
8. Negative control: changed one synthetic patient's `display_name` in the restored copy. The script
   reported exactly one difference (`B_patients`), and nothing else.
9. Stopped and deleted the restored cluster.

**What Phase 1 proves:** a physical copy of this schema keeps every role attribute, membership,
RLS flag, policy, grant and function definition, and every tenant's rows, with FORCE RLS on and no
bypass. The comparison method detects a one-field change.

**What it does not prove:** that Render's PITR behaves the same; that Render's recovery instance
keeps the roles and memberships Render manages; restore time; anything at production volume.

The simple comparison script above is a rehearsal aid only. The reviewed check is restore-check
v10.3; its results on the same rehearsal are below.

### restore-check v10.3 on the rehearsal (2026-10-19)

Run with psql 16.15 against PostgreSQL 16.15, as the owner role, on the source cluster and on a
fresh physical copy of it, both holding the same synthetic data as above.

- **Phase 1** (catalog only, no application row read): exit 0 on both. The 575-line outputs are
  byte-identical. Approval token
  `dd8a33efb05854e5759977249eef4d476a769c732c2f2278388e28e310032efa`. Section 18 classified all 8
  RLS tables as `isolated` (`cross_clinic=0`, `not_proven=0`) and predicted `PASS` as the best
  phase 2 result. All four SECURITY DEFINER functions show
  `search_path=pg_catalog, public, pg_temp`. v10.3 was baselined on migrations 0001-0018; it did not
  stop on 0019.
- **Phase 2** (counts and digests only), run after the Owner reviewed the token: exit 0 on both,
  `RESULT_CODE: PASS`, every one of the 8 RLS tables isolated in both clinic contexts with 0 foreign
  rows. The 123-line outputs are byte-identical.
- **Negative control:** after one synthetic patient's `display_name` was changed in the restored
  copy, phase 2 on that copy differed from the source in exactly one line, the clinic B `patients`
  digest.
- Both clusters, the drill database, its roles and the `pg_dump` files were deleted afterwards. Only
  the count and digest outputs were kept, outside the repository.

## restore-check

restore-check is the reviewed read-only comparison tool for this drill. It is kept outside this
repository (Owner ruling, 2026-10-19) and referenced here by version only:

- Version: v10.3, frozen as a read-only local baseline on 2026-10-17.
- Archive: `restore-check-v10.3-baseline.zip`, held by the Owner.
- Archive sha256: `48f70aaf4c772e9b8b39d429cf1dd15526ca8ea9b1a7fb531c7945e118b39efb` (verified
  2026-10-19; all 10 files inside also match the archive's own `MANIFEST-v10.3.sha256`).
- Not approved for use against production, Render or a PITR copy until the Owner approves Phase 3.
  A pass is not evidence that a backup is complete; it is evidence that the restored copy matches
  the source at the time both were read.

## Phase 2 — what Render documents (read 2026-10-19)

From Render's documentation page "Render Postgres Recovery and Backups"
(`https://render.com/docs/postgresql-backups`). This is the vendor's description, not a tested
result.

- PITR is available on paid compute plans only; this database is on one.
- Recovery window depends on the **workspace** plan: Hobby = past 3 days, Pro or higher = past 7
  days. Upgrading does not backfill the window.
- PITR creates a **new** database instance; the original is not changed. The recovery instance can
  be validated in isolation, then deleted.
- You cannot restore to a time within 10 minutes of the current time.
- "Copy Existing Settings" = No allows a different compute plan or project for the recovery
  instance. The recovery instance **always** copies the original's IP allow list.
- The page does not state the recovery instance's region, or its cost. Both must be confirmed in the
  dashboard before Phase 3 (ADR-0009 §3 requires EU/EEA for backups and copies).
- Render support (email of 2026-10-22, correspondence, not documentation): a recovery instance's
  data "stays in the region it originated in" (Frankfurt for `clinic-ai-db`); with "Copy Existing
  Settings" it uses the original's plan, and choosing to customise allows a different plan; it is
  "only charged while the service is running". This is the support team's answer, not Render's
  documentation or a change to its terms; the region and the billing details are still unproven
  until Phase 3 step 1 confirms them in the dashboard.
- Render also offers dashboard "Create export" logical backups (`.dir.tar.gz`, retained 7 days).
  The page does not say which database role produces them. Whether they include rows under FORCE
  RLS is **unknown**; they are not relied on until tested.

## Phase 3 — drill on Render (not started; needs Owner approval)

Proposed steps, each listed so it can be approved or refused individually:

1. In the Render dashboard, confirm the recovery instance's region (must be EU/EEA) and its cost.
2. Run restore-check phase 1 on production from Termux, read-only, and record the approval token.
3. Start a PITR recovery into a new instance with a clearly temporary name, at a time at least 10
   minutes in the past. Never point the web service, `DATABASE_URL` or `APP_DATABASE_URL` at it.
4. Run restore-check phase 1 and phase 2 on the recovery instance from Termux, read-only.
5. Compare tokens and digests. Any difference is a finding, not a pass.
6. Delete the recovery instance the same day. It contains live session token hashes and must not
   be left running.
7. Record the result (times, tokens, pass or fail) in this document by pull request.

Because production holds almost no rows today, Phase 3 mainly proves that the **structure**
(schema, roles, memberships, grants, RLS) comes back intact. A meaningful row-level check needs
the synthetic demo clinic (pilot readiness item) to exist first.

## Open items

- **Knowledge-document files are not backed up.** Uploaded files live in the Scaleway Object
  Storage bucket (FR-PAR), referenced by `knowledge_documents.storage_key`. The bucket has no
  lifecycle rule and no versioning or backup is recorded. A database restore alone can bring back
  rows that point to files that no longer exist, or miss files uploaded after the restore point.
  Recorded here as an open item only; no bucket change is made (Owner ruling, 2026-10-19).
- Render dashboard exports under FORCE RLS: untested (Phase 2).
- Recovery instance region and cost: Render support says the same region and billing only while it
  runs (2026-10-22); still to be confirmed in the dashboard at Phase 3 step 1.
- `production-rebuild-runbook.md` is out of date (see "Why this exists").
