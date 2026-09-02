-- A least-privilege application role, distinct from the role that owns the
-- tables (the role this migration itself runs as, via DATABASE_URL).
--
-- This is required for docs/technical/02-tenant-isolation-testing.md's own
-- precondition for a meaningful RLS test: "a database connection that does
-- not bypass RLS (i.e., not as a superuser or table owner...)". The running
-- application, and every automated tenant-isolation test, connects as this
-- role (APP_DATABASE_URL) — never as the migration/owner role.
--
-- The password below is a local/CI development placeholder only, matching
-- the well-known default credentials already used for the Postgres service
-- itself (see .env.example and .github/workflows/ci.yml). No production
-- secret is ever committed here (charter §5) — a real deployment sets its
-- own APP_DATABASE_URL credential outside this repository.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev_password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- CONNECT on the current database is granted to PUBLIC by default when a
-- database is created and is not revoked anywhere in this repository, so no
-- explicit GRANT CONNECT is needed here (GRANT ... ON DATABASE requires a
-- literal database name, which this migration deliberately does not
-- hardcode, to stay portable across local/CI/deployment database names).
GRANT USAGE ON SCHEMA public TO app_user;
