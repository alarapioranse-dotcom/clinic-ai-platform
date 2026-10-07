-- ADR-0022 (Accepted): clinic settings are written only through a
-- tenant-bound database function. `clinics` is the tenant itself and carries
-- no Row Level Security (0003_clinics.sql), so a plain `GRANT UPDATE` to
-- app_user would be the first tenant-scoped write in this schema with no
-- database-level isolation. Instead:
--
--   1. app_user gets no UPDATE privilege on `clinics` -- not table-wide and
--      not column-scoped (asserted defensively below).
--   2. One SECURITY DEFINER function, `set_clinic_settings`, derives the
--      target row solely from `app.current_clinic_id` (ADR-0006), takes no
--      clinic identifier argument, fails closed without that context, and
--      writes only working_hours, timezone and updated_at.
--   3. The function is owned by a dedicated NOLOGIN role,
--      `clinic_settings_writer`, holding only the column privileges the
--      function needs -- never by app_user, never by a SUPERUSER or
--      BYPASSRLS role. Same precedent as auth_bootstrap
--      (0007_auth_bootstrap_functions.sql).
--   4. EXECUTE is revoked from PUBLIC and granted to app_user only.
--
-- Scope (ADR-0022 decision 4): working hours and timezone only. Services,
-- prices, per-practitioner hours, contact details, name and status are not
-- writable here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_settings_writer') THEN
    CREATE ROLE clinic_settings_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Same two ownership-transfer prerequisites as 0007 (see its comment): the
-- migrating role needs SET on the new owner role (PostgreSQL 16 grants only
-- ADMIN to a role's creator by default), and the prospective owner needs
-- CREATE on the containing schema. clinic_settings_writer is NOLOGIN and owns
-- one fixed, static-SQL function, so the schema CREATE grant is only checked
-- at ownership transfer, never exercised.
GRANT clinic_settings_writer TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO clinic_settings_writer;

-- Guarded, not unconditional -- identical reasoning to 0007's auth_bootstrap
-- block: a non-superuser connection cannot issue even a no-op ALTER of the
-- SUPERUSER attribute, so only attempt it when something actually needs
-- fixing, and refuse to continue if it cannot be fixed.
DO $$
DECLARE
  needs_fix boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcanlogin INTO needs_fix
  FROM pg_roles WHERE rolname = 'clinic_settings_writer';

  IF NOT needs_fix THEN
    RETURN;
  END IF;

  BEGIN
    ALTER ROLE clinic_settings_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'clinic_settings_writer already exists with elevated privileges (SUPERUSER, LOGIN, and/or '
      'BYPASSRLS), and the role running this migration (%) does not have the privilege to '
      'remove them. Fix it manually, connected as a superuser, then re-run migrations: '
      'ALTER ROLE clinic_settings_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;', current_user;
  END;
END
$$;

-- Column-limited privileges: exactly what the function body references.
-- `id` is read by the WHERE predicate (PostgreSQL checks column privilege on
-- every referenced column, not only returned ones -- see 0007's note).
GRANT SELECT (id, working_hours, timezone) ON clinics TO clinic_settings_writer;
GRANT UPDATE (working_hours, timezone, updated_at) ON clinics TO clinic_settings_writer;

-- ADR-0022 decision 1, asserted rather than assumed: no migration has ever
-- granted UPDATE on clinics to app_user, and this keeps it that way even if
-- an environment was hand-modified. A table-level REVOKE also revokes any
-- column-level UPDATE grants on the table.
REVOKE UPDATE ON clinics FROM app_user;

-- `LANGUAGE plpgsql`, never `LANGUAGE sql`: a single-statement SQL function
-- can be inlined by the planner, and an inlined function's permission checks
-- run as the caller, silently defeating SECURITY DEFINER (0007 records the
-- same finding). `SET search_path` is pinned on the function itself so the
-- caller's search_path can never redirect `clinics` or `pg_timezone_names`.
--
-- NULL for either argument means "leave this setting unchanged", so a
-- request touching only one setting is still one atomic UPDATE, with no
-- read-then-write in application code. At least one must be non-NULL.
CREATE FUNCTION set_clinic_settings(p_working_hours jsonb, p_timezone text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_context text;
  v_clinic_id uuid;
BEGIN
  -- Fail closed: no tenant context, no write. `true` = return NULL instead
  -- of raising when the setting was never defined in this session.
  v_context := current_setting('app.current_clinic_id', true);
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
  IF p_working_hours IS NOT NULL AND jsonb_typeof(p_working_hours) <> 'object' THEN
    RAISE EXCEPTION 'set_clinic_settings: invalid working hours (must be a JSON object)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ADR-0022 decision 3: a timezone PostgreSQL does not recognise can never
  -- be stored, whichever caller supplies it.
  IF p_timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'set_clinic_settings: invalid timezone'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE clinics
  SET working_hours = COALESCE(p_working_hours, working_hours),
      timezone      = COALESCE(p_timezone, timezone),
      updated_at    = now()
  WHERE id = v_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_clinic_settings: no clinic matches the tenant context'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION set_clinic_settings(jsonb, text) IS
  'ADR-0022. The only write path for clinic settings. Targets the row named by '
  'app.current_clinic_id and nothing else; fails closed without it. Writes working_hours, '
  'timezone and updated_at only. Do not add a clinic-id argument, widen the written columns, '
  'or widen the EXECUTE grant.';

ALTER FUNCTION set_clinic_settings(jsonb, text) OWNER TO clinic_settings_writer;
REVOKE ALL ON FUNCTION set_clinic_settings(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_clinic_settings(jsonb, text) TO app_user;
