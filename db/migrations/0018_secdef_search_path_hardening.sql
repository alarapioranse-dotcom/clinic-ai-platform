-- 0018 — SECURITY DEFINER search_path hardening (defense in depth).
--
-- FINDING (reproduced locally on PostgreSQL 16, synthetic data only):
-- the four SECURITY DEFINER functions created in 0007 (the two auth lookups),
-- 0015 (clinic settings) and 0016 (accept_invitation) pinned
-- `SET search_path = public, pg_catalog`. That pins the *named* schemas, but
-- it does NOT remove the temporary schema from the search order: when
-- pg_temp is not listed explicitly, PostgreSQL still searches it FIRST for
-- relations. A session running as app_user can create a temporary table and
-- have an UNQUALIFIED table name inside one of these functions resolve to it
-- instead of the intended public table — the function then runs, with its
-- owner's privileges, against the attacker-controlled object. Locally this
-- let a forged auth row be returned and a forged invitation be accepted
-- (a real staff row written with an attacker-chosen role). Exploitation
-- requires the ability to execute arbitrary SQL as app_user (e.g. SQL
-- injection or a compromised app process); it is a defense-in-depth gap in
-- the authentication path, not demonstrated as a public unauthenticated
-- bypass.
--
-- SECOND ISSUE (same review): the old order put public BEFORE pg_catalog.
-- The three owner roles (auth_bootstrap, clinic_settings_writer,
-- invitation_acceptor) hold CREATE on public, and extensions are installed
-- into public (pgcrypto defines its own public.gen_random_uuid(), which is
-- what accept_invitation actually resolved to). So a function, operator or
-- type in public with a built-in's name could take precedence inside these
-- bodies. app_user cannot create objects in public (USAGE only), so this is
-- not reachable from app_user; it is closed here as defense in depth.
--
-- The earlier migrations' comments, and ADR-0012's "How search_path is
-- secured" section, describe `public, pg_catalog` as closing the
-- search-path-hijack class; that description is incomplete. Accepted
-- migrations and ADRs are immutable (project charter §10); this migration
-- applies the correction, and the decision is recorded in
-- docs/adr/0024-security-definer-search-path-and-name-qualification.md.
--
-- FIX (applied together):
--   1. search_path is now `pg_catalog, public, pg_temp`: built-ins are
--      resolved first, and the temporary schema is searched LAST, so neither
--      public nor pg_temp can shadow a built-in function, operator or type.
--   2. every table reference inside each body is schema-qualified (public.x),
--      so table resolution does not depend on search_path at all.
--   3. every function call inside each body is schema-qualified
--      (pg_catalog.now(), pg_catalog.set_config(...), ...). Operators and
--      type names are left unqualified and resolve through pg_catalog first.
-- CREATE OR REPLACE preserves each function's owner and privileges; owners,
-- EXECUTE grants and REVOKE FROM PUBLIC are unchanged from 0007/0015/0016,
-- and no grant is changed by this migration.

-- 1. auth_lookup_staff_by_email (0007) — owner auth_bootstrap, STABLE.
CREATE OR REPLACE FUNCTION auth_lookup_staff_by_email(p_email text)
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
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT sm.id, sm.clinic_id, sm.role, sm.status, sm.password_hash
  FROM public.staff_members sm
  WHERE sm.email = p_email;
END;
$$;

-- 2. auth_lookup_session_by_token_hash (0007) — owner auth_bootstrap, STABLE.
CREATE OR REPLACE FUNCTION auth_lookup_session_by_token_hash(p_token_hash text)
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
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.staff_member_id, s.clinic_id, m.role, m.status
  FROM public.staff_sessions s
  JOIN public.staff_members m ON m.id = s.staff_member_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > pg_catalog.now()
    AND m.status = 'active';
END;
$$;

