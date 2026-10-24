# P1 procedure — apply migration 0020 to production

**Status:** prepared and rehearsed, **not executed**. Running it needs a separate, explicit Owner
approval. **Scope:** production database `clinic-ai-db` (`dpg-daekbjmq1p3s739nc4og-a`) only, as
`clinic_ai_platform_user`, from the Owner's Termux. **Prerequisite:** PR #112 merged (0020 sets
function privileges before the ownership transfer). This file contains no secret; the database URL
is typed into Termux with `read -rs` and never written down.

Rulings applied (2026-10-25): any result other than `READY` stops before the apply; any result
other than `VERIFIED` stops P1 and blocks #111 (Q4); PITR is not relied on (Q3) — a failure before
`COMMIT` rolls the whole transaction back, and a problem after `COMMIT` gets a separate Owner
decision, normally a forward-fix migration.

## Expected values

| Item                                          | Value                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `0020_knowledge_document_chunks.sql`          | sha256 `c57b32fdfbf461526d9c4b0e2b6fb88a68d0fca9cb3d42acbded6f61284ab7bf` |
| `md5(prosrc)` store_knowledge_document_chunks | `5e71e9bbb0ed2c5a2d3d7940fab0eaf7`                                        |
| `md5(prosrc)` mark_knowledge_document_failed  | `de7bed5aa9b0f9b8e7d27774cee48d5c`                                        |

Download the file from the **merge commit of #112** (not a branch), into a new folder `~/c20`
(`mkdir -p ~/c20 && cd ~/c20`); every later step runs from there:
`https://raw.githubusercontent.com/alarapioranse-dotcom/clinic-ai-platform/<MERGE_COMMIT>/db/migrations/0020_knowledge_document_chunks.sql`,
then check it with `sha256sum -c`. Any mismatch stops here.

## 0. Before connecting (read-only, Render dashboard)

Confirm on `clinic-ai-db` that point-in-time recovery is enabled, and note the time. Change nothing.

## 1. URL guard (after `read -rs DATABASE_URL && export DATABASE_URL PGSSLMODE=require`)

Accepts only the production database as `clinic_ai_platform_user`; anything else is unset.

```sh
case "$DATABASE_URL" in
  postgres://clinic_ai_platform_user:*@dpg-daekbjmq1p3s739nc4og-a.*|postgresql://clinic_ai_platform_user:*@dpg-daekbjmq1p3s739nc4og-a.*)
    echo "HOST-OK: production clinic-ai-db as clinic_ai_platform_user" ;;
  *)
    echo "STOP: this is not the production database URL"; unset DATABASE_URL ;;
esac
```

## 2. Read-only pre-check — must print `READY`

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SELECT CASE WHEN (SELECT count(*) FROM schema_migrations) = 19
             AND (SELECT max(id) FROM schema_migrations) = '0019_owner_role_no_inherit.sql'
             AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0020_knowledge_document_chunks.sql')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor')
             AND pg_catalog.to_regclass('public.knowledge_document_chunks') IS NULL
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                              WHERE proname IN ('store_knowledge_document_chunks','mark_knowledge_document_failed'))
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'knowledge_documents_id_key')
             AND pg_catalog.current_setting('server_encoding') = 'UTF8'
             AND current_user = 'clinic_ai_platform_user'
             AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)
             AND NOT (SELECT bool_or(pg_catalog.pg_has_role(current_user, t, 'USAGE'))
                        FROM unnest(ARRAY['auth_bootstrap','clinic_settings_writer','invitation_acceptor']) t)
             AND (SELECT count(*) FROM pg_catalog.pg_default_acl) = 0
             AND (SELECT count(*) FROM pg_catalog.pg_proc p
                   WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace) = 4
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                              WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                                AND pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE'))
            THEN 'READY' ELSE 'STOP' END AS decision,
       current_user AS who,
       pg_catalog.current_database() AS database,
       pg_catalog.current_setting('server_encoding') AS encoding,
       (SELECT count(*) FROM schema_migrations) AS migrations,
       pg_catalog.now() AT TIME ZONE 'UTC' AS checked_at_utc;
ROLLBACK;
SQL
```

## 3. Apply — the only step that changes anything

Exactly as `scripts/migrate.ts` wraps a file: one transaction with the file and its
`schema_migrations` row. Expected: `INSERT 0 1`, `COMMIT`, `exit=0`, **no `WARNING` line**. Any
`ERROR` or non-zero exit means the transaction was rolled back and nothing changed; stop and report.

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SELECT pg_catalog.now() AT TIME ZONE 'UTC' AS started_at_utc, current_user AS who,
       pg_catalog.current_database() AS database;
BEGIN;
\i 0020_knowledge_document_chunks.sql
INSERT INTO schema_migrations (id) VALUES ('0020_knowledge_document_chunks.sql');
COMMIT;
SELECT pg_catalog.now() AT TIME ZONE 'UTC' AS committed_at_utc;
SQL
echo "exit=$?"
```

