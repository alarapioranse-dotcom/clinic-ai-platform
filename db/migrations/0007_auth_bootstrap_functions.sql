-- Authentication bootstrap: the two pre-tenant-context lookups sign-in and
-- session validation need, per docs/adr/0012-authentication-bootstrap-security-definer.md
-- (human-approved) as amended by docs/adr/0013-auth-bootstrap-rls-without-bypassrls.md
-- (issue #43, human-approved). Every RLS policy in this schema keys on
-- app.current_clinic_id (ADR-0003, ADR-0006), but resolving *which* clinic
-- a request belongs to is exactly what these two lookups do — they cannot
-- be gated by the setting they're the ones establishing. This is the one,
-- narrow, reviewed RLS bypass in the codebase; nothing else may use it, and
-- it is never granted to app_user directly.
--
-- auth_bootstrap does NOT carry BYPASSRLS (ADR-0013 corrects ADR-0012 on
-- this specific point). `CREATE ROLE ... BYPASSRLS` and
-- `ALTER ROLE ... BYPASSRLS` both require the *executing* role to already
-- carry BYPASSRLS itself (SQLSTATE 42501, "Only roles with the BYPASSRLS
-- attribute may create roles with the BYPASSRLS attribute") — a role that
-- can create other roles (CREATEROLE) is not sufficient. The owner/migration
-- role on every managed Postgres this project deploys to (Render, Supabase,
-- Neon, RDS) has neither SUPERUSER nor BYPASSRLS, so it can never grant
-- BYPASSRLS to anything — a platform invariant, not a configuration gap
-- (issue #43). `FORCE ROW LEVEL SECURITY` (set on staff_members and
-- staff_sessions) only forces RLS enforcement onto the table *owner*;
-- auth_bootstrap has never been the table owner, so ordinary RLS semantics
-- already apply to it with no bypass involved — a non-owner role with RLS
-- enabled and no matching policy is denied by default. That means the
-- access these two functions need can instead come from an ordinary,
-- explicit, role-scoped permissive policy (below), the same mechanism every
-- other role's access in this schema goes through — not a role-wide
-- privilege that also has to be provisioned by hand outside version control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_bootstrap') THEN
    CREATE ROLE auth_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Two grants the two ALTER FUNCTION ... OWNER TO statements further below
-- need, neither related to BYPASSRLS: (1) Postgres auto-grants the role
-- that runs CREATE ROLE membership in the role it just created, but only
-- WITH ADMIN OPTION, not WITH SET (a PostgreSQL 16 hardening) -- and
-- transferring ownership of an object requires the transferring role to be
-- able to SET ROLE to the new owner. (2) transferring ownership to
-- auth_bootstrap also requires auth_bootstrap itself to hold CREATE on the
-- containing schema, the same rule Postgres applies to any prospective
-- object owner, regardless of whether that role will ever issue CREATE
-- itself -- and it never does here: auth_bootstrap is NOLOGIN, and the two
-- functions it ends up owning are fixed, static SQL with no EXECUTE/
-- dynamic-SQL path, so this grant is never actually exercised as a
-- capability, only checked once at ownership-transfer time. Both are
-- idempotent to re-run (a repeat GRANT ROLE ... WITH SET TRUE / GRANT
-- CREATE ON SCHEMA is a no-op, not an error), and both assume the role
-- running this migration is the same one that created auth_bootstrap in
-- the first place -- true in every environment this project deploys to.
GRANT auth_bootstrap TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO auth_bootstrap;

-- Guarded, not unconditional (issue #41's lesson, applied here too):
-- Postgres rejects *any* attempt to change the SUPERUSER attribute from a
-- non-superuser connection, even a no-op ALTER that would only reassert a
-- value the role already has. db/migrations/0002_app_role.sql hit exactly
-- this for app_user; an unconditional ALTER here would hit the identical
-- failure for auth_bootstrap the moment this file is ever re-run by the
-- non-superuser owner role that runs it in every real deployment. Only
-- attempt the ALTER when an attribute actually needs fixing.
DO $$
DECLARE
  needs_fix boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcanlogin INTO needs_fix
  FROM pg_roles WHERE rolname = 'auth_bootstrap';

  IF NOT needs_fix THEN
    RETURN;
  END IF;

  BEGIN
    ALTER ROLE auth_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'auth_bootstrap already exists with elevated privileges (SUPERUSER, LOGIN, and/or '
      'BYPASSRLS), and the role running this migration (%) does not have the privilege to '
      'remove them. Leaving this unfixed would silently widen the one narrow RLS bypass this '
      'schema allows. Fix it manually, connected as a superuser, then re-run migrations: '
      'ALTER ROLE auth_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS;', current_user;
  END;
END
$$;

-- Column-limited grants: auth_bootstrap can read only the columns the two
-- functions below actually use, not the full row — the same discipline
-- db/migrations/0003_clinics.sql applies to app_user's read of `clinics`.
-- `email` is included even though it isn't part of either function's
-- RETURNS TABLE: PostgreSQL's column-privilege check applies to every
-- column referenced anywhere in the query, including a WHERE predicate, not
-- only the ones returned — auth_lookup_staff_by_email filters on it.
GRANT SELECT (id, clinic_id, role, status, password_hash, email) ON staff_members TO auth_bootstrap;
GRANT SELECT (id, staff_member_id, clinic_id, token_hash, expires_at, revoked_at)
  ON staff_sessions TO auth_bootstrap;

-- The row-visibility half of the bypass (column grants above only govern
-- which columns; RLS still governs which rows). auth_bootstrap is not the
-- table owner, so this additional permissive policy — not BYPASSRLS — is
-- what lets its two functions see rows regardless of app.current_clinic_id.
-- It is combined with `tenant_isolation` by OR (Postgres policies are
-- permissive by default), and applies only to auth_bootstrap: every other
-- role, including app_user, is still governed by `tenant_isolation` alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_members'
      AND policyname = 'auth_bootstrap_select'
  ) THEN
    CREATE POLICY auth_bootstrap_select ON staff_members
      FOR SELECT
      TO auth_bootstrap
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_sessions'
      AND policyname = 'auth_bootstrap_select'
  ) THEN
    CREATE POLICY auth_bootstrap_select ON staff_sessions
      FOR SELECT
      TO auth_bootstrap
      USING (true);
  END IF;
END
$$;

-- 1. Sign-in bootstrap: resolve email -> staff member, before clinic_id is
--    known. One static, parameterized query body — no dynamic SQL (no
--    EXECUTE/format()), so caller input can never become part of the query
--    structure. `SET search_path` is pinned on the function itself so it
--    applies for the duration of the call regardless of the caller's own
--    search_path, closing the standard SECURITY DEFINER search-path-hijack
--    risk.
--
--    `LANGUAGE plpgsql`, deliberately not `LANGUAGE sql`: a single-statement
--    SQL-language function is eligible for planner inlining, and an inlined
--    function's permission checks run as the CALLER, silently defeating
--    SECURITY DEFINER's privilege switch (verified empirically while
--    writing this migration — app_user got "permission denied for table
--    staff_members" even with every grant below in place, until this was
--    changed to plpgsql). plpgsql functions are never inlined, so the
--    switch to auth_bootstrap's privileges for the duration of the call is
--    guaranteed to actually take effect.
CREATE FUNCTION auth_lookup_staff_by_email(p_email text)
RETURNS TABLE (
  staff_id      uuid,
  clinic_id     uuid,
  role          text,
  status        text,
  password_hash text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT sm.id, sm.clinic_id, sm.role, sm.status, sm.password_hash
  FROM staff_members sm
  WHERE sm.email = p_email;
END;
$$;

COMMENT ON FUNCTION auth_lookup_staff_by_email(text) IS
  'Auth bootstrap only (ADR-0012). Runs before app.current_clinic_id is known, so it must read '
  'across all clinics by email. The one deliberate, narrow RLS bypass for this lookup -- do not '
  'widen its argument, return columns, or EXECUTE grant. password_hash is returned for in-process '
  'Argon2id verification only and must never be serialized into an API response.';

ALTER FUNCTION auth_lookup_staff_by_email(text) OWNER TO auth_bootstrap;
REVOKE ALL ON FUNCTION auth_lookup_staff_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_staff_by_email(text) TO app_user;

-- 2. Session bootstrap: resolve token_hash -> session + clinic_id, before
--    clinic_id is known. Returns a row only for a session that is
--    currently valid: not expired, not revoked, AND belonging to a staff
--    member who is still active -- a staff member deactivated after a
--    session was issued loses access immediately on their next request,
--    not only at their next sign-in attempt. All three checks are enforced
--    inside the query itself, not left to the caller to re-derive, so
--    "invalid" and "nonexistent" are indistinguishable to every caller by
--    construction.
CREATE FUNCTION auth_lookup_session_by_token_hash(p_token_hash text)
RETURNS TABLE (
  session_id  uuid,
  staff_id    uuid,
  clinic_id   uuid,
  role        text,
  status      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.staff_member_id, s.clinic_id, m.role, m.status
  FROM staff_sessions s
  JOIN staff_members m ON m.id = s.staff_member_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND m.status = 'active';
END;
$$;

COMMENT ON FUNCTION auth_lookup_session_by_token_hash(text) IS
  'Auth bootstrap only (ADR-0012). Runs before app.current_clinic_id is known. Returns a row only '
  'for a currently-valid session (not expired, not revoked, staff member still active) -- '
  '"invalid" and "nonexistent" are indistinguishable to the caller by design. Do not widen its '
  'argument, return columns, or EXECUTE grant.';

ALTER FUNCTION auth_lookup_session_by_token_hash(text) OWNER TO auth_bootstrap;
REVOKE ALL ON FUNCTION auth_lookup_session_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_session_by_token_hash(text) TO app_user;
