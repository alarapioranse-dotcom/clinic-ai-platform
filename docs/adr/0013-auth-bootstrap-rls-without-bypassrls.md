# 0013 — Auth bootstrap RLS access via an explicit policy, not BYPASSRLS

## Status

Proposed

## Date

2026-09-06

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

Costly to reverse (see [charter §10](../governance/project-charter.md)) — this is a database
permissions boundary, the same class of decision [ADR-0012](./0012-authentication-bootstrap-security-definer.md)
made. It touches the isolation guarantee [ADR-0006](./0006-rls-tenant-context-propagation.md) rests
on directly, and corrects one specific sub-decision inside an already-Accepted ADR.

## Context

Issue #43: `db/migrations/0007_auth_bootstrap_functions.sql` fails on Render —

```
CREATE ROLE auth_bootstrap NOLOGIN NOSUPERUSER BYPASSRLS
permission denied to create role (SQLSTATE 42501)
Only roles with the BYPASSRLS attribute may create roles with the BYPASSRLS attribute
```

ADR-0012 designed `auth_bootstrap` as a dedicated `NOLOGIN NOSUPERUSER BYPASSRLS` role, reasoning
that `staff_members` and `staff_sessions` both carry `FORCE ROW LEVEL SECURITY`, which applies RLS
even to the table owner, so `SECURITY DEFINER` alone would not let the two bootstrap functions read
across clinics. That reasoning about `FORCE ROW LEVEL SECURITY` is correct, but only for the table
_owner_ — and it does not actually justify giving `auth_bootstrap` `BYPASSRLS`, because
`auth_bootstrap` was never the table owner (the migration/owner role is). This ADR corrects that one
sub-decision; the rest of ADR-0012 — `SECURITY DEFINER`, `plpgsql` (not `sql`) to prevent inlining,
pinned `search_path`, column-limited grants, `EXECUTE` restricted to `app_user`, the two functions'
fixed shape and return columns — is unaffected and unchanged.

### Why BYPASSRLS itself can't be granted here

Confirmed empirically (not just from the Render error) against a genuine, non-superuser,
non-`BYPASSRLS`, `CREATEROLE` scratch owner role: `CREATE ROLE ... BYPASSRLS` and
`ALTER ROLE ... BYPASSRLS` both require the _executing_ role to already carry `BYPASSRLS` itself.
Holding `CREATEROLE` — which is what lets the owner/migration role create `app_user` in
`0002_app_role.sql` without incident — is not sufficient for this one specific attribute. The
owner/migration role on every managed Postgres this project deploys to (Render, Supabase, Neon, RDS)
has neither `SUPERUSER` nor `BYPASSRLS`, and no config knob changes that — a platform invariant, not
something a Render dashboard setting can fix.

### Why auth_bootstrap doesn't need BYPASSRLS at all

`FORCE ROW LEVEL SECURITY` changes RLS behavior for the table **owner** only — a non-owner role is
already fully subject to ordinary RLS with or without `FORCE`. `auth_bootstrap` is a role distinct
from the table owner (same as `app_user`), so `FORCE` was never the reason it needed a bypass in the
first place. Without any policy naming it, a non-owner role with RLS enabled gets the ordinary
default: zero rows, for every query, regardless of `BYPASSRLS`. That is exactly the same
default-deny behavior `app_user` already gets from `tenant_isolation` with no matching
`app.current_clinic_id` — the only thing missing for `auth_bootstrap` was a policy that names it.

### Two more privilege errors this surfaced, once BYPASSRLS was no longer masking them

Fixing the `CREATE ROLE` line surfaced two further permission errors when re-tested against the
same genuine non-superuser scratch owner, both already present in the original migration and
unrelated to `BYPASSRLS` — the local Postgres superuser (a real superuser, unlike any managed
Postgres owner role) had been masking these too, alongside issue #41's original bug, simply because
a superuser bypasses every one of these checks silently:

1. `ALTER FUNCTION ... OWNER TO auth_bootstrap` requires the executing role to be able to `SET ROLE`
   to `auth_bootstrap`. PostgreSQL 16 auto-grants the role that runs `CREATE ROLE` membership in the
   role it just created, but only `WITH ADMIN OPTION`, not `WITH SET` — a deliberate PG16 hardening.
   Fixed with an explicit `GRANT auth_bootstrap TO CURRENT_USER WITH SET TRUE`.
