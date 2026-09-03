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
    CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);
-- No separate `UNIQUE (id)` constraint (PR #25 review): patients.clinic_id
-- references clinics(id) as a plain foreign key, which only requires id to
-- be unique — already guaranteed by the PRIMARY KEY above. A prior version
-- of this file had one, incorrectly described as a "composite unique
-- target"; it was single-column and redundant, so it's removed rather than
-- left as dead weight.

-- No clinic_id column and no RLS policy: clinics is the tenant itself
-- (docs/technical/01-database-schema.md: "a clinic must be able to find its
-- own row before any app.current_clinic_id context exists").
--
-- SELECT is column-restricted (PR #25 review): a table-wide grant would
-- expose every clinic's owner_email/contact_email/contact_phone — personal
-- data under GDPR — to any app_user connection, regardless of tenant
-- context, since this table carries no RLS by design. Nothing in this
-- slice reads clinics through app_user beyond what a clinic lookup needs.
-- INSERT stays table-wide for now (tenant creation isn't designed yet in
-- this slice); narrowing it to an administrative-only path is tracked
-- separately, not decided here.
GRANT SELECT (id, name, status, working_hours), INSERT ON clinics TO app_user;
