-- Schema per docs/technical/01-database-schema.md ("clinics" section).
CREATE TABLE clinics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  contact_email    text,
  contact_phone    text,
  owner_email      text NOT NULL,
  status           text NOT NULL DEFAULT 'onboarding'
                     CHECK (status IN ('onboarding', 'active')),
  working_hours    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clinic_has_contact_channel
    CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL),

  -- Composite unique target for other tenant-scoped tables' composite
  -- foreign keys (see 0004_patients.sql).
  CONSTRAINT clinics_id_key UNIQUE (id)
);

-- No clinic_id column and no RLS policy: clinics is the tenant itself
-- (docs/technical/01-database-schema.md: "a clinic must be able to find its
-- own row before any app.current_clinic_id context exists").
GRANT SELECT, INSERT ON clinics TO app_user;
