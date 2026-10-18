-- 0019 — the migrating (owner) role keeps SET but loses INHERIT on the three
-- function-owner roles (ADR-0025).
--
-- FINDING (reproduced locally on PostgreSQL 16, synthetic data only):
-- 0007, 0015 and 0016 each run `GRANT <role> TO CURRENT_USER WITH SET TRUE`
-- so the migrating role can transfer function ownership to that role. On
-- PostgreSQL 16 a GRANT that does not name INHERIT takes the grantee's own
-- INHERIT attribute — TRUE for an ordinary role — so on a managed database
-- (where the migrating role is not a superuser, e.g. Render's owner role) the
-- migrating role silently inherits everything granted to auth_bootstrap,
-- clinic_settings_writer and invitation_acceptor. That includes the
-- role-scoped `USING (true)` policies auth_bootstrap_select (staff_members,
-- staff_sessions) and invitation_acceptor_select / _update (invitations), so
-- under FORCE ROW LEVEL SECURITY the migrating role could read those rows for
-- every clinic, even inside one clinic's tenant context. app_user is not a
-- member of any of these roles and was never affected.
--
-- FIX: switch inheritance off and keep SET explicitly. The migrating role
-- can still `SET ROLE <owner role>` on purpose, which a migration that
-- replaces one of the four SECURITY DEFINER functions now has to do (see
-- ADR-0025); it no longer gets those roles' privileges ambiently.
--
-- LIMITS (recorded, not hidden): this is defense in depth. The migrating
-- role still owns the tables and can deliberately SET ROLE to any of the
-- three roles; it is not made a low-privilege role by this migration.
--
-- A GRANT changes only the membership rows whose grantor is the role running
-- it. Any other path that still gives the migrating role inherited access —
-- a row from another grantor, or an indirect chain through an intermediate
-- role — cannot be fixed safely from here, so the guard below fails the
-- migration instead of reporting a partial fix.

GRANT auth_bootstrap TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT clinic_settings_writer TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT invitation_acceptor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;

-- Fail-closed guard. Skipped only for a superuser: pg_has_role always
-- reports every privilege for a superuser, and row level security never
-- applies to one, so the check has no meaning there (this repository's CI
-- runs migrations as a superuser; the non-superuser path is covered by
-- tests/db/owner-role-no-inherit.test.ts and
-- tests/db/migration-full-chain-non-superuser.test.ts).
DO $$
DECLARE
  target text;
  direct_inheriting text[];
BEGIN
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;

  FOREACH target IN ARRAY ARRAY['auth_bootstrap', 'clinic_settings_writer', 'invitation_acceptor']
  LOOP
    -- Direct membership rows, from every grantor.
    SELECT pg_catalog.array_agg(g.rolname::text ORDER BY g.rolname)
      INTO direct_inheriting
      FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles g ON g.oid = m.grantor
     WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
       AND m.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = target)
       AND m.inherit_option;

    IF direct_inheriting IS NOT NULL THEN
      RAISE EXCEPTION
        '0019: role % still inherits % through a membership granted by %; that grantor (or a superuser) must run: GRANT % TO % WITH INHERIT FALSE GRANTED BY <grantor>',
        current_user, target, direct_inheriting, target, current_user;
    END IF;

    -- Effective inherited access, including indirect chains through other roles.
    IF pg_catalog.pg_has_role(current_user, target, 'USAGE') THEN
      RAISE EXCEPTION
        '0019: role % still has inherited access to % through another role membership; remove that inheritance chain, then re-run migrations',
        current_user, target;
    END IF;

    -- SET must remain available for deliberate, ADR-0025-style SET ROLE.
    IF NOT pg_catalog.pg_has_role(current_user, target, 'SET') THEN
      RAISE EXCEPTION '0019: role % can no longer SET ROLE to %', current_user, target;
    END IF;
  END LOOP;
END
$$;
