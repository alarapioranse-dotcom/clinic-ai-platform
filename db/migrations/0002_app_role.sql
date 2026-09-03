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
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Unconditional, every run (PR #25 review): the DO block above only acts
-- when app_user doesn't exist yet, which means a role that already exists
-- with elevated privileges (a prior manual setup, or a hosting provider's
-- default role) would silently keep them, quietly invalidating every RLS
-- guarantee in this repository while the test suite still passes. This
-- line closes that gap by re-asserting the required attributes regardless
-- of whether the role was just created or already existed.
ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;

-- CONNECT on the current database is granted to PUBLIC by default when a
-- database is created and is not revoked anywhere in this repository, so no
-- explicit GRANT CONNECT is needed here (GRANT ... ON DATABASE requires a
-- literal database name, which this migration deliberately does not
-- hardcode, to stay portable across local/CI/deployment database names).
GRANT USAGE ON SCHEMA public TO app_user;
