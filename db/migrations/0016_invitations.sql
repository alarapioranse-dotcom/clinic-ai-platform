-- ADR-0023 (Accepted): one-time invitations, and the narrowly scoped
-- acceptance function that turns a pending invitation into a staff member
-- before any tenant context exists. Owner Gate 1 decisions applied here:
--   E1 invitation emails are stored trimmed and lowercase (constraint below);
--      sign-in behaviour is not changed by this migration.
--   E2 the acceptance function accepts only Argon2id password hashes.
--   E3 app_user gets NO privilege on `invitations`; only EXECUTE on the
--      acceptance function. Item 3 (staff invitations) adds its own grants.
--   E4 the "used at" timestamp is `accepted_at` (ADR-0023 / documented name).
--   E5 the function distinguishes `email_taken` internally; every invalid,
--      unknown, used or expired token is the single outcome `invalid`.
--
-- Nothing here creates a clinic, an invitation or a staff member. No raw
-- token is ever stored: only its SHA-256 hex digest.

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  email        text NOT NULL,
  role         text NOT NULL
                 CHECK (role IN ('owner', 'admin', 'practitioner', 'receptionist')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'expired')),
  -- SHA-256 of the 32-byte random token, lowercase hex. Never the raw token.
  token_hash   text NOT NULL,
  -- NULL only for an operator-provisioned first owner (ADR-0023 decision 2).
  invited_by   uuid,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invitation_token_hash_is_sha256_hex
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- E1: stored trimmed and lowercase, so sign-in's exact-match lookup can
  -- find the account the invitation creates, and case variants of one
  -- address cannot become two pending invitations.
  CONSTRAINT invitation_email_is_normalized
    CHECK (email = lower(btrim(email))),
  -- ADR-0023 decision 2: 72 hours, fixed by the database.
  CONSTRAINT invitation_expires_72h_after_creation
    CHECK (expires_at = created_at + interval '72 hours'),
  -- Tightens the documented one-way check: accepted <=> accepted_at present.
  CONSTRAINT invitation_accepted_at_matches_status
    CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)),
  CONSTRAINT invitation_inviter_required_unless_owner
    CHECK (invited_by IS NOT NULL OR role = 'owner'),
  -- Same-clinic inviter, when there is one (staff_members_id_key, 0005).
  CONSTRAINT invitations_invited_by_same_clinic_fkey
    FOREIGN KEY (invited_by, clinic_id) REFERENCES staff_members (id, clinic_id)
);

-- At most one pending invitation per (clinic, email).
CREATE UNIQUE INDEX invitations_one_pending_per_email
  ON invitations (clinic_id, email)
  WHERE status = 'pending';

CREATE INDEX invitations_clinic_id_idx ON invitations (clinic_id);

-- ADR-0023 decision 2: an invitation leaves `pending` at most once
-- (to `accepted` or `expired`) and never comes back, and its identity
-- fields never change. Enforced for every role, including the table owner.
CREATE FUNCTION invitations_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation % is no longer pending and cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'invitation identity fields are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_guard_update
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION invitations_guard_update();

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- E3: no table privilege for app_user. Stated explicitly so a hand-modified
-- environment converges to the decided state.
REVOKE ALL ON invitations FROM app_user;

-- ---------------------------------------------------------------------------
-- Acceptance role (ADR-0023 decision 4). Same creation and hardening
-- pattern as auth_bootstrap (0007) and clinic_settings_writer (0015).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invitation_acceptor') THEN
    CREATE ROLE invitation_acceptor NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Ownership-transfer prerequisites; see 0007 for why each is needed.
GRANT invitation_acceptor TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO invitation_acceptor;

