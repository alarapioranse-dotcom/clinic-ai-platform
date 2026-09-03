-- Schema per docs/technical/01-database-schema.md ("staff_members" section)
-- and docs/technical/04-auth-implementation.md ("Credential storage"),
-- amended by ADR-0012 (Decision 1, human-approved): email is GLOBALLY
-- unique, not merely unique per clinic. The documented sign-in flow
-- resolves `{ email, password }` alone, with no clinic selector anywhere in
-- the product — a per-clinic-only uniqueness constraint would let the same
-- email exist at two clinics and make that lookup ambiguous.
CREATE TABLE staff_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  email            text NOT NULL,
  password_hash    text NOT NULL,
  role             text NOT NULL
                     CHECK (role IN ('owner', 'admin', 'practitioner', 'receptionist')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  working_hours    jsonb, -- NULL = clinic default applies; see docs/domain/01-entities.md
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Composite target for future same-clinic composite foreign keys
  -- (invitations, appointments.practitioner_id, ...), same pattern as
  -- db/migrations/0004_patients.sql's patients_id_key.
  CONSTRAINT staff_members_id_key UNIQUE (id, clinic_id),
  -- Global, not per-clinic (ADR-0012, Decision 1) — see comment above.
  CONSTRAINT staff_members_email_key UNIQUE (email)
);

-- Same rationale as patients_clinic_id_idx (0004_patients.sql): clinic_id
-- has no index otherwise, and every RLS-filtered query on this table
-- filters by it.
CREATE INDEX staff_members_clinic_id_idx ON staff_members (clinic_id);

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_members
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Ordinary tenant-scoped path only (post-login profile reads, future
-- staff-management writes — out of scope for P2-A beyond what sign-in
-- itself needs). This grant does NOT cover the sign-in email lookup, which
-- runs before any tenant context exists and is deliberately not reachable
-- through this grant at all — see 0007_auth_bootstrap_functions.sql and
-- docs/adr/0012-authentication-bootstrap-security-definer.md.
GRANT SELECT, INSERT, UPDATE ON staff_members TO app_user;