-- 3. set_clinic_settings (0015, ADR-0022) — owner clinic_settings_writer, VOLATILE.
CREATE OR REPLACE FUNCTION set_clinic_settings(p_working_hours jsonb, p_timezone text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_context text;
  v_clinic_id uuid;
BEGIN
  -- Fail closed: no tenant context, no write. `true` = return NULL instead
  -- of raising when the setting was never defined in this session.
  v_context := pg_catalog.current_setting('app.current_clinic_id', true);
  IF v_context IS NULL OR v_context = '' THEN
    RAISE EXCEPTION 'set_clinic_settings: no tenant context (app.current_clinic_id is not set)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A malformed value raises invalid_text_representation here, before any write.
  v_clinic_id := v_context::uuid;

  IF p_working_hours IS NULL AND p_timezone IS NULL THEN
    RAISE EXCEPTION 'set_clinic_settings: nothing to update'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The application validates the full WorkingHours value object; the
  -- database independently refuses anything that is not a JSON object.
  IF p_working_hours IS NOT NULL AND pg_catalog.jsonb_typeof(p_working_hours) <> 'object' THEN
    RAISE EXCEPTION 'set_clinic_settings: invalid working hours (must be a JSON object)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ADR-0022 decision 3: a timezone PostgreSQL does not recognise can never
  -- be stored, whichever caller supplies it.
  IF p_timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'set_clinic_settings: invalid timezone'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.clinics
  SET working_hours = COALESCE(p_working_hours, working_hours),
      timezone      = COALESCE(p_timezone, timezone),
      updated_at    = pg_catalog.now()
  WHERE id = v_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_clinic_settings: no clinic matches the tenant context'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- 4. accept_invitation (0016, ADR-0023) — owner invitation_acceptor, VOLATILE.
CREATE OR REPLACE FUNCTION accept_invitation(p_token_hash text, p_password_hash text)
RETURNS TABLE (outcome text, staff_id uuid, clinic_id uuid, role text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invitation_id uuid;
  v_clinic_id     uuid;
  v_email         text;
  v_role          text;
  v_expires_at    timestamptz;
  v_staff_id      uuid;
  v_constraint    text;
BEGIN
  -- E2: only an Argon2id hash may ever be stored; a plaintext password or
  -- any other format is a caller bug and is refused before any table access.
  IF p_password_hash IS NULL OR pg_catalog.left(p_password_hash, 10) <> '$argon2id$' THEN
    RAISE EXCEPTION 'accept_invitation: password must be an Argon2id hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Malformed token hash: same outcome as an unknown token, no table access.
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Lock the one pending invitation with this hash. A concurrent acceptance
  -- of the same token waits here, then re-checks status and finds nothing.
  SELECT i.id, i.clinic_id, i.email, i.role, i.expires_at
    INTO v_invitation_id, v_clinic_id, v_email, v_role, v_expires_at
  FROM public.invitations i
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_expires_at <= pg_catalog.now() THEN
    UPDATE public.invitations i SET status = 'expired' WHERE i.id = v_invitation_id;
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_staff_id := pg_catalog.gen_random_uuid();

  -- The staff row is written under the invitation's own clinic context, so
  -- staff_members' ordinary tenant_isolation WITH CHECK still applies.
  BEGIN
    PERFORM pg_catalog.set_config('app.current_clinic_id', v_clinic_id::text, true);
    INSERT INTO public.staff_members (id, clinic_id, email, password_hash, role, status)
    VALUES (v_staff_id, v_clinic_id, v_email, p_password_hash, v_role, 'active');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    PERFORM pg_catalog.set_config('app.current_clinic_id', '', true);
    IF v_constraint = 'staff_members_email_key' THEN
      RETURN QUERY SELECT 'email_taken'::text, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    RAISE;
  END;

  -- ADR-0023 decision 4: the context is cleared before returning.
  PERFORM pg_catalog.set_config('app.current_clinic_id', '', true);

  UPDATE public.invitations i
  SET status = 'accepted', accepted_at = pg_catalog.now()
  WHERE i.id = v_invitation_id;

  RETURN QUERY SELECT 'accepted'::text, v_staff_id, v_clinic_id, v_role;
END;
$$;