## 4. Read-only post-check — must print `VERIFIED`

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
WITH f AS (
  SELECT p.proname, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
         p.proacl::text AS acl, pg_catalog.md5(p.prosrc) AS body
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('store_knowledge_document_chunks','mark_knowledge_document_failed')
), c AS (
  SELECT
    (SELECT count(*) FROM schema_migrations) = 20
      AND (SELECT max(id) FROM schema_migrations) = '0020_knowledge_document_chunks.sql'
      AND (SELECT count(*) FROM schema_migrations WHERE id = '0020_knowledge_document_chunks.sql') = 1
      AS migrations_ok,
    (SELECT NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
       FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor')
      AS role_ok,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
                 WHERE roleid = 'knowledge_document_processor'::regrole
                   AND (inherit_option OR member <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = 'knowledge_document_processor'::regrole)
      AND NOT pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'USAGE')
      AND pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'SET')
      AS memberships_ok,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class
      WHERE oid = 'public.knowledge_document_chunks'::regclass)
      AND (SELECT count(*) FROM pg_catalog.pg_policies
            WHERE schemaname = 'public' AND tablename = 'knowledge_document_chunks'
              AND policyname = 'tenant_isolation') = 1
      AND (SELECT count(*) FROM pg_catalog.pg_policies
            WHERE schemaname = 'public' AND tablename = 'knowledge_document_chunks') = 1
      AS rls_ok,
    pg_catalog.has_table_privilege('app_user', 'public.knowledge_document_chunks', 'SELECT')
      AND NOT pg_catalog.has_table_privilege('app_user', 'public.knowledge_document_chunks', 'INSERT, UPDATE, DELETE, TRUNCATE')
      AND NOT pg_catalog.has_table_privilege('app_user', 'public.knowledge_documents', 'UPDATE, DELETE, TRUNCATE')
      AS app_user_ok,
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'knowledge_documents_id_key')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'knowledge_document_chunks_document_same_clinic')
      AS constraints_ok,
    (SELECT count(*) FROM f
      WHERE owner = 'knowledge_document_processor' AND prosecdef
        AND proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
        AND acl = '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}'
        AND ((proname = 'store_knowledge_document_chunks' AND body = '5e71e9bbb0ed2c5a2d3d7940fab0eaf7')
          OR (proname = 'mark_knowledge_document_failed' AND body = 'de7bed5aa9b0f9b8e7d27774cee48d5c'))) = 2
      AS functions_ok,
    (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace) = 6
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                       WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                         AND (pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
                              OR NOT pg_catalog.has_function_privilege('app_user', p.oid, 'EXECUTE')))
      AS all_secdef_ok,
    (SELECT count(*) FROM pg_catalog.pg_default_acl) = 0 AS default_acl_ok,
    (SELECT count(*) FROM public.knowledge_document_chunks) = 0 AS chunks_empty
)
SELECT CASE WHEN migrations_ok AND role_ok AND memberships_ok AND rls_ok AND app_user_ok
                 AND constraints_ok AND functions_ok AND all_secdef_ok AND default_acl_ok AND chunks_empty
            THEN 'VERIFIED' ELSE 'NOT VERIFIED' END AS result,
       migrations_ok, role_ok, memberships_ok, rls_ok, app_user_ok, constraints_ok,
       functions_ok, all_secdef_ok, default_acl_ok, chunks_empty
  FROM c;
ROLLBACK;
SQL
```

## 5. Clean up

```sh
unset DATABASE_URL PGSSLMODE && cd ~ && rm -rf ~/c20 && echo CLEARED
```

## Rehearsal (2026-10-25, fresh production-shaped PostgreSQL 16 cluster)

Non-superuser `CREATEROLE` owner `clinic_ai_platform_user`, Render's extra `pg_read_all_stats` and
`pg_signal_backend` grants, migrations 0001-0019 through the repository runner, then these blocks:

- URL guard: accepted the production URL shape; rejected the demo URL, another user and a
  tampered host (each unset the variable).
- Pre-check: `READY`.
- Apply while another session held a lock on `knowledge_documents`: `canceling statement due to
lock timeout` after 5 s, exit 3; the pre-check still said `READY` (nothing changed).
- Apply: `INSERT 0 1`, `COMMIT`, exit 0, no warnings. Post-check: `VERIFIED`.
- PUBLIC given `EXECUTE` by hand: `NOT VERIFIED` (`functions_ok`, `all_secdef_ok` false); revoked
  again: `VERIFIED`.
- The original 0020 (before #112) on a fresh cluster: exit 0 with four `WARNING` lines, post-check
  `NOT VERIFIED`.
- A second apply fails at the first DDL statement and changes nothing.
