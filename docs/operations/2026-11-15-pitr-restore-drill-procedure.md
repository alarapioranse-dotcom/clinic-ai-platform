# PITR restore drill procedure — production `clinic-ai-db`

**Status:** executed by the Owner on 2026-11-15 from Termux and the Render dashboard, from the script at main `2fef02b` (#146): **pass**; see [Execution record](#execution-record-2026-11-15) at the end. **Scope:** Phase 3 of
[the restore drill plan](./restore-drill-plan.md): restore production into a separate, temporary
Render database with point-in-time recovery (PITR), compare it with production read-only, and delete
it the same day. Production is only read. The web service is never pointed at the copy.

The Owner chose this approach on 2026-11-15 (option A): a small read-only comparison script kept in
this repository, [`scripts/restore-drill-check.sql`](../../scripts/restore-drill-check.sql),
instead of re-baselining restore-check v10.3 (which was built on migrations 0001-0018, while
production now runs 0001-0021). restore-check stays outside the repository and unchanged.

This file contains no secret. Database URLs are typed into Termux with `read -rs` and never written
down; the outputs contain only counts, md5 digests, clinic ids and role names.

## What the script checks

`restore-drill-check v1` runs in one `READ ONLY REPEATABLE READ` transaction that ends in `ROLLBACK`
and stops on the first error. It stops before reading anything if the current role is a superuser
or has `BYPASSRLS`. It prints:

- `H` lines: PostgreSQL major version, session and current role, read-only flag, recovery flag;
- `C` lines, one per catalog component, as `<count> <md5>`: roles and their attributes, memberships
  (with `INHERIT`, `SET`, `ADMIN`), schemas, extensions, tables with their RLS and FORCE RLS flags
  and grants, columns, policies, functions (owner, `SECURITY DEFINER`, `search_path`, grants, md5 of
  the source), constraints, indexes, triggers and default privileges;
- `R` lines for `schema_migrations` and `clinics`;
- `X` and `T` lines: for every clinic, the tenant context is set to that clinic and each table with
  row level security is counted and digested; then the same under a clinic id that does not exist,
  where every count must be `0`.

Two outputs are a pass only if they are byte-identical. Any differing line is a finding.

## Local rehearsal (2026-11-15)

On an isolated local PostgreSQL 16.15 cluster holding migrations 0001-0021 and synthetic data for
two clinics (all 9 RLS tables populated: staff, sessions, invitations, patients, conversations,
messages, appointments, knowledge documents and chunks), run as a non-superuser owner role like
production's:

- Source and a physical copy (`pg_basebackup -X stream`, the local analogue of PITR): 51 lines each,
  byte-identical (sha256 `f9aabec64b8feae249863cc0eff7f862b8c11d48533b8bccb234846b99934c30`).
- Negative controls, each made in the copy only, each detected:
  - one patient's `display_name` changed: only that clinic's `patients` line differed;
  - one message's `content` changed: only that clinic's `messages` line differed;
  - `NO FORCE ROW LEVEL SECURITY` on `knowledge_document_chunks`: the `relations` line differed, and
    the owner role then saw both clinics' chunks under every context, including the non-existent
    clinic (count `2` instead of `0`);
  - `GRANT DELETE ON knowledge_documents TO app_user`: the `relations` line differed;
  - an inheriting membership in `knowledge_document_processor`: the `memberships` line differed;
  - an extra function: the `functions` line differed.
- Run as a superuser, the script printed `STOP` and exited with code 3 without reading any row.
- The copy was deleted afterwards.

What the rehearsal does not prove: Render's PITR behaviour, the recovery instance's credentials,
region or cost, or the time a restore takes. That is what this drill is for.

## Expected values

| Item                            | Value                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| `restore-drill-check.sql`       | sha256 `4c4adbc2a2a79625bd8132b94b0273e37904bcc32062bce2b744bfed5f31879f` |
| Production database             | `clinic-ai-db`, id `dpg-daekbjmq1p3s739nc4og-a`, Frankfurt                |
| Recovery instance name          | `clinic-ai-db-drill-YYYYMMDD` (the drill's date)                          |
| Migrations recorded (both)      | 21                                                                        |
| `H read_only` / `H in_recovery` | `on` / `false` on both                                                    |

## Step 1 — look only (Render dashboard)

Open `clinic-ai-db` → **Recovery** → **Point-in-Time Recovery** → **Restore Database**. Note the
available time range, the region and the price the form shows. Do **not** press **Start Recovery**.
Close the form. Any region outside the EU/EEA stops the drill (ADR-0009 §3).

## Step 2 — download the script (Termux)

From the merge commit of the pull request that adds this file (not a branch):

```sh
mkdir -p ~/drill && cd ~/drill
curl -fsSO https://raw.githubusercontent.com/alarapioranse-dotcom/clinic-ai-platform/<MERGE_COMMIT>/scripts/restore-drill-check.sql
echo "4c4adbc2a2a79625bd8132b94b0273e37904bcc32062bce2b744bfed5f31879f  restore-drill-check.sql" | sha256sum -c
```

Anything other than `OK` stops here.

## Step 3 — read production (Termux, read-only)

Paste the first line alone, then paste the production External Database URL (it is not shown):

```sh
read -rs DATABASE_URL && export DATABASE_URL PGSSLMODE=verify-full PGSSLROOTCERT=system && echo URL-SET
```

URL guard, identical to the 0020 and 0021 procedures:

```sh
case "$DATABASE_URL" in
  *@*@*|*://*/*/*)
    echo "STOP: this is not the production database URL"; unset DATABASE_URL ;;
  postgresql://clinic_ai_platform_user2:*@dpg-daekbjmq1p3s739nc4og-a.frankfurt-postgres.render.com/clinic_ai_platform|postgres://clinic_ai_platform_user2:*@dpg-daekbjmq1p3s739nc4og-a.frankfurt-postgres.render.com/clinic_ai_platform)
    echo "HOST-OK: production clinic-ai-db as clinic_ai_platform_user2" ;;
  *)
    echo "STOP: this is not the production database URL"; unset DATABASE_URL ;;
esac
```

Only after `HOST-OK`:

```sh
date -u +%Y-%m-%dT%H:%M:%SZ; psql "$DATABASE_URL" -X -q -f restore-drill-check.sql > prod.txt; echo "exit=$?"; unset DATABASE_URL; wc -l prod.txt; head -7 prod.txt
```

Expected: `exit=0`, `restore-drill-check v1` on the first line and `H current_user
clinic_ai_platform_user`. Note the printed UTC time: the restore point in step 4 must be after it.

## Step 4 — start the recovery (Render dashboard)

Wait until at least 10 minutes have passed since step 3. Then `clinic-ai-db` → **Recovery** →
**Restore Database**:

- Name: `clinic-ai-db-drill-YYYYMMDD`.
- Time: a time after step 3's UTC time and at least 10 minutes before now.
- **Copy Existing Settings**: Yes.
- Press **Start Recovery**, and note the time.

Never change the web service or any environment variable. Wait until the new database shows
**Available**, and note the time.

## Step 5 — read the copy (Termux, read-only)

Open the new database `clinic-ai-db-drill-YYYYMMDD` → **Connect** → copy its **External Database
URL**. Paste the first line alone, then the URL:

```sh
read -rs COPY_URL && export COPY_URL PGSSLMODE=verify-full PGSSLROOTCERT=system && echo URL-SET
```

Guard: it must be a Frankfurt Render database and must **not** be production:

```sh
case "$COPY_URL" in
  *dpg-daekbjmq1p3s739nc4og-a*)
    echo "STOP: this is production, not the copy"; unset COPY_URL ;;
  *@*@*|*://*/*/*)
    echo "STOP: unexpected URL shape"; unset COPY_URL ;;
  postgres://*@dpg-*-a.frankfurt-postgres.render.com/*|postgresql://*@dpg-*-a.frankfurt-postgres.render.com/*)
    echo "$COPY_URL" | sed -E 's#^(postgres(ql)?://)([^:]*):[^@]*@([^/]*)/(.*)$#COPY-OK: user=\3 host=\4 db=\5#' ;;
  *)
    echo "STOP: not a Frankfurt Render database URL"; unset COPY_URL ;;
esac
```

Only after `COPY-OK` (it shows the user, host and database name, never the password):

```sh
psql "$COPY_URL" -X -q -f restore-drill-check.sql > copy.txt; echo "exit=$?"; unset COPY_URL; sha256sum prod.txt copy.txt; diff prod.txt copy.txt && echo IDENTICAL
```

Then show both files and paste them, with the four times noted, into the chat:

```sh
cat prod.txt; echo ----; cat copy.txt
```

A pass is `exit=0`, the same sha256 twice and `IDENTICAL`. Anything else is a finding; do not retry
with changes, report it.

## Step 6 — delete the copy the same day (Render dashboard)

Open **`clinic-ai-db-drill-YYYYMMDD`** (check the name: it must end in `-drill-` and a date, and it
must not be `clinic-ai-db`) → **Settings** → **Delete Database**, and confirm with its name. Check
that it no longer appears in the dashboard and that `clinic-ai-db` is still there and Available.
Then clean up Termux:

```sh
cd ~ && rm -rf ~/drill && history -c && history -w && clear && echo CLEARED
```

## Step 7 — record

The result (times, sha256 of both outputs, pass or finding, deletion confirmed) is recorded in this
file and in [the restore drill plan](./restore-drill-plan.md) by pull request.

## Limits

- Production holds one clinic, the deployment-validation seed clinic, with almost no rows. A pass
  proves that the structure (roles, memberships, grants, RLS, policies, functions, constraints) and
  those rows come back intact, and measures restore time. It does not prove restore at production
  volume.
- It does not cover knowledge-document files in Scaleway Object Storage, which PITR does not restore
  (open item in the plan).
- It proves the copy matches production at the moment each was read; it is not proof that every past
  state is recoverable.

## Execution record (2026-11-15)

Run by the Owner, relayed to the implementation agent in chat. Times are Europe/Athens (UTC+02:00)
unless marked UTC.

| Step               | Result                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Recovery form   | Window: any time in the past 3 days. Plan shown: `0.1c-256mb` (production's). Region and price not shown on the form. Nothing started.                                                                                                                                                                                                   |
| 2. Script          | Downloaded from `2fef02bc2a22e0f42e659c9f5799e91e1a072817`; `restore-drill-check.sql: OK`.                                                                                                                                                                                                                                               |
| 3. Production read | URL guard `HOST-OK`; read at `2026-11-15T12:20:12Z`; `exit=0`; 41 lines; `H current_user clinic_ai_platform_user`.                                                                                                                                                                                                                       |
| 4. Recovery        | Name `clinic-ai-db-drill-20261115`, restore point `2026-11-15 14:21:00` (12:21:00 UTC), Copy Existing Settings: Yes. Started about 14:45, **Available** before 14:53 (about 8 minutes). Info page: region **Frankfurt (EU Central)**, plan `0.1c-256mb`, PostgreSQL 16, service id `dpg-dbsqinafngtc738aru40-a`, storage 21.42% of 1 GB. |
| 5. Copy read       | Guard `COPY-OK: user=clinic_ai_platform_user2 host=dpg-dbsqinafngtc738aru40-a.frankfurt-postgres.render.com db=clinic_ai_platform_hti2`; `exit=0`.                                                                                                                                                                                       |
| Comparison         | Both outputs sha256 `c687e6d918f4201ec86341b86554cf2d8f472b02d09ea3e1e1694bf2a6303aed`; `diff`: **IDENTICAL**.                                                                                                                                                                                                                           |
| 6. Deletion        | The Owner deleted `clinic-ai-db-drill-20261115` the same day, confirmed `clinic-ai-db` still present, and cleared Termux (`CLEARED`).                                                                                                                                                                                                    |

Production output (identical to the copy's; contains only counts, digests, role names and the seed
clinic's id):

```
restore-drill-check v1
H server_major 16
H session_user clinic_ai_platform_user2
H current_user clinic_ai_platform_user
H read_only on
H in_recovery false
C roles 12 407a56cf71c3b07217f931649e5865cb
C memberships 18 8ef182e353f41ce46d11450151aedf90
C schemas 1 f2c6acf728d21305352deff82d29d38c
C extensions 3 2dd43f0fa47a58d2dd4f7037aecf9140
C relations 11 1b382397f393847860dfad26e0bc38fb
C columns 85 cfd3849b4ca6951a8a498ebd455988f7
C policies 13 2ce0b465d6af42984133feef9e98bba8
C functions 232 c7a4d75d292b833cb6aeb44ff9f7c620
C constraints 72 a811a5341ada27eea71bc1cf5539669f
C indexes 32 985695e4847f2a39af2276dd682262a4
C triggers 3 ca2e5c2c7f6b08a0d0c42469554b61a9
C default_privileges 4 03265f3ed926ed6c9579118a0ae71b87
R schema_migrations 21 fc47a60fb5a1d14cbe8790dc2175c1bc
R clinics 1 db73335b96dec50f9ef203f25a14b15d
X 00000000-0000-0000-0000-000000000001 true
T 00000000-0000-0000-0000-000000000001 appointments 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 conversations 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 invitations 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 knowledge_document_chunks 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 knowledge_documents 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 messages 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 patients 0 d41d8cd98f00b204e9800998ecf8427e
T 00000000-0000-0000-0000-000000000001 staff_members 1 e3f054a25cf5dc5b5ffb1fb7e8015955
T 00000000-0000-0000-0000-000000000001 staff_sessions 1 7bcf43cd6c8663f0472841c37437af58
X ffffffff-ffff-4fff-bfff-ffffffffffff true
T ffffffff-ffff-4fff-bfff-ffffffffffff appointments 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff conversations 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff invitations 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff knowledge_document_chunks 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff knowledge_documents 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff messages 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff patients 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff staff_members 0 d41d8cd98f00b204e9800998ecf8427e
T ffffffff-ffff-4fff-bfff-ffffffffffff staff_sessions 0 d41d8cd98f00b204e9800998ecf8427e
restore-drill-check end
```

Observations:

- **Pass.** The PITR copy matched production in every catalog component (roles, memberships, RLS and
  FORCE RLS flags, grants, policies, functions, constraints, indexes, triggers, default privileges)
  and in every row read under the seed clinic's context. Under a non-existent clinic every RLS table
  returned 0 rows in both.
- The copy's database is named `clinic_ai_platform_hti2`, not `clinic_ai_platform`: Render renames
  the database on recovery. The same login worked, with the same `current_user`. A real recovery
  would need `DATABASE_URL` and `APP_DATABASE_URL` changed to the new host and database name.
- Production's `schemas`, `extensions`, `relations`, `columns`, `policies`, `functions`,
  `constraints`, `indexes`, `triggers` and `default_privileges` lines are identical to the local
  rehearsal's on migrations 0001-0021, so production's schema matches the repository. `roles` and
  `memberships` differ from the rehearsal (Render's own roles), and `schema_migrations` differs
  (application times), as expected.
- Production holds one `staff_sessions` row. A follow-up read-only query the same day (seed clinic
  context, no token hash read) showed it was created `2026-09-06 16:34:47 UTC` for the seed
  receptionist, revoked `2026-09-09 21:07:44 UTC`, expired `2026-09-13`, and the receptionist is
  `deactivated`. It is the deployment-validation session from September, not new activity, and
  cannot authenticate (the lookup requires an active member and an unexpired, unrevoked session).
  The earlier note that production had "no sessions" was inaccurate: it has no usable session.
- The drill measured about 8 minutes from start to Available for a database using about 214 MB.
