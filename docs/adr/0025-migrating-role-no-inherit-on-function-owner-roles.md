# 0025 — The migrating role keeps SET but not INHERIT on the function-owner roles

## Status

Proposed

## Date

2026-10-17

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)). Security
hardening of an already-closed phase, on the same database permissions boundary as
[ADR-0012](./0012-authentication-bootstrap-security-definer.md),
[ADR-0013](./0013-auth-bootstrap-rls-without-bypassrls.md) and
[ADR-0024](./0024-security-definer-search-path-and-name-qualification.md).

## Impact

Security-relevant (see [charter §10](../governance/project-charter.md)), and it sets a binding
convention for every future migration that replaces one of the `SECURITY DEFINER` functions. It
does not change any Accepted ADR's decision; it records a property those ADRs did not state.

## Context

The four `SECURITY DEFINER` functions are owned by three dedicated `NOLOGIN` roles:
`auth_bootstrap` (the two sign-in lookups, 0007), `clinic_settings_writer`
(`set_clinic_settings`, 0015) and `invitation_acceptor` (`accept_invitation`, 0016). To transfer
ownership to each role, its migration runs `GRANT <role> TO CURRENT_USER WITH SET TRUE`.

On PostgreSQL 16 a role grant that does not name `INHERIT` takes the grantee's own `INHERIT`
attribute, which is TRUE for an ordinary role. So on the managed database — where the migrating
role is the database owner but not a superuser — the migrating role silently inherits everything
granted to the three roles. That includes the role-scoped `USING (true)` policies
`auth_bootstrap_select` (`staff_members`, `staff_sessions`) and `invitation_acceptor_select` /
`invitation_acceptor_update` (`invitations`). Under `FORCE ROW LEVEL SECURITY` the migrating role
could therefore read those rows for every clinic, even inside one clinic's tenant context.
Reproduced locally on PostgreSQL 16 with synthetic data: under clinic A's context the migrating
role saw both clinics' rows.

`app_user`, the role the application connects as, is not a member of any of these roles and was
never affected. CI never showed the problem because it migrates as a superuser, for which neither
role inheritance nor row level security applies.

## Decision

1. The migrating role is a member of `auth_bootstrap`, `clinic_settings_writer` and
   `invitation_acceptor` with `INHERIT FALSE, SET TRUE`. Migration
   `0019_owner_role_no_inherit.sql` sets this for the memberships the migrating role granted
   itself.
2. 0019 fails closed rather than reporting a partial fix: for a non-superuser it raises if any
   membership row from any grantor still inherits one of the three roles, if `pg_has_role` with
   `USAGE` shows inherited access through any chain (direct or through an intermediate role), or
   if `SET` is no longer available. The check is skipped only for a superuser, for which
   `pg_has_role` always reports every privilege and row level security never applies.
3. **Convention for future migrations.** A migration that replaces or alters one of the four
   `SECURITY DEFINER` functions must switch to the function's owning role for that statement only,
   then restore the exact role that was executing before the switch:

   ```sql
   SELECT pg_catalog.set_config('migration.previous_role', current_user, true);
   SET LOCAL ROLE auth_bootstrap;
   CREATE OR REPLACE FUNCTION auth_lookup_staff_by_email(p_email text) ...; -- full definition
   DO $restore$
   BEGIN
     EXECUTE pg_catalog.format('SET LOCAL ROLE %I',
       pg_catalog.current_setting('migration.previous_role'));
   END
   $restore$;
   ```

   Without the switch PostgreSQL rejects the statement with `must be owner of function`, because
   ownership checks follow inherited privileges only. The pattern is shaped by
   `scripts/migrate.ts`, which runs each file inside its own `BEGIN … COMMIT` and then, in the same
   transaction, inserts the file's row into `schema_migrations`:
   - A migration file must not contain its own `BEGIN` / `COMMIT`: a `COMMIT` inside the file would
     end the runner's transaction early, so the file's changes and its `schema_migrations` row
     would no longer be applied atomically.
   - The switch must not be left active until the runner's `COMMIT`: the runner's
     `schema_migrations` insert would then run as the function-owner role and be refused, and the
     whole migration would roll back.
   - `RESET ROLE` (or `SET ROLE NONE`) is not used: it returns to the session's login role, which
     is not necessarily the role that was executing before the switch.
   - Because every switch is `SET LOCAL`, a failure at any point rolls back the transaction and
     ends the switch with it.

   Both the refused "left switched" shape and this pattern are exercised against the runner's exact
   transaction shape in `tests/db/owner-role-no-inherit.test.ts`.

## Consequences

- The migrating role no longer gets the three roles' privileges or policies ambiently. Scripts run
  with it — `scripts/provision-clinic.ts`, ad-hoc `psql` sessions — see only the rows of the tenant
  context they set, as `FORCE ROW LEVEL SECURITY` intends. `provision-clinic.ts` already worked
  this way (its global email check visits each clinic under its own context).
- This is defense in depth, not a privilege reduction of the migrating role. It still owns the
  tables and can deliberately `SET ROLE` to any of the three roles. Nothing here protects tenant
  data from the migrating role itself.
- Future migrations that touch those functions follow decision 3; one that forgets fails loudly in
  the non-superuser migration-chain tests rather than silently.
- A `GRANT` changes only the membership rows whose grantor is the role running it. If the managed
  database ever holds an inheriting row from another grantor, 0019 stops with a message naming
  the grantor; it does not try to repair it.
- Enforced by tests, not only by this record: `tests/db/owner-role-no-inherit.test.ts` runs the real
  migration chain as a non-superuser owner role and proves the cross-clinic read before 0019 and its
  absence after (clinic A, clinic B and no context), that SET stays and INHERIT is off directly and
  effectively, that 0019 changes exactly the executing role's own three membership rows and no
  other role's, that a superuser-run chain skips the guard and grants only to that superuser (never
  to a fixed role name), that 0019 fails closed for an extra grantor and for an indirect chain, that
  the guard is not skipped for a non-superuser (a mutation that skips it always is caught), that the
  four functions keep owner, `search_path`, body and `EXECUTE` grants and still work, that replacing
  a function requires `SET ROLE` to its owner, and that decision 3's pattern works inside the
  runner's transaction shape while leaving the role switched does not. The cross-clinic case checks
  row identity, not only counts: clinic A's context sees only clinic A's rows and clinic B's only
  clinic B's, in all three tables.
- Applying 0019 to production is a separate Owner decision, preceded by a read-only check of the
  production `pg_auth_members` rows for the migrating role.

## Alternatives considered

- **Revoke the memberships after ownership transfer.** Rejected: future migrations could no longer
  replace the functions at all without first re-granting membership, which needs `ADMIN` on the
  role and adds an extra grant/revoke dance to every such migration.
- **Keep inheritance and narrow the `USING (true)` policies.** Rejected: the policies are correct
  for the roles they are written for; the defect is that a different role inherits them.
- **Leave it as a documented limitation** (its status since 2026-10-11). Not chosen: the Owner
  approved the fix on 2026-10-17. The migrating role runs `provision-clinic.ts` against production
  before the first clinic onboarding, and an ambient cross-clinic read in that path is avoidable at
  near-zero cost.
