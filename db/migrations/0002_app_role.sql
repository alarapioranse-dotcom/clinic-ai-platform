-- A least-privilege application role, distinct from the role that owns the
-- tables (the role this migration itself runs as, via DATABASE_URL).
--
-- This is required for docs/technical/02-tenant-isolation-testing.md's own
-- precondition for a meaningful RLS test: "a database connection that does
-- not bypass RLS (i.e., not as a superuser or table owner...)". The running
-- application, and every automated tenant-isolation test, connects as this
-- role (APP_DATABASE_URL) — never as the migration/owner role.
--
-- No password is set here (PR #25 review): this migration runs in every
-- environment, including a real deployment, and a password hardcoded in a
-- committed file would be a published credential the moment this repo is
-- public. scripts/migrate.ts sets it immediately after this file runs, via
-- a parameterized `ALTER ROLE app_user WITH PASSWORD $1` reading the
-- required APP_USER_PASSWORD environment variable — never interpolated
-- into SQL text.
-- A pre-existing app_user (a prior manual setup, or a hosting provider's
-- default role) must not silently keep elevated privileges (PR #25 review)
-- -- that would quietly invalidate every RLS guarantee in this repository
-- while the test suite still passes. But the fix must not assume the
-- connection running this migration is a superuser (issue #41): on managed
-- Postgres (e.g. Render), the owner/migration role is itself not a
-- SUPERUSER, and Postgres rejects *any* attempt to change the SUPERUSER
-- attribute from a non-superuser connection -- even a no-op ALTER that
-- would only reassert a value the role already has. So this only issues
-- the ALTER when the role's current attributes actually need to change,
-- and turns the otherwise-cryptic 42501 into an actionable error when the
-- current connection can't make that change itself.
DO $$
DECLARE
  needs_fix boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
    RETURN;
  END IF;

  SELECT rolsuper OR rolbypassrls INTO needs_fix
  FROM pg_roles WHERE rolname = 'app_user';

  IF NOT needs_fix THEN
    RETURN;
  END IF;

  BEGIN
    ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'app_user already exists with elevated privileges (SUPERUSER and/or '
      'BYPASSRLS), and the role running this migration (%) does not have '
      'the privilege to remove them. Leaving this unfixed would silently '
      'invalidate every row-level-security guarantee in this repository. '
      'Fix it manually, connected as a superuser, then re-run migrations: '
      'ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;', current_user;
  END;
END
$$;

-- CONNECT on the current database is granted to PUBLIC by default when a
-- database is created and is not revoked anywhere in this repository, so no
-- explicit GRANT CONNECT is needed here (GRANT ... ON DATABASE requires a
-- literal database name, which this migration deliberately does not
-- hardcode, to stay portable across local/CI/deployment database names).
GRANT USAGE ON SCHEMA public TO app_user;