2. Transferring ownership to `auth_bootstrap` also requires `auth_bootstrap` itself to hold `CREATE`
   on the containing schema (`public`) — the same rule Postgres applies to any prospective object
   owner, independent of whether that role will ever issue `CREATE` itself. `auth_bootstrap` never
   does: it is `NOLOGIN`, and the two functions it owns are fixed, static SQL with no dynamic-SQL
   path, so this grant is checked once at ownership-transfer time and is never exercised as an actual
   capability. Fixed with an explicit `GRANT CREATE ON SCHEMA public TO auth_bootstrap`.

## Decision

`auth_bootstrap` no longer carries `BYPASSRLS`. It is `NOLOGIN NOSUPERUSER NOBYPASSRLS`, same as
`app_user`. In its place, `staff_members` and `staff_sessions` each get one additional, explicit,
permissive RLS policy scoped to `auth_bootstrap` alone:

```sql
CREATE POLICY auth_bootstrap_select ON staff_members
  FOR SELECT TO auth_bootstrap USING (true);
-- identical shape for staff_sessions
```

This policy combines with the existing `tenant_isolation` policy by `OR` (PostgreSQL policies are
permissive by default) and applies only to queries running as `auth_bootstrap` — which, per
ADR-0012, only ever happens inside the two `SECURITY DEFINER` functions during the single call each
one makes. Every other role, `app_user` included, is still governed by `tenant_isolation` alone.

`0007_auth_bootstrap_functions.sql`'s guarded, non-unconditional re-assertion of role attributes
(the pattern `0002_app_role.sql` introduced for issue #41) is extended to `auth_bootstrap` too, since
an unconditional `ALTER ROLE ... NOSUPERUSER` would hit the identical SQLSTATE 42501 the moment this
file is ever re-run by a non-superuser owner connection.

## Consequences

- Migration 0007 now applies on Render, Supabase, Neon, and RDS without requiring any privilege the
  owner/migration role doesn't already have — no manual, out-of-band, hosting-console step to grant
  `BYPASSRLS` to anything, ever.
- The isolation boundary ADR-0012 already made auditable by inspection (two functions, two sets of
  column grants, two `EXECUTE` grants) now also includes two named rows in `pg_policies` — still
  inspectable by the same "two functions, two grants, two policies" reasoning, not widened.
- `BYPASSRLS` is not used anywhere in this schema, cluster-wide. A future reviewer can confirm the
  entire RLS bypass surface by grep-ing for `BYPASSRLS` and finding nothing, rather than needing to
  reason about what a role carrying it might be used for.
- `auth_bootstrap` holds `CREATE` on schema `public` as a side effect of the ownership-transfer
  requirement described above. This is checked once, at migration time, and never exercised as a
  capability (`auth_bootstrap` is `NOLOGIN` and owns only two fixed, static functions) — but it is a
  broader nominal grant than the column-level `SELECT` grants this ADR otherwise keeps narrow, and is
  worth naming explicitly rather than leaving as an unexplained line in the migration.
- ADR-0012 itself is not edited (per [`docs/adr/README.md`](./README.md), "records are never edited
  after acceptance") — its "Why SECURITY DEFINER, and not making app_user BYPASSRLS" section still
  describes `auth_bootstrap` as carrying `BYPASSRLS`, which this ADR supersedes on that one point.
  Per the hard rule in `CLAUDE.md` ("no ADR changes status without a human comment in the pull
  request saying so"), this record does not itself change ADR-0012's Status line to
  `Superseded by 0013` — a human reviewer should do that explicitly in review if this ADR is
  accepted.

## Alternatives considered

- **Keep `BYPASSRLS` on `auth_bootstrap`, exactly as ADR-0012** — the status quo this ADR replaces.
  Rejected: cannot be provisioned on any managed Postgres this project targets, confirmed both by the
  reported Render failure and by direct empirical testing against a genuine non-superuser,
  non-`BYPASSRLS`, `CREATEROLE` role.
- **`BYPASSRLS` on `app_user` directly.** Already rejected by ADR-0012 for a stronger reason (it
  would widen the bypass to every query the running application ever issues, not two named lookups);
  still rejected here, and still unprovisionable to begin with, for the same platform-invariant
  reason.
- **`SECURITY DEFINER` functions owned by the migration/table-owner role itself**, relying on
  `FORCE ROW LEVEL SECURITY` plus a policy scoped to that owner role. Rejected: the owner role is
  also the role that runs every migration and any ad hoc administrative query, so a permissive policy
  scoped to it would apply to all of that too, not just the two bootstrap functions — a materially
  larger blast radius than a dedicated, `NOLOGIN`, single-purpose role.
- **Reuse `withoutTenantContext()` in production.** Already rejected by ADR-0012 (no argument or
  column restriction, so any future caller could reach any table); unaffected by this change.
