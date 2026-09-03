-- Authentication bootstrap: the two pre-tenant-context lookups sign-in and
-- session validation need, per docs/adr/0012-authentication-bootstrap-security-definer.md
-- (human-approved). Every RLS policy in this schema keys on
-- app.current_clinic_id (ADR-0003, ADR-0006), but resolving *which* clinic
-- a request belongs to is exactly what these two lookups do — they cannot
-- be gated by the setting they're the ones establishing. This is the one,
-- narrow, reviewed RLS bypass in the codebase; nothing else may use it, and
-- it is never granted to app_user directly (see ADR-0012 for the full
-- reasoning, including why `SECURITY DEFINER` alone is insufficient here
-- given `FORCE ROW LEVEL SECURITY` applies to the table owner too).

-- NOLOGIN: nothing can ever authenticate as this role directly — it has no
-- password. Its BYPASSRLS privilege is only ever exercised inside the two
-- functions below, which it owns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_bootstrap') THEN
    CREATE ROLE auth_bootstrap NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;

-- Unconditional, every run — same defense as db/migrations/0002_app_role.sql's
-- identical pattern for app_user: re-assert the required attributes
-- regardless of whether the role was just created or already existed, so a
-- prior manual setup can't silently leave it with different privileges.
ALTER ROLE auth_bootstrap NOLOGIN NOSUPERUSER BYPASSRLS;

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
