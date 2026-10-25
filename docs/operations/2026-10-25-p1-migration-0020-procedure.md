# P1 procedure — apply migration 0020 to production

**Status:** prepared and rehearsed, **not executed**. Running it needs a separate, explicit Owner
approval. **Scope:** production database `clinic-ai-db` (`dpg-daekbjmq1p3s739nc4og-a`) only,
executing as `clinic_ai_platform_user`, from the Owner's Termux. **Prerequisite:** PR #112 merged
(0020 sets function privileges before the ownership transfer). This file contains no secret; the
database URL is typed into Termux with `read -rs` and never written down.

## Login role versus executing role

Since the credential rotation of 2026-09-12 (`docs/operations/2026-09-12-credential-exposure.md`),
the only credential Render offers for `clinic-ai-db` is `clinic_ai_platform_user2`, so the External
Database URL carries that user name. Read-only checks on 2026-10-25 showed how Render set it up:

- `clinic_ai_platform_user` still exists, cannot log in, and still owns the database, the `public`
  schema and every table and index (10 tables, 28 indexes).
- `clinic_ai_platform_user2` can log in, is a member of `clinic_ai_platform_user` (granted by
  `postgres`, `INHERIT TRUE, SET TRUE`), and has the role setting
  `role=clinic_ai_platform_user` for all databases.
- So every session opened with the External Database URL runs with
  `current_user = clinic_ai_platform_user` (`session_user = clinic_ai_platform_user2`). Migration
  0019 was applied on 2026-10-18 in exactly this way.

The URL guard therefore checks the login name `clinic_ai_platform_user2`; the pre-check, the apply
block and the post-check check and use the executing role `clinic_ai_platform_user`, unchanged.
Objects created by 0020 are owned by `clinic_ai_platform_user`, like every other object. If the pre-check
does not show `who = clinic_ai_platform_user`, it prints `STOP`.

## Render's default privileges

Production's `pg_default_acl` is not empty. A read-only check on 2026-10-25 showed exactly four
rows, all for objects created by `postgres` in any schema (`defaclnamespace = 0`), set by Render:

| Object type     | `defaclacl`                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `r` (tables)    | `{postgres=arwdDxt/postgres,clinic_ai_platform_user=arwdDxt/postgres}` |
| `S` (sequences) | `{postgres=rwU/postgres,clinic_ai_platform_user=rwU/postgres}`         |
| `f` (functions) | `{=X/postgres,postgres=X/postgres,clinic_ai_platform_user=X/postgres}` |
| `T` (types)     | `{=U/postgres,postgres=U/postgres,clinic_ai_platform_user=U/postgres}` |

Default privileges apply only to objects created by the role they belong to (`defaclrole`). 0020
creates its objects as `clinic_ai_platform_user`, so these rows do not touch them; the post-check
still verifies every resulting privilege exactly. The pre-check and the post-check therefore require
`pg_default_acl` to hold exactly these four rows and nothing else: a default privilege for any other
role (`clinic_ai_platform_user`, `knowledge_document_processor` or another) or any change to
Render's rows prints `STOP` / `NOT VERIFIED`. The first version of this file required the table to
be empty, which held in the rehearsal clusters but not in production, so the pre-check of
2026-10-25 printed `STOP` (all its other conditions were true) and nothing was applied. The rows
are compared in a fixed order (role, schema, object type, ACL), so the comparison does not depend
on catalog order.

## Production facts the checks rely on (read-only, 2026-10-25)

Every expected value below was read from production in a `BEGIN TRANSACTION READ ONLY` ...
`ROLLBACK` session before it was written into a check, not taken from a rehearsal:

