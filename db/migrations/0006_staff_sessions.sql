-- Schema per docs/technical/04-auth-implementation.md ("Sessions"), amended
-- by the human-approved P2-A decisions recorded in
-- docs/adr/0012-authentication-bootstrap-security-definer.md:
--   - token_hash is SHA-256(raw token), hex-encoded (Decision 3).
--   - expires_at is set by application code to created_at + 7 days
--     (Decision 4); enforced on every lookup, not only at creation.
CREATE TABLE staff_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id  uuid NOT NULL REFERENCES staff_members(id),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  token_hash       text NOT NULL UNIQUE, -- hash of the opaque session token; raw token is never stored
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,

  -- Same-clinic reference: a session's clinic_id must match its staff
  -- member's clinic_id, structurally — same pattern as
  -- conversations_patient_same_clinic in docs/technical/01-database-schema.md.
  CONSTRAINT staff_sessions_staff_same_clinic
    FOREIGN KEY (staff_member_id, clinic_id) REFERENCES staff_members (id, clinic_id)
);

CREATE INDEX staff_sessions_clinic_id_idx ON staff_sessions (clinic_id);
-- Every authenticated request looks up a session by token_hash before any
-- tenant context exists (via the SECURITY DEFINER function, which already
-- has a UNIQUE constraint to use); this index additionally speeds up the
-- ordinary tenant-scoped reads/writes against this table.
CREATE INDEX staff_sessions_staff_member_id_idx ON staff_sessions (staff_member_id);

ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_sessions
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- INSERT (at sign-in, once clinic_id is known) and UPDATE (to set
-- revoked_at at sign-out) both run through withTenantContext under the
-- ordinary tenant-scoped path. No DELETE grant: sessions are revoked, never
-- removed, so the row remains available as an audit trail of past sign-ins.
-- Session validation itself (the pre-tenant-context read by token_hash)
-- does NOT use this grant — see 0007_auth_bootstrap_functions.sql.
GRANT SELECT, INSERT, UPDATE ON staff_sessions TO app_user;
