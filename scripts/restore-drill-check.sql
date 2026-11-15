-- restore-drill-check v1 — read-only comparison for a restore drill.
--
-- Run it with psql, unchanged, against the source database and against the
-- restored copy, as the same migrating role, and compare the two outputs
-- line by line. Every line is `<label> <count> <md5>` (or a header line).
-- Identical outputs mean the copy matches the source at the moment each was
-- read; any differing line is a finding, never a pass.
--
-- What it reads:
--   * catalog: roles, memberships, schemas, extensions, tables and their RLS
--     flags, columns, policies, functions, constraints, indexes, triggers,
--     default privileges and grants;
--   * rows: `schema_migrations`, `clinics`, and every table with row level
--     security, counted and digested once per clinic under that clinic's own
--     tenant context (`app.current_clinic_id`), plus once under a clinic id
--     that does not exist, where every count must be 0.
--
-- What it never does: write, print a row's content, print a secret, or
-- relax row level security. It runs in one READ ONLY REPEATABLE READ
-- transaction that ends in ROLLBACK, and stops on the first error. Session
-- token hashes and password hashes only ever enter an md5 digest.
--
-- Usage:  psql "$URL" -X -q -f restore-drill-check.sql > out.txt
-- Procedure: docs/operations/2026-11-15-pitr-restore-drill-procedure.md

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned
\pset footer off

SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- A role that bypasses row level security would read every clinic's rows
-- under every context, so the per-clinic lines would prove nothing. Stop.
SELECT (r.rolsuper OR r.rolbypassrls) AS rdc_bypass
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
\gset
\if :rdc_bypass
\echo 'STOP: the current role bypasses row level security; nothing was read.'
SELECT 1 / 0;
\endif

SELECT 'restore-drill-check v1';
SELECT 'H server_major ' || current_setting('server_version_num')::int / 10000;
SELECT 'H session_user ' || session_user;
SELECT 'H current_user ' || current_user;
SELECT 'H read_only ' || current_setting('transaction_read_only');
SELECT 'H in_recovery ' || pg_is_in_recovery();

-- Catalog components. Each prints its row count and the md5 of its rows,
-- rendered as text and sorted in the C collation.

WITH r AS (
  SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
         rolreplication, rolbypassrls
  FROM pg_catalog.pg_roles
  WHERE rolname !~ '^pg_'
)
SELECT 'C roles ' || count(*) || ' '
       || md5(coalesce(string_agg(r::text, E'\n' ORDER BY r::text COLLATE "C"), ''))
FROM r;

WITH m AS (
  SELECT g.rolname AS role, u.rolname AS member, a.rolname AS grantor,
         am.admin_option, am.inherit_option, am.set_option
  FROM pg_catalog.pg_auth_members am
  JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = am.member
  JOIN pg_catalog.pg_roles a ON a.oid = am.grantor
)
SELECT 'C memberships ' || count(*) || ' '
       || md5(coalesce(string_agg(m::text, E'\n' ORDER BY m::text COLLATE "C"), ''))
FROM m;

WITH s AS (
  SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
         n.nspacl::text AS acl
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
)
SELECT 'C schemas ' || count(*) || ' '
       || md5(coalesce(string_agg(s::text, E'\n' ORDER BY s::text COLLATE "C"), ''))
FROM s;

WITH e AS (
  SELECT extname, extversion FROM pg_catalog.pg_extension
)
SELECT 'C extensions ' || count(*) || ' '
       || md5(coalesce(string_agg(e::text, E'\n' ORDER BY e::text COLLATE "C"), ''))
FROM e;

WITH t AS (
  SELECT c.relname, c.relkind, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
         c.relrowsecurity, c.relforcerowsecurity, c.relacl::text AS acl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
)
SELECT 'C relations ' || count(*) || ' '
       || md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''))
FROM t;