| Fact                              | Production value                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Server version                    | `16.15`                                                                                         |
| `current_user` / `session_user`   | `clinic_ai_platform_user` / `clinic_ai_platform_user2`                                          |
| Transport                         | TLS (`TLSv1.3`); a `verify-full` connection with the system trust store succeeded               |
| Migration ids (19)                | `md5` of the ids in `C` order joined by `,` = `d2fa84678c8a8b827c15265703e45163` (= repository) |
| Event triggers                    | none                                                                                            |
| `knowledge_documents` table ACL   | `{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=ar/clinic_ai_platform_user}` |
| `knowledge_documents` column ACLs | none                                                                                            |
| `pg_default_acl`                  | Render's four rows (above)                                                                      |
| Role / database settings          | `clinic_ai_platform_user2`: `role=clinic_ai_platform_user`; database: `TimeZone=utc`            |
| Session defaults                  | `read committed`, not read only, `createrole_self_grant` empty, no lock or statement timeout    |
| Extensions                        | `btree_gist` 1.7, `pgcrypto` 1.3, `plpgsql` 1.0                                                 |

The post-check's expected ACL strings for the new table and its columns, and the new column ACLs
on `knowledge_documents`, come from applying this file to a cluster with exactly these facts; the
grants that produce them are in 0020 itself (lines 91-93 and 138-143).

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

## 1. URL guard (after `read -rs DATABASE_URL && export DATABASE_URL PGSSLMODE=verify-full PGSSLROOTCERT=system`)

`verify-full` with the system trust store checks that the server certificate chains to a trusted
CA and matches the host name, not only that the connection is encrypted (`require`). It needs libpq
16 or later for `sslrootcert=system`; the Owner's Termux psql is 18.6, and a read-only
`verify-full` connection to production succeeded on 2026-10-25 (`TLSv1.3`). If it fails with a
certificate error, stop; do not fall back to `require` without a separate Owner decision.

Accepts only the External Database URL of the production database (full host name and database
name) with the login `clinic_ai_platform_user2`; anything else is unset. The Internal Database URL
(host without a domain) is rejected, and so is any URL with a second `@` or an extra `/` (Render's
passwords contain neither), so the wildcard for the password cannot swallow another host.

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

If it prints `STOP`, the URL's shape can be shown without its password:

```sh
echo "length=${#DATABASE_URL}"; printf '%s\n' "$DATABASE_URL" | sed -E 's#^([a-z]+)://([^:@/]*)(:.*)?@([^/:?@]*).*$#scheme=\1 user=\2 host=\4#; t; s#.*#format not recognised#'
```

(Run it before the guard, since the guard unsets the variable.)

## 2. Read-only pre-check — must print `READY`

