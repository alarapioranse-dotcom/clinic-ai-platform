-- Roadmap P4 (Appointments), implementing ADR-0016 ("clinic working hours
-- are interpreted in the clinic's IANA timezone", Accepted). ADR-0016
-- decision item 3 requires a persisted clinic-level IANA timezone
-- attribute; this migration adds it. ADR-0016's "Resolved: existing-clinic
-- timezone migration" section records the owner's ruling on how the one
-- already-existing clinic row is handled and that the column carries no
-- DEFAULT for any other clinic.
--
-- Ordering: `clinics` may already contain rows in a real deployment
-- (production currently has exactly the deployment-validation demo clinic,
-- id 00000000-0000-0000-0000-000000000001 -- see scripts/seed.ts), and this
-- column is NOT NULL with no DEFAULT (ADR-0016). PostgreSQL rejects `ALTER
-- TABLE ... ADD COLUMN ... NOT NULL` outright against a table with existing
-- rows and no DEFAULT to backfill them with, so this migration proceeds in
-- three steps: add the column nullable; backfill the one known existing row
-- explicitly; only then add the NOT NULL constraint. On a fresh database
-- (every test run, and any environment where this migration runs before
-- scripts/seed.ts has ever been executed) the backfill UPDATE below matches
-- zero rows and is a no-op, and the final NOT NULL still succeeds trivially
-- because no row is left without a value either way.
ALTER TABLE clinics ADD COLUMN timezone text;

-- Owner decision (P4 IMPLEMENTATION, ADR-0016 follow-up, recorded verbatim
-- here per that decision): the demo clinic
-- (00000000-0000-0000-0000-000000000001, "Deployment Validation Demo
-- Clinic" -- scripts/seed.ts) is a synthetic deployment-validation artifact
-- with no location data anywhere in its definition, so no zone is derived
-- from evidence. Africa/Cairo is chosen deliberately, not inferred: it
-- observes DST and is not UTC, which makes this validation row exercise the
-- clinic-local semantics ADR-0016 establishes rather than mask them. The
-- value is a one-row, non-customer column and is trivially changeable
-- later; it is not a default for any other clinic and no fallback path may
-- ever use it.
UPDATE clinics SET timezone = 'Africa/Cairo'
  WHERE id = '00000000-0000-0000-0000-000000000001';

-- No silent fallback for any other clinic (ADR-0016: "NOT NULL with no
-- DEFAULT... every future clinic must supply its own with no silent
-- fallback"). Every clinic created after this migration must explicitly
-- supply its own timezone at INSERT time.
ALTER TABLE clinics ALTER COLUMN timezone SET NOT NULL;

-- app_user needs to read this column: the appointments feature's
-- availability computation (src/features/appointments) converts a clinic's
-- working-hours wall-clock windows into absolute instants using it. Same
-- column-restricted SELECT pattern 0003_clinics.sql established for
-- working_hours -- an incremental grant, additive to the existing
-- `GRANT SELECT (id, name, status, working_hours)` rather than replacing it.
GRANT SELECT (timezone) ON clinics TO app_user;
