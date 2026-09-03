-- Schema per docs/technical/01-database-schema.md ("patients" section) and
-- the tenant-isolation RLS policy shape given at the top of that document,
-- applied per ADR-0003 and ADR-0006.
CREATE TABLE patients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  phone_number          text,
  display_name          text,
  anonymised_at         timestamptz, -- set on ADR-0005 erasure; out of scope for this slice
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT patients_id_key UNIQUE (id, clinic_id),
  CONSTRAINT patient_has_contact_channel
    CHECK (anonymised_at IS NOT NULL OR phone_number IS NOT NULL)
);

-- Not present verbatim in the illustrative DDL, but a direct application of
-- ADR-0003's own stated consequence ("application code still benefits from
-- including clinic_id in queries for performance"): clinic_id has no index
-- otherwise, since Postgres does not automatically index foreign-key
-- columns, and every RLS-filtered query on this table filters by it.
CREATE INDEX patients_clinic_id_idx ON patients (clinic_id);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Least-privilege grants for the application role. No DELETE: erasure
-- (ADR-0005) is out of scope for this slice, and no code path needs it yet.
GRANT SELECT, INSERT, UPDATE ON patients TO app_user;