```sh
psql "$DATABASE_URL" <<'SQL'
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SELECT CASE WHEN (SELECT count(*) FROM schema_migrations) = 19
             AND (SELECT max(id) FROM schema_migrations) = '0019_owner_role_no_inherit.sql'
             AND (SELECT pg_catalog.md5(pg_catalog.string_agg(id, ',' ORDER BY id COLLATE "C")) FROM schema_migrations)
                 = 'd2fa84678c8a8b827c15265703e45163'
             AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '0020_knowledge_document_chunks.sql')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor')
             AND pg_catalog.to_regclass('public.knowledge_document_chunks') IS NULL
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                              WHERE proname IN ('store_knowledge_document_chunks','mark_knowledge_document_failed'))
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'knowledge_documents_id_key')
             AND pg_catalog.current_setting('server_encoding') = 'UTF8'
             AND current_user = 'clinic_ai_platform_user'
             AND session_user = 'clinic_ai_platform_user2'
             AND COALESCE((SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid()), false)
             AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)
             AND NOT (SELECT bool_or(pg_catalog.pg_has_role(current_user, t, 'USAGE'))
                        FROM unnest(ARRAY['auth_bootstrap','clinic_settings_writer','invitation_acceptor']) t)
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
             AND COALESCE((SELECT relacl::text FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_documents'::regclass), 'NULL')
                 = '{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=ar/clinic_ai_platform_user}'
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                              WHERE attrelid = 'public.knowledge_documents'::regclass AND attacl IS NOT NULL)
             AND COALESCE((SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace::text
                                     || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text, ';'
                                     ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole)::text COLLATE "C", d.defaclnamespace,
                                              d.defaclobjtype::text COLLATE "C", d.defaclacl::text COLLATE "C")
                             FROM pg_catalog.pg_default_acl d), '')
                 = 'postgres|0|S|{postgres=rwU/postgres,clinic_ai_platform_user=rwU/postgres};postgres|0|T|{=U/postgres,postgres=U/postgres,clinic_ai_platform_user=U/postgres};postgres|0|f|{=X/postgres,postgres=X/postgres,clinic_ai_platform_user=X/postgres};postgres|0|r|{postgres=arwdDxt/postgres,clinic_ai_platform_user=arwdDxt/postgres}'
             AND (SELECT count(*) FROM pg_catalog.pg_proc p
                   WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace) = 4
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                              WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                                AND pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE'))
            THEN 'READY' ELSE 'STOP' END AS decision,
       current_user AS who,
       session_user AS login,
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
-- Pins the names pg_get_constraintdef prints (production's session default is "$user", public).
SET LOCAL search_path = public;
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
      AND (SELECT pg_catalog.md5(pg_catalog.string_agg(id, ',' ORDER BY id COLLATE "C")) FROM schema_migrations)
          = '0763e669b8d4c4a569f1ebe85c48c0a4'
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
      AND COALESCE((SELECT pol.polcmd::text || '|' || pol.polpermissive::text || '|' || pol.polroles::text || '|'
                           || pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) || '|'
                           || pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
                      FROM pg_catalog.pg_policy pol
                     WHERE pol.polrelid = 'public.knowledge_document_chunks'::regclass
                       AND pol.polname = 'tenant_isolation'), 'NULL')
          = '*|true|{0}|(clinic_id = (current_setting(''app.current_clinic_id''::text, true))::uuid)|(clinic_id = (current_setting(''app.current_clinic_id''::text, true))::uuid)'
      AS rls_ok,
    pg_catalog.has_table_privilege('app_user', 'public.knowledge_document_chunks', 'SELECT')
      AND NOT pg_catalog.has_table_privilege('app_user', 'public.knowledge_document_chunks', 'INSERT, UPDATE, DELETE, TRUNCATE')
      AND NOT pg_catalog.has_table_privilege('app_user', 'public.knowledge_documents', 'UPDATE, DELETE, TRUNCATE')
      AS app_user_ok,
    COALESCE((SELECT relacl::text FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_document_chunks'::regclass), 'NULL')
        = '{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=r/clinic_ai_platform_user}'
      AND COALESCE((SELECT relacl::text FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_documents'::regclass), 'NULL')
        = '{clinic_ai_platform_user=arwdDxt/clinic_ai_platform_user,app_user=ar/clinic_ai_platform_user}'
      AND COALESCE((SELECT pg_catalog.string_agg(attname || '=' || attacl::text, ' ' ORDER BY attnum) FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'public.knowledge_document_chunks'::regclass AND attacl IS NOT NULL), 'NULL')
        = 'clinic_id={knowledge_document_processor=ar/clinic_ai_platform_user} document_id={knowledge_document_processor=ar/clinic_ai_platform_user} ordinal={knowledge_document_processor=a/clinic_ai_platform_user} content={knowledge_document_processor=a/clinic_ai_platform_user} char_start={knowledge_document_processor=a/clinic_ai_platform_user} char_end={knowledge_document_processor=a/clinic_ai_platform_user} extractor_version={knowledge_document_processor=a/clinic_ai_platform_user} canonicalization_version={knowledge_document_processor=a/clinic_ai_platform_user}'
      AND COALESCE((SELECT pg_catalog.string_agg(attname || '=' || attacl::text, ' ' ORDER BY attnum) FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'public.knowledge_documents'::regclass AND attacl IS NOT NULL), 'NULL')
        = 'id={knowledge_document_processor=r/clinic_ai_platform_user} clinic_id={knowledge_document_processor=r/clinic_ai_platform_user} status={knowledge_document_processor=rw/clinic_ai_platform_user} failed_reason={knowledge_document_processor=w/clinic_ai_platform_user}'
      AND NOT pg_catalog.has_table_privilege('public', 'public.knowledge_document_chunks',
                                             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      AND NOT pg_catalog.has_any_column_privilege('public', 'public.knowledge_document_chunks', 'SELECT, INSERT, UPDATE, REFERENCES')
      AND NOT pg_catalog.has_any_column_privilege('public', 'public.knowledge_documents', 'SELECT, INSERT, UPDATE, REFERENCES')
      AS table_acl_ok,
    COALESCE((SELECT pg_catalog.string_agg(con.conname || ':' || con.contype::text || ':' || con.convalidated::text || ':'
                                           || pg_catalog.pg_get_constraintdef(con.oid), ' ; ' ORDER BY con.conname::text COLLATE "C")
                FROM pg_catalog.pg_constraint con
               WHERE con.conrelid = 'public.knowledge_document_chunks'::regclass), 'NULL')
        = 'knowledge_document_chunk_content_matches_range:c:true:CHECK (((char_end - char_start) = length(content))) ; knowledge_document_chunk_max_length:c:true:CHECK (((char_end - char_start) <= 2000)) ; knowledge_document_chunk_range_nonempty:c:true:CHECK ((char_end > char_start)) ; knowledge_document_chunk_versions_present:c:true:CHECK (((btrim(extractor_version) <> ''''::text) AND (length(extractor_version) <= 100) AND (btrim(canonicalization_version) <> ''''::text) AND (length(canonicalization_version) <= 100))) ; knowledge_document_chunks_char_start_check:c:true:CHECK ((char_start >= 0)) ; knowledge_document_chunks_clinic_id_fkey:f:true:FOREIGN KEY (clinic_id) REFERENCES clinics(id) ; knowledge_document_chunks_document_ordinal_key:u:true:UNIQUE (document_id, ordinal) ; knowledge_document_chunks_document_same_clinic:f:true:FOREIGN KEY (document_id, clinic_id) REFERENCES knowledge_documents(id, clinic_id) ON DELETE CASCADE ; knowledge_document_chunks_ordinal_check:c:true:CHECK ((ordinal >= 0)) ; knowledge_document_chunks_pkey:p:true:PRIMARY KEY (id)'
      AND COALESCE((SELECT con.contype::text || ':' || con.convalidated::text || ':' || pg_catalog.pg_get_constraintdef(con.oid)
                      FROM pg_catalog.pg_constraint con
                     WHERE con.conrelid = 'public.knowledge_documents'::regclass
                       AND con.conname = 'knowledge_documents_id_key'), 'NULL')
        = 'u:true:UNIQUE (id, clinic_id)'
      AND COALESCE((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid) || ':' || i.indisvalid::text
                                                 || ':' || i.indisready::text || ':' || i.indislive::text, ' ; '
                                                 ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid) COLLATE "C")
                      FROM pg_catalog.pg_index i
                     WHERE i.indrelid = 'public.knowledge_document_chunks'::regclass), 'NULL')
        = 'CREATE INDEX knowledge_document_chunks_clinic_id_idx ON public.knowledge_document_chunks USING btree (clinic_id):true:true:true ; CREATE UNIQUE INDEX knowledge_document_chunks_document_ordinal_key ON public.knowledge_document_chunks USING btree (document_id, ordinal):true:true:true ; CREATE UNIQUE INDEX knowledge_document_chunks_pkey ON public.knowledge_document_chunks USING btree (id):true:true:true'
      AS constraints_ok,
    COALESCE((SELECT pg_catalog.string_agg(t.tgisinternal::text || ':' || COALESCE(con.conname, '-') || ':' || p.proname
                                           || ':' || t.tgtype::text || ':' || t.tgenabled::text, ' ; '
                                           ORDER BY COALESCE(con.conname, '-') COLLATE "C", p.proname COLLATE "C", t.tgtype)
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
                LEFT JOIN pg_catalog.pg_constraint con ON con.oid = t.tgconstraint
               WHERE t.tgrelid = 'public.knowledge_document_chunks'::regclass), 'none')
        = 'true:knowledge_document_chunks_clinic_id_fkey:RI_FKey_check_ins:5:O ; true:knowledge_document_chunks_clinic_id_fkey:RI_FKey_check_upd:17:O ; true:knowledge_document_chunks_document_same_clinic:RI_FKey_check_ins:5:O ; true:knowledge_document_chunks_document_same_clinic:RI_FKey_check_upd:17:O'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite WHERE ev_class = 'public.knowledge_document_chunks'::regclass)
      AS triggers_rules_ok,
    COALESCE((SELECT pg_catalog.pg_get_userbyid(relowner) || ':' || relkind::text || ':' || relpersistence::text
                FROM pg_catalog.pg_class WHERE oid = 'public.knowledge_document_chunks'::regclass), 'NULL')
        = 'clinic_ai_platform_user:r:p'
      AND COALESCE((SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
                     WHERE oid = 'public.knowledge_documents'::regclass), 'NULL')
        = 'clinic_ai_platform_user'
      AND COALESCE((SELECT pg_catalog.string_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                                                 || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                                                 || COALESCE(' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''),
                                                 ', ' ORDER BY a.attnum)
                      FROM pg_catalog.pg_attribute a
                      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                     WHERE a.attrelid = 'public.knowledge_document_chunks'::regclass AND a.attnum > 0 AND NOT a.attisdropped), 'NULL')
        = 'id uuid NOT NULL DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL, document_id uuid NOT NULL, ordinal integer NOT NULL, content text NOT NULL, char_start integer NOT NULL, char_end integer NOT NULL, extractor_version text NOT NULL, canonicalization_version text NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now()'
      AS schema_ok,
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
    COALESCE((SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace::text
                     || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text, ';'
                     ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole)::text COLLATE "C", d.defaclnamespace,
                              d.defaclobjtype::text COLLATE "C", d.defaclacl::text COLLATE "C")
               FROM pg_catalog.pg_default_acl d), '')
      = 'postgres|0|S|{postgres=rwU/postgres,clinic_ai_platform_user=rwU/postgres};postgres|0|T|{=U/postgres,postgres=U/postgres,clinic_ai_platform_user=U/postgres};postgres|0|f|{=X/postgres,postgres=X/postgres,clinic_ai_platform_user=X/postgres};postgres|0|r|{postgres=arwdDxt/postgres,clinic_ai_platform_user=arwdDxt/postgres}'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
      AS default_acl_ok,
    (SELECT count(*) FROM public.knowledge_document_chunks) = 0 AS chunks_empty
)
SELECT CASE WHEN COALESCE(migrations_ok AND role_ok AND memberships_ok AND rls_ok AND app_user_ok
                          AND table_acl_ok AND constraints_ok AND triggers_rules_ok AND schema_ok AND functions_ok
                          AND all_secdef_ok AND default_acl_ok AND chunks_empty, false)
            THEN 'VERIFIED' ELSE 'NOT VERIFIED' END AS result,
       migrations_ok, role_ok, memberships_ok, rls_ok, app_user_ok, table_acl_ok, constraints_ok,
       triggers_rules_ok, schema_ok, functions_ok, all_secdef_ok, default_acl_ok, chunks_empty
  FROM c;
ROLLBACK;
SQL
```