WITH a AS (
  SELECT c.relname, a.attnum, a.attname,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr,
         a.attgenerated, a.attidentity, a.attacl::text AS acl
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT 'C columns ' || count(*) || ' '
       || md5(coalesce(string_agg(a::text, E'\n' ORDER BY a::text COLLATE "C"), ''))
FROM a;

WITH p AS (
  SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
)
SELECT 'C policies ' || count(*) || ' '
       || md5(coalesce(string_agg(p::text, E'\n' ORDER BY p::text COLLATE "C"), ''))
FROM p;

WITH f AS (
  SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner, l.lanname, p.prokind,
         p.prosecdef, p.provolatile, p.proconfig::text AS config,
         p.proacl::text AS acl, md5(p.prosrc) AS src
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
)
SELECT 'C functions ' || count(*) || ' '
       || md5(coalesce(string_agg(f::text, E'\n' ORDER BY f::text COLLATE "C"), ''))
FROM f;

WITH k AS (
  SELECT c.relname, k.conname, k.contype, pg_catalog.pg_get_constraintdef(k.oid) AS def,
         k.condeferrable, k.condeferred, k.convalidated
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
)
SELECT 'C constraints ' || count(*) || ' '
       || md5(coalesce(string_agg(k::text, E'\n' ORDER BY k::text COLLATE "C"), ''))
FROM k;

WITH i AS (
  SELECT tablename, indexname, indexdef
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public'
)
SELECT 'C indexes ' || count(*) || ' '
       || md5(coalesce(string_agg(i::text, E'\n' ORDER BY i::text COLLATE "C"), ''))
FROM i;

WITH g AS (
  SELECT c.relname, t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid) AS def
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
)
SELECT 'C triggers ' || count(*) || ' '
       || md5(coalesce(string_agg(g::text, E'\n' ORDER BY g::text COLLATE "C"), ''))
FROM g;

WITH d AS (
  SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS role,
         coalesce(n.nspname, '') AS schema, d.defaclobjtype, d.defaclacl::text AS acl
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
)
SELECT 'C default_privileges ' || count(*) || ' '
       || md5(coalesce(string_agg(d::text, E'\n' ORDER BY d::text COLLATE "C"), ''))
FROM d;

-- Rows that carry no clinic: the migration log and the clinics themselves.

SELECT 'R schema_migrations ' || count(*) || ' '
       || md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''))
FROM public.schema_migrations t;

SELECT 'R clinics ' || count(*) || ' '
       || md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''))
FROM public.clinics t;

-- Rows of every table with row level security, under each clinic's own
-- context, then under a clinic id that does not exist. psql runs the
-- generated statements in order: each `X` line sets the context for the
-- `T` lines after it. The context is transaction-local and is discarded by
-- the final ROLLBACK.

WITH ctx AS (
  SELECT id::text AS clinic_id, 0 AS pass FROM public.clinics
  UNION ALL
  SELECT 'ffffffff-ffff-4fff-bfff-ffffffffffff', 1
),
rls AS (
  SELECT c.relname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
),
stmts AS (
  SELECT ctx.pass, ctx.clinic_id, 0 AS step, '' AS relname,
         format(
           'SELECT ''X %s '' || (pg_catalog.set_config(''app.current_clinic_id'', %L, true) = %L)',
           ctx.clinic_id, ctx.clinic_id, ctx.clinic_id
         ) AS sql
  FROM ctx
  UNION ALL
  SELECT ctx.pass, ctx.clinic_id, 1, rls.relname,
         format(
           'SELECT ''T %s %s '' || count(*) || '' '' || md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text COLLATE "C"), '''')) FROM public.%I t',
           ctx.clinic_id, rls.relname, rls.relname
         )
  FROM ctx CROSS JOIN rls
)
SELECT sql FROM stmts
ORDER BY pass, clinic_id COLLATE "C", step, relname COLLATE "C"
\gexec

SELECT 'restore-drill-check end';

ROLLBACK;