DO $$
DECLARE
  needs_fix boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcanlogin INTO needs_fix
  FROM pg_roles WHERE rolname = 'invitation_acceptor';

  IF NOT needs_fix THEN
    RETURN;
  END IF;

  BEGIN
    ALTER ROLE invitation_acceptor NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'invitation_acceptor already exists with elevated privileges (SUPERUSER, LOGIN, and/or '
      'BYPASSRLS), and the role running this migration (%) does not have the privilege to '
      'remove them. Fix it manually, connected as a superuser, then re-run migrations: '
      'ALTER ROLE invitation_acceptor NOLOGIN NOSUPERUSER NOBYPASSRLS;', current_user;
  END;
END
$$;

-- Column-scoped privileges: exactly what accept_invitation references.
GRANT SELECT (id, clinic_id, email, role, status, expires_at, token_hash)
  ON invitations TO invitation_acceptor;
GRANT UPDATE (status, accepted_at) ON invitations TO invitation_acceptor;
-- The staff id is generated inside the function, so no RETURNING and no
-- SELECT privilege on staff_members is needed.
GRANT INSERT (id, clinic_id, email, password_hash, role, status)
  ON staff_members TO invitation_acceptor;

-- Row visibility without BYPASSRLS (ADR-0013 pattern), on `invitations`
-- only and for this role only. There is deliberately no such policy on
-- staff_members: the insert there passes the ordinary tenant_isolation
-- WITH CHECK under the context the function sets.
CREATE POLICY invitation_acceptor_select ON invitations
  FOR SELECT
  TO invitation_acceptor
  USING (true);

CREATE POLICY invitation_acceptor_update ON invitations
  FOR UPDATE
  TO invitation_acceptor
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- accept_invitation: the third pre-tenant-context function (ADR-0023).
-- plpgsql (never inlined, so SECURITY DEFINER always takes effect), static
-- SQL only, pinned search_path. Outcomes: 'accepted', 'invalid' (unknown,
-- used, expired or malformed token, indistinguishable), 'email_taken'.
-- Expiry and email_taken return instead of raising, so the caller's
-- transaction commits the expired status, and an email_taken invitation
-- stays pending.
-- ---------------------------------------------------------------------------
CREATE FUNCTION accept_invitation(p_token_hash text, p_password_hash text)
RETURNS TABLE (outcome text, staff_id uuid, clinic_id uuid, role text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
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
  IF p_password_hash IS NULL OR left(p_password_hash, 10) <> '$argon2id$' THEN
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
  FROM invitations i
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_expires_at <= now() THEN
    UPDATE invitations i SET status = 'expired' WHERE i.id = v_invitation_id;
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_staff_id := gen_random_uuid();

  -- The staff row is written under the invitation's own clinic context, so
  -- staff_members' ordinary tenant_isolation WITH CHECK still applies.
  BEGIN
    PERFORM set_config('app.current_clinic_id', v_clinic_id::text, true);
    INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
    VALUES (v_staff_id, v_clinic_id, v_email, p_password_hash, v_role, 'active');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    PERFORM set_config('app.current_clinic_id', '', true);
    IF v_constraint = 'staff_members_email_key' THEN
      RETURN QUERY SELECT 'email_taken'::text, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    RAISE;
  END;

  -- ADR-0023 decision 4: the context is cleared before returning.
  PERFORM set_config('app.current_clinic_id', '', true);

  UPDATE invitations i
  SET status = 'accepted', accepted_at = now()
  WHERE i.id = v_invitation_id;

  RETURN QUERY SELECT 'accepted'::text, v_staff_id, v_clinic_id, v_role;
END;
$$;

COMMENT ON FUNCTION accept_invitation(text, text) IS
  'ADR-0023. The only pre-tenant-context path into invitations. Resolves one pending invitation '
  'by SHA-256 token hash and creates its staff member. Clinic, email and role come only from the '
  'invitation. Never returns the email, token hash or password hash. Do not add arguments, widen '
  'the tables it touches, or widen the EXECUTE grant.';

ALTER FUNCTION accept_invitation(text, text) OWNER TO invitation_acceptor;
REVOKE ALL ON FUNCTION accept_invitation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invitation(text, text) TO app_user;