## 5. Clean up

```sh
unset DATABASE_URL PGSSLMODE PGSSLROOTCERT && cd ~ && rm -rf ~/c20 && echo CLEARED
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

That first rehearsal logged in as `clinic_ai_platform_user` itself. The first production attempt on
2026-10-25 stopped at the original guard, which expected that user name in the URL: the External
Database URL carries `clinic_ai_platform_user2` (see "Login role versus executing role"). Nothing was
run against production beyond the two read-only checks that established the setup.

## Second rehearsal (2026-10-25, rotated credential shape)

Fresh PostgreSQL 16 cluster from main `187ce0a`, set up like production after the 2026-09-12
rotation: `clinic_ai_platform_user` (`CREATEROLE`, `CREATEDB`, Render's `pg_read_all_stats` and
`pg_signal_backend` grants) owns the database and was made `NOLOGIN`; `clinic_ai_platform_user2`
logs in, is a member of `clinic_ai_platform_user` (`INHERIT TRUE, SET TRUE`, granted by
`postgres`), and has `role=clinic_ai_platform_user` as its role setting. Migrations 0001-0019 ran
through the repository runner logged in as `clinic_ai_platform_user2`; the resulting membership
rows matched production's row for row (apart from production's unrelated `datadog` row). Then the
blocks of this file, with the downloaded file checked by `sha256sum -c`:

- URL guard: accepted the production External Database URL shape with `clinic_ai_platform_user2`;
  rejected the old user name, the Internal Database URL host, another database name, a query string,
  a host with an appended domain, another `dpg-` host, `app_user`, a URL with a second `@` and a URL
  with an extra `/` (each unset the variable). The shape helper shows the real host, and none of the
  password, even when the password contains `@` or `:`.
- Pre-check: `READY`, `who = clinic_ai_platform_user`.
- Apply while another session held a lock on `knowledge_documents`: `canceling statement due to
lock timeout` after 5 s, exit 3; the pre-check still said `READY`.
- Apply: `who = clinic_ai_platform_user`, `INSERT 0 1`, `COMMIT`, exit 0, no warnings. Post-check:
  `VERIFIED`, every column true.
- After the apply: `knowledge_document_chunks` is owned by `clinic_ai_platform_user`;
  `clinic_ai_platform_user2` has no `USAGE` on `knowledge_document_processor`.

The second production attempt (2026-10-25, from main `110fcc6`) passed the URL guard and stopped at
the pre-check on its default-privilege condition (see "Render's default privileges"); a read-only
diagnostic showed every other condition true. Nothing was applied.

## Third rehearsal (2026-10-25, Render's default privileges)

As the second rehearsal, plus Render's four `pg_default_acl` rows recreated by `postgres` with
`ALTER DEFAULT PRIVILEGES` (their text matched the production rows exactly), then the blocks of
this file:

- The previous pre-check (empty `pg_default_acl`) on this cluster: `STOP`, as in production.
- Pre-check: `READY`, `who = clinic_ai_platform_user`.
- Pre-check `STOP` for each of: a default privilege added for `clinic_ai_platform_user`; Render's
  function row changed (PUBLIC `EXECUTE` revoked); Render's type row changed; a schema-scoped
  default privilege added for `postgres`. Each was undone and the pre-check said `READY` again.
- Apply while another session held a lock on `knowledge_documents`: `canceling statement due to
lock timeout` after 5 s, exit 3; the pre-check still said `READY`.
- Apply: `who = clinic_ai_platform_user`, `INSERT 0 1`, `COMMIT`, exit 0, no warnings. Post-check:
  `VERIFIED`, every column true, including `functions_ok` (the exact function ACLs), so Render's
  `postgres` rows did not reach the objects 0020 created.
- A default privilege added for `knowledge_document_processor` after the apply: `NOT VERIFIED`
  (`default_acl_ok` false); removed again: `VERIFIED`.
- Pre-check after the apply: `STOP`. `knowledge_document_chunks` is owned by
  `clinic_ai_platform_user`; `clinic_ai_platform_user2` has no `USAGE` on
  `knowledge_document_processor`.

## Fourth rehearsal (2026-10-25, checks from the production facts, verify-full TLS)

Review by the external architect (2026-10-25) asked for: exact table and column ACL checks on the
new table (`table_acl_ok`), PUBLIC checked explicitly, NULL-safe comparisons, a deterministic order
for the default-privilege rows, production facts read before being written into a check, and server
identity verified rather than only encrypted. This rehearsal covers those changes, from the blocks
of this file. Note that `default_acl_ok` also requires that no event trigger exists.

Cluster: fresh PostgreSQL 16.15 with TLS on (a private CA; the server certificate names
`localhost`), connected with `PGSSLMODE=verify-full` and `PGSSLROOTCERT` set to that CA (production
uses `system`). It was set up with the production facts above: the rotated login, the memberships,
`TimeZone=utc` on the database, and Render's four rows created in a different order from the
comparison order. Migrations 0001-0019 ran through the repository runner over `verify-full`. The
resulting server version, TLS version, migration-id `md5`, `knowledge_documents` ACL, event
triggers and extensions matched production.

- Pre-check: `READY` (`who = clinic_ai_platform_user`, `login = clinic_ai_platform_user2`).
- Pre-check `STOP` for each of: no TLS (`sslmode=disable`); an event trigger; PUBLIC `SELECT` on
  `knowledge_documents`; a column grant on `knowledge_documents`; one migration id changed (count and
  maximum unchanged); a default privilege for `clinic_ai_platform_user`. A `verify-full` connection
  that trusted only the system store was refused (`certificate verify failed`). Each change was
  undone and the pre-check said `READY` again.
- Apply while another session held a lock on `knowledge_documents`: `canceling statement due to
lock timeout` after 5 s, exit 3; the pre-check still said `READY`.
- Apply: `who = clinic_ai_platform_user`, `INSERT 0 1`, `COMMIT`, exit 0, no warnings. Post-check:
  `VERIFIED`, every column true.
- Post-check `NOT VERIFIED` for each of: PUBLIC `SELECT` on `knowledge_document_chunks`,
  `UPDATE (content)` on it for `app_user`, PUBLIC `SELECT (status)` on `knowledge_documents`, and
  `INSERT` on the new table for `clinic_ai_platform_user2` (each `table_acl_ok` false); the policy
  changed to `USING (true)` (`rls_ok` false); an event trigger (`default_acl_ok` false). With
  `knowledge_document_processor` renamed, the post-check stopped with `ERROR: role
