# P1 procedure — apply migration 0021 to production

**Status:** executed by the Owner on 2026-11-13 from Termux, from the file at main `50a5802` (#137);
see [Execution record](#execution-record-2026-11-13) at the end. **Scope:** production database `clinic-ai-db`
(`dpg-daekbjmq1p3s739nc4og-a`) only, logged in as `clinic_ai_platform_user2` and executing as
`clinic_ai_platform_user`, from the Owner's Termux. This file contains no secret; the database URL is
typed into Termux with `read -rs` and never written down.

What 0021 does ([ADR-0030](../adr/0030-staff-keyword-search-over-clinic-documents.md) decision 3):
it grants `knowledge_document_processor` column `UPDATE (ready_at)` on `knowledge_documents`,
replaces `store_knowledge_document_chunks` so that storing a chunk set also makes the document
`ready`, and moves any document that already has a chunk set from `processing` to `ready`.
Production held no knowledge documents when last checked (2026-10-26), so the last part is expected
to change no row.

The login and executing roles, Render's four default-privilege rows, the URL guard and the TLS
setting are exactly as recorded in
[the 0020 procedure](./2026-10-25-p1-migration-0020-procedure.md); the checks below repeat every
condition they rely on rather than assuming it.

Rulings carried over from 0020: any result other than `READY` stops before the apply; any result
other than `VERIFIED` stops and is reported; PITR is not relied on — a failure before `COMMIT` rolls
the whole transaction back, and a problem after `COMMIT` gets a separate Owner decision, normally a
forward-fix migration.

## Expected values

| Item                                                           | Value                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `0021_knowledge_document_ready_on_store.sql`                   | sha256 `d0c80b6d118e34eca19493e64da51bb20af94d8795c7bc5c61cb753b60f0fa10` |
| Migration ids before (20), `md5` in `C` order joined by `,`    | `0763e669b8d4c4a569f1ebe85c48c0a4` (recorded after 0020 on 2026-10-25)    |
| Migration ids after (21)                                       | `b146505fb9807c355a66b69240025dfe`                                        |
| `md5(prosrc)` store_knowledge_document_chunks before (0020)    | `5e71e9bbb0ed2c5a2d3d7940fab0eaf7`                                        |
| `md5(prosrc)` store_knowledge_document_chunks after (0021)     | `389a194cf0b1685098172766d80f0f4d`                                        |
| `md5(prosrc)` mark_knowledge_document_failed (both, unchanged) | `de7bed5aa9b0f9b8e7d27774cee48d5c`                                        |

Download the file from the **merge commit of the 0021 pull request** (not a branch) into a new
folder `~/c21` (`mkdir -p ~/c21 && cd ~/c21`); every later step runs from there:
`https://raw.githubusercontent.com/alarapioranse-dotcom/clinic-ai-platform/<MERGE_COMMIT>/db/migrations/0021_knowledge_document_ready_on_store.sql`,
then check it:

```sh
echo "d0c80b6d118e34eca19493e64da51bb20af94d8795c7bc5c61cb753b60f0fa10  0021_knowledge_document_ready_on_store.sql" | sha256sum -c
```

Anything other than `OK` stops here.

## 0. Before connecting (read-only, Render dashboard)

Confirm on `clinic-ai-db` that point-in-time recovery is enabled, and note the time. Change nothing.

## 1. URL guard (after `read -rs DATABASE_URL && export DATABASE_URL PGSSLMODE=verify-full PGSSLROOTCERT=system`)

Identical to the 0020 procedure. It accepts only the External Database URL of the production
database with the login `clinic_ai_platform_user2`; anything else is unset.

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

## 2. Read-only pre-check — must print `READY`

It prints `decision` and one column per condition. The second block below prints how many knowledge
documents exist and how many of them the backfill would move to `ready` (`to_backfill`). Both are
expected to be `0`; a non-zero count does not by itself stop the procedure, but report it before
applying.

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
WITH c AS (
  SELECT
    (SELECT count(*) FROM schema_migrations) = 20
      AND (SELECT max(id) FROM schema_migrations) = '0020_knowledge_document_chunks.sql'
      AND (SELECT pg_catalog.md5(pg_catalog.string_agg(id, ',' ORDER BY id COLLATE "C")) FROM schema_migrations)
          = '0763e669b8d4c4a569f1ebe85c48c0a4'
      AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0021_knowledge_document_ready_on_store.sql')
      AS migrations_ok,
    current_user = 'clinic_ai_platform_user'
      AND session_user = 'clinic_ai_platform_user2'
      AND COALESCE((SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid()), false)
      AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)
      AND pg_catalog.current_setting('transaction_isolation') = 'read committed'
      AS session_ok,
    NOT (SELECT bool_or(pg_catalog.pg_has_role(current_user, t, 'USAGE'))
           FROM unnest(ARRAY['auth_bootstrap','clinic_settings_writer','invitation_acceptor',
                             'knowledge_document_processor']) t)
      AND pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'SET')
      AS memberships_ok,
    (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'knowledge_document_processor' AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
        AND p.proacl::text = '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}'
        AND ((p.proname = 'store_knowledge_document_chunks' AND pg_catalog.md5(p.prosrc) = '5e71e9bbb0ed2c5a2d3d7940fab0eaf7')
          OR (p.proname = 'mark_knowledge_document_failed' AND pg_catalog.md5(p.prosrc) = 'de7bed5aa9b0f9b8e7d27774cee48d5c'))) = 2
      AS functions_ok,
    COALESCE((SELECT pg_catalog.string_agg(attname || '=' || attacl::text, ' ' ORDER BY attnum) FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.knowledge_documents'::regclass AND attacl IS NOT NULL), 'NULL')
      = 'id={knowledge_document_processor=r/clinic_ai_platform_user} clinic_id={knowledge_document_processor=r/clinic_ai_platform_user} status={knowledge_document_processor=rw/clinic_ai_platform_user} failed_reason={knowledge_document_processor=w/clinic_ai_platform_user}'
      AND COALESCE((SELECT relacl::text FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_documents'::regclass), 'NULL')
        = '{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=ar/clinic_ai_platform_user}'
      AS acl_ok,
    (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace) = 6
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                       WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                         AND pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE'))
      AS all_secdef_ok,
    COALESCE((SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace::text
                     || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text, ';'
                     ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole)::text COLLATE "C", d.defaclnamespace,
                              d.defaclobjtype::text COLLATE "C", d.defaclacl::text COLLATE "C")
               FROM pg_catalog.pg_default_acl d), '')
      = 'postgres|0|S|{postgres=rwU/postgres,clinic_ai_platform_user=rwU/postgres};postgres|0|T|{=U/postgres,postgres=U/postgres,clinic_ai_platform_user=U/postgres};postgres|0|f|{=X/postgres,postgres=X/postgres,clinic_ai_platform_user=X/postgres};postgres|0|r|{postgres=arwdDxt/postgres,clinic_ai_platform_user=arwdDxt/postgres}'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
      AS environment_ok
)
SELECT CASE WHEN COALESCE(migrations_ok AND session_ok AND memberships_ok AND functions_ok AND acl_ok
                          AND all_secdef_ok AND environment_ok, false)
            THEN 'READY' ELSE 'STOP' END AS decision,
       migrations_ok, session_ok, memberships_ok, functions_ok, acl_ok, all_secdef_ok, environment_ok,
       (SELECT count(*) FROM public.clinics) AS clinics,
       pg_catalog.now() AT TIME ZONE 'UTC' AS checked_at_utc
  FROM c;
ROLLBACK;
SQL
```

`clinics` is printed because the backfill reads it. The document counts are taken per clinic,
because `knowledge_documents` has FORCE RLS and the executing role sees no row without a tenant
context. The block writes nothing (a read-only transaction refuses any write, even to a temporary
table); it prints one `NOTICE` line with the totals:

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$
DECLARE
  v uuid;
  v_documents bigint := 0;
  v_to_backfill bigint := 0;
BEGIN
  FOR v IN SELECT id FROM public.clinics LOOP
    PERFORM pg_catalog.set_config('app.current_clinic_id', v::text, true);
    v_documents := v_documents + (SELECT count(*) FROM public.knowledge_documents);
    v_to_backfill := v_to_backfill + (
      SELECT count(*) FROM public.knowledge_documents d
       WHERE d.status = 'processing'
         AND EXISTS (SELECT 1 FROM public.knowledge_document_chunks k WHERE k.document_id = d.id));
  END LOOP;
  RAISE NOTICE 'documents=% to_backfill=%', v_documents, v_to_backfill;
END
$$;
ROLLBACK;
SQL
```

## 3. Apply — the only step that changes anything

Exactly as `scripts/migrate.ts` wraps a file: one transaction with the file and its
`schema_migrations` row. 0021 switches to `knowledge_document_processor` for the function
replacement and switches back inside the file (ADR-0025), so the `INSERT` runs as
`clinic_ai_platform_user`. Expected: `INSERT 0 1`, `COMMIT`, `exit=0`, **no `WARNING` and no
`ERROR` line**. Any `ERROR` or non-zero exit means the transaction was rolled back and nothing
changed; stop and report.

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SELECT pg_catalog.now() AT TIME ZONE 'UTC' AS started_at_utc, current_user AS who,
       pg_catalog.current_database() AS database;
BEGIN;
\i 0021_knowledge_document_ready_on_store.sql
SELECT current_user AS who_before_insert;
INSERT INTO schema_migrations (id) VALUES ('0021_knowledge_document_ready_on_store.sql');
COMMIT;
SELECT pg_catalog.now() AT TIME ZONE 'UTC' AS committed_at_utc;
SQL
echo "exit=$?"
```

`who_before_insert` must print `clinic_ai_platform_user`.

## 4. Read-only post-check — must print `VERIFIED`

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
WITH c AS (
  SELECT
    (SELECT count(*) FROM schema_migrations) = 21
      AND (SELECT max(id) FROM schema_migrations) = '0021_knowledge_document_ready_on_store.sql'
      AND (SELECT count(*) FROM schema_migrations WHERE id = '0021_knowledge_document_ready_on_store.sql') = 1
      AND (SELECT pg_catalog.md5(pg_catalog.string_agg(id, ',' ORDER BY id COLLATE "C")) FROM schema_migrations)
          = 'b146505fb9807c355a66b69240025dfe'
      AS migrations_ok,
    current_user = 'clinic_ai_platform_user'
      AND COALESCE(pg_catalog.current_setting('app.current_clinic_id', true), '') = ''
      AS session_ok,
    (SELECT NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
       FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
                       WHERE roleid = 'knowledge_document_processor'::regrole
                         AND (inherit_option OR member <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = 'knowledge_document_processor'::regrole)
      AND NOT (SELECT bool_or(pg_catalog.pg_has_role(current_user, t, 'USAGE'))
                 FROM unnest(ARRAY['auth_bootstrap','clinic_settings_writer','invitation_acceptor',
                                   'knowledge_document_processor']) t)
      AND pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'SET')
      AS memberships_ok,
    (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'knowledge_document_processor' AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
        AND p.proacl::text = '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}'
        AND ((p.proname = 'store_knowledge_document_chunks' AND pg_catalog.md5(p.prosrc) = '389a194cf0b1685098172766d80f0f4d')
          OR (p.proname = 'mark_knowledge_document_failed' AND pg_catalog.md5(p.prosrc) = 'de7bed5aa9b0f9b8e7d27774cee48d5c'))) = 2
      AS functions_ok,
    COALESCE((SELECT pg_catalog.string_agg(attname || '=' || attacl::text, ' ' ORDER BY attnum) FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.knowledge_documents'::regclass AND attacl IS NOT NULL), 'NULL')
      = 'id={knowledge_document_processor=r/clinic_ai_platform_user} clinic_id={knowledge_document_processor=r/clinic_ai_platform_user} status={knowledge_document_processor=rw/clinic_ai_platform_user} failed_reason={knowledge_document_processor=w/clinic_ai_platform_user} ready_at={knowledge_document_processor=w/clinic_ai_platform_user}'
      AND COALESCE((SELECT relacl::text FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_documents'::regclass), 'NULL')
        = '{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=ar/clinic_ai_platform_user}'
      AND NOT pg_catalog.has_table_privilege('app_user', 'public.knowledge_documents', 'UPDATE, DELETE, TRUNCATE')
      AND NOT pg_catalog.has_any_column_privilege('app_user', 'public.knowledge_documents', 'UPDATE')
      AND NOT pg_catalog.has_any_column_privilege('public', 'public.knowledge_documents', 'SELECT, INSERT, UPDATE, REFERENCES')
      AS acl_ok,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
      WHERE oid = 'public.knowledge_documents'::regclass)
      AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.knowledge_document_chunks'::regclass)
      AS rls_ok,
    (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace) = 6
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                       WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                         AND (pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
                              OR NOT pg_catalog.has_function_privilege('app_user', p.oid, 'EXECUTE')))
      AS all_secdef_ok,
    COALESCE((SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace::text
                     || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text, ';'
                     ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole)::text COLLATE "C", d.defaclnamespace,
                              d.defaclobjtype::text COLLATE "C", d.defaclacl::text COLLATE "C")
               FROM pg_catalog.pg_default_acl d), '')
      = 'postgres|0|S|{postgres=rwU/postgres,clinic_ai_platform_user=rwU/postgres};postgres|0|T|{=U/postgres,postgres=U/postgres,clinic_ai_platform_user=U/postgres};postgres|0|f|{=X/postgres,postgres=X/postgres,clinic_ai_platform_user=X/postgres};postgres|0|r|{postgres=arwdDxt/postgres,clinic_ai_platform_user=arwdDxt/postgres}'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
      AS environment_ok
)
SELECT CASE WHEN COALESCE(migrations_ok AND session_ok AND memberships_ok AND functions_ok AND acl_ok
                          AND rls_ok AND all_secdef_ok AND environment_ok, false)
            THEN 'VERIFIED' ELSE 'NOT VERIFIED' END AS result,
       migrations_ok, session_ok, memberships_ok, functions_ok, acl_ok, rls_ok, all_secdef_ok, environment_ok
  FROM c;
ROLLBACK;
SQL
```

Then run the per-clinic count block of step 2 again: `to_backfill` must now be `0`, and `documents`
must equal the number step 2 printed.

## 5. Clean up

```sh
unset DATABASE_URL PGSSLMODE PGSSLROOTCERT && cd ~ && rm -rf ~/c21 && echo CLEARED
```

## Rehearsal (2026-11-13, fresh production-shaped PostgreSQL 16 cluster)

A separate local cluster with: a non-superuser, non-`BYPASSRLS`, `CREATEROLE` owner
`clinic_ai_platform_user` that owns the database and the `public` schema; a login role
`clinic_ai_platform_user2`, member of it with `INHERIT TRUE, SET TRUE` granted by `postgres` and the
role setting `role=clinic_ai_platform_user`; Render's extra `pg_read_all_stats` and
`pg_signal_backend` grants; Render's four default-privilege rows; a UTF8 database; TLS on.
Migrations 0001-0020 were applied with the repository runner from `main` at `79c2802`, logged in as
`clinic_ai_platform_user2`; that reproduced production's recorded values exactly (20 ids with
`md5` `0763e669b8d4c4a569f1ebe85c48c0a4`, both function bodies, the column ACLs). The blocks above
were then run unchanged, except that the connection used `PGSSLMODE=require` (a local cluster has no
publicly trusted certificate):

- Checksum: `OK`.
- Empty database (no clinics, no documents, as production is expected to be): pre-check `READY`,
  counts `documents=0 to_backfill=0`; apply `INSERT 0 1`, `COMMIT`, `exit=0`, no warning, and
  `who_before_insert` = `clinic_ai_platform_user`; post-check `VERIFIED`; counts unchanged.
- A fresh copy with synthetic data (two clinics; per clinic one `processing` document with a chunk
  set, plus one `processing` without chunks in the first and one `failed` in the second): counts
  `documents=4 to_backfill=2`. Apply while another session held `ACCESS EXCLUSIVE` on
  `knowledge_documents`: `canceling statement due to lock timeout` after 5 s, `exit=3`, and the
  pre-check still said `READY` (nothing changed). Apply again: `INSERT 0 1`, `exit=0`; post-check
  `VERIFIED`; counts `documents=4 to_backfill=0`. Both chunked documents became `ready` with
  `ready_at` set; the unchunked one stayed `processing` and the failed one stayed `failed` with its
  reason.
- `EXECUTE` granted to `PUBLIC` on the store function by hand: `NOT VERIFIED`; revoked again:
  `VERIFIED`.
- After the apply the pre-check prints `STOP`, and a second apply fails at the
  `schema_migrations` insert (`duplicate key`), `exit=3`, rolling back everything it ran.

## Execution record (2026-11-13)

Run by the Owner from Termux, following this file as merged in #137 (main `50a5802`):

- Checksum of the file downloaded from `50a5802`: `OK`.
- Render: point-in-time recovery enabled on `clinic-ai-db` (3-day window); nothing changed.
- URL guard: `HOST-OK: production clinic-ai-db as clinic_ai_platform_user2`.
- Pre-check at 19:04:10 UTC: `READY`, every condition `t`, `clinics` = 1. Counts:
  `documents=0 to_backfill=0`.
- Apply: started 19:06:34 UTC as `clinic_ai_platform_user`; `GRANT`, `CREATE FUNCTION`, `COMMENT`,
  three `DO`; `who_before_insert` = `clinic_ai_platform_user`; `INSERT 0 1`; `COMMIT` at
  19:06:35 UTC; `exit=0`; no `WARNING` or `ERROR`.
- Post-check: `VERIFIED`, every condition `t`. Counts: `documents=0 to_backfill=0`.
- Clean-up: `CLEARED`.

Production now runs migrations 0001-0021. No data row changed.