"knowledge_document_processor" does not exist` and printed no result (exit 3). Each change was
  undone and the post-check said `VERIFIED` again.
- NULL handling: every compared catalog value is wrapped in `COALESCE` (`'NULL'` or `false`) and the
  overall result is `COALESCE(..., false)`, so a missing value can only give `STOP` or
  `NOT VERIFIED`, never `READY` or `VERIFIED`.
- Pre-check after the apply: `STOP`. `knowledge_document_chunks` is owned by
  `clinic_ai_platform_user`; `clinic_ai_platform_user2` has no `USAGE` on
  `knowledge_document_processor`.

## Fifth rehearsal (2026-10-25, structural checks)

The external architect's final review of #114 (GO WITH CONDITIONS) asked for structural checks
before merging. `constraints_ok` had only checked that two constraint names existed somewhere.
It now compares, exactly and per table:

- every constraint on `knowledge_document_chunks` (name, type, `convalidated`,
  `pg_get_constraintdef`);
- `knowledge_documents_id_key` on `knowledge_documents`;
- every index on the new table.

A new `schema_ok` checks:

- the owner, kind and persistence of the new table;
- the owner of `knowledge_documents`;
- the new table's exact column list: name, type, `NOT NULL`, default. A column without an ACL is now
  detected.

The expected strings come from applying 0020 on PostgreSQL 16.15, because these objects do not
exist in production before P1. The post-check pins `search_path = public` for its own transaction,
so `pg_get_constraintdef` prints names the same way as in that run.

Same setup as the fourth rehearsal (TLS, `verify-full`, production facts), on a cluster rebuilt
from scratch, with the blocks of this file. After every negative case the change was undone and
the check was run again to confirm it was back to `READY` / `VERIFIED` before the next case.

- Pre-check: `READY`, and `STOP` for each pre-check case of the fourth rehearsal.
- Apply under a held lock: cancelled after 5 s, exit 3, the pre-check still `READY`. Apply:
  `INSERT 0 1`, `COMMIT`, exit 0, no warnings. Post-check: `VERIFIED`, all 12 columns true.
- Post-check `NOT VERIFIED` (or an `ERROR` with no result) for each case of the fourth rehearsal,
  and for each of the following:
  - `constraints_ok` false:
    - a CHECK constraint dropped;
    - a CHECK changed (2000 to 3000);
    - a CHECK re-added `NOT VALID`;
    - the same-clinic foreign key dropped and its name reused on another table;
    - the foreign key without `ON DELETE CASCADE`;
    - `knowledge_documents_id_key` redefined on other columns;
    - an extra index.
  - `schema_ok` false: a column added without an ACL; `NOT NULL` dropped; a default dropped; the
    table made `UNLOGGED`.
  - Both `constraints_ok` and `schema_ok` false: a column's type changed (`text` to
    `varchar(100)`).
  - `app_user_ok`, `table_acl_ok` and `schema_ok` false: the owner of `knowledge_documents`
    changed.
  - `ERROR: permission denied`, no result: the owner of the new table changed.
- Pre-check after the apply: `STOP`.

The first run of this rehearsal reported a final `NOT VERIFIED` after all its cases. The cause was
the harness, not the checks: undoing an ownership change (`OWNER TO app_user` and back) drops
`app_user`'s grants, and the harness did not restore them. The checks correctly reported that
state. The cluster was rebuilt, the undo now restores the grants and each undo is confirmed, and
only that run is reported above.

## Sixth rehearsal (2026-10-25, index validity, triggers and rules)

The architect's review of `a8cb1e8` (GO WITH CONDITIONS) asked for two more checks before merging:

- `constraints_ok` now also requires `indisvalid`, `indisready` and `indislive` for each of the
  three indexes on the new table.
- A new column, `triggers_rules_ok`, requires that the triggers on `knowledge_document_chunks` are
  exactly the four internal ones its two foreign keys create, each enabled (`O`):
  `RI_FKey_check_ins` and `RI_FKey_check_upd` for `knowledge_document_chunks_clinic_id_fkey` and
  for `knowledge_document_chunks_document_same_clinic`. They are compared by constraint, function,
  type and enabled state, not by name, because PostgreSQL names internal triggers by OID. No
  rewrite rule may exist on the table.

Known limitation: the post-check proves the state at the moment it runs. It cannot stop a later
session with enough privileges from changing the database afterwards.

Setup: same as the fifth rehearsal, on a cluster rebuilt from scratch, with the blocks of this
file. After every negative case the change was undone, and the check was rerun to confirm `READY` /
`VERIFIED` before the next case.

- Pre-check `READY`, and `STOP` for every pre-check case of the earlier rehearsals.
- Apply under a held lock: cancelled, nothing changed. Apply: `INSERT 0 1`, `COMMIT`, exit 0, no
  warnings. Post-check `VERIFIED`, all 13 columns true.
- Every earlier post-check negative case: `NOT VERIFIED`, or an `ERROR` with no result.
- New cases, each `NOT VERIFIED`:
  - `constraints_ok` false: `indisvalid` false on the primary-key index; `indisready` false on the
    unique index; `indislive` false on the `clinic_id` index.
  - `triggers_rules_ok` false: an ordinary `BEFORE INSERT` trigger; the same trigger added and then
    disabled; the foreign keys' internal triggers disabled (`DISABLE TRIGGER ALL`); a rule
    `ON INSERT DO INSTEAD NOTHING`; a rule `ON DELETE DO ALSO NOTHING`.
  - Dropping the same-clinic foreign key now also sets `triggers_rules_ok` false.
- Post-check at the end: `VERIFIED`. Pre-check after the apply: `STOP`.
