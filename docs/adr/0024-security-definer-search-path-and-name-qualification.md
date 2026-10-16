# 0024 — SECURITY DEFINER functions pin `pg_catalog, public, pg_temp` and qualify every name

## Status

Proposed

## Date

2026-10-16

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)). Security
hardening of an already-closed phase: all four affected functions sit on the authentication,
invitation and clinic-settings paths.

## Impact

Costly to reverse and security-relevant (see [charter §10](../governance/project-charter.md)): this is
the same database permissions boundary [ADR-0012](./0012-authentication-bootstrap-security-definer.md)
decided, and it corrects one specific sub-decision inside that Accepted record — the section
"How search_path is secured". It also defines what "a pinned `search_path`" means for the functions
[ADR-0022](./0022-clinic-settings-writes-through-tenant-bound-function.md) and
[ADR-0023](./0023-clinic-provisioning-one-time-invitations.md) introduced, which state that the
path is pinned but not its value.

## Context

The schema has exactly four `SECURITY DEFINER` functions, each owned by a dedicated `NOLOGIN` role:
`auth_lookup_staff_by_email` and `auth_lookup_session_by_token_hash` (migration 0007, owner
`auth_bootstrap`), `set_clinic_settings` (0015, owner `clinic_settings_writer`) and
`accept_invitation` (0016, owner `invitation_acceptor`). ADR-0012 decided that they are declared
`SET search_path = public, pg_catalog` and that this closes the `SECURITY DEFINER`
search-path-hijack class. That statement is incomplete in two ways, both reproduced locally on
PostgreSQL 16 with synthetic data:

1. **The temporary schema is searched first.** When `pg_temp` is not named in `search_path`,
   PostgreSQL still searches it first for relations and data types. Any session — including one
   running as `app_user` — can create temporary objects. A temporary table with the same name as an
   unqualified table inside one of these functions is then read or written with the owner role's
   privileges. Locally, a temporary `staff_members` table made `auth_lookup_staff_by_email` return a
   forged row, and a temporary `invitations` table made `accept_invitation` accept a forged
   invitation and write a real `staff_members` row with an attacker-chosen role. 0015 also read
   `pg_timezone_names` unqualified, which the same mechanism could shadow.
2. **`public` came before `pg_catalog`.** The three owner roles hold `CREATE` on `public` (granted in
   0007, 0015 and 0016 because ownership transfer requires it), and extensions live in `public` —
   pgcrypto's `public.gen_random_uuid()` is what `accept_invitation` actually called. An object in
   `public` with a built-in's name could therefore take precedence over the built-in inside these
   bodies. `app_user` has only `USAGE` on `public`, so this second path is not reachable from
   `app_user`; it is closed as defense in depth.

Exploiting the first path requires executing arbitrary SQL as `app_user` (for example SQL injection
or a compromised application process). It is a defense-in-depth gap in the authentication path, not
a demonstrated unauthenticated bypass. It is nevertheless the exact class of attack ADR-0012 meant
to rule out, and the authentication path is where it matters most.

## Decision

1. **Every `SECURITY DEFINER` function in this schema is declared
   `SET search_path = pg_catalog, public, pg_temp`** — exactly this value, in this order:
   built-ins first, so neither `public` nor the temporary schema can shadow a built-in function,
   operator or type; the temporary schema last, so it can never shadow anything.
2. **Every relation reference and every function call inside such a body is schema-qualified**
   (`public.staff_members`, `pg_catalog.pg_timezone_names`, `pg_catalog.now()`,
   `pg_catalog.set_config(...)`). Name resolution for tables and functions then does not depend on
   `search_path` at all; the pinned path is the second layer, not the only one. Operators and type
   names may stay unqualified: with `pg_catalog` first they resolve to the built-ins, and qualifying
   them (`OPERATOR(pg_catalog.=)`) would add noise without adding protection.
3. **The four existing functions are corrected by migration
   `db/migrations/0018_secdef_search_path_hardening.sql`**: four `CREATE OR REPLACE FUNCTION`
   statements, nothing else. Bodies change only by schema qualification; owners, `EXECUTE` grants,
   `REVOKE … FROM PUBLIC`, volatility, signatures and return types are unchanged. Accepted
   migrations 0007, 0015 and 0016 are not edited.
4. **The rule is enforced by tests**, not by review alone
   (`tests/db/secdef-search-path-hardening.test.ts`):
   - the set of `SECURITY DEFINER` functions in `public` must equal a reviewed list, and each must
     have exactly the configuration above — a new one fails the suite until it is reviewed and
     added deliberately;
   - temporary-table and temporary-type shadowing attempts against all four functions, run as
     `app_user`, change no result and write no row;
   - shadowing from `public` (a function, an operator and a type) does not change behaviour;
   - positive controls for all four legitimate paths;
   - on a scratch database owned by a non-superuser role, 0018 applies only through the role
     memberships the earlier migrations granted, changes nothing in the catalog except the four
     functions' `search_path` and source, changes each body by exactly the intended
     qualifications, and contains exactly four statements.
5. **This ADR supersedes only ADR-0012's section "How search_path is secured".** Every other part
   of ADR-0012 stands. ADR-0012's text is not rewritten (charter §10); when this ADR is accepted,
   the Owner decides how ADR-0012's Status line records the partial supersession.

## Consequences

- Any future `SECURITY DEFINER` function must follow both rules; the test suite rejects one that is
  not on the reviewed list or that pins a different path. Writing such a function now means
  qualifying every table and function name in its body.
- `accept_invitation` now calls the built-in `pg_catalog.gen_random_uuid()` instead of pgcrypto's
  `public.gen_random_uuid()`; both return a random version-4 UUID, so behaviour is unchanged.
- Production needs migration 0018 applied through the normal runner, with the Owner's approval.
  Before that, two read-only checks belong in the deployment step: the migrating role has the
  memberships 0007/0015/0016 granted (`pg_has_role(current_user, '<owner role>', 'USAGE')` for each
  of the three owner roles), and `app_user` has no `CREATE` on `public`. Neither was verified
  against production while preparing this record.
- Out of scope here, recorded for separate decisions:
  - the three `NOLOGIN` owner roles keep `CREATE` on `public`; whether it can be revoked after
    ownership transfer needs its own review, because future ownership transfers depend on it;
  - `app_user` keeps the default `TEMP` privilege; revoking it would remove the temporary-object
    route entirely, as further defense in depth;
  - the trigger function `invitations_guard_update()` is not `SECURITY DEFINER` and its body
    references no table, function or type by name; it is outside this rule.

## Alternatives considered

- **Keep `public, pg_catalog` (ADR-0012 as written).** Rejected: the temporary schema stays
  searched first and `public` stays ahead of the built-ins, which is the reproduced defect.
- **Append `pg_temp` only (`public, pg_catalog, pg_temp`).** Rejected: closes the temporary-schema
  path but leaves `public` ahead of `pg_catalog`, while the owner roles can create objects in
  `public` and extensions already place same-named functions there.
- **`pg_catalog, pg_temp`, without `public` in the path.** Equivalent protection today, because
  every relation and function reference is qualified and the tests enforce it. Not chosen because
  the reviewed configuration is `pg_catalog, public, pg_temp`. Dropping `public` remains a possible
  future tightening: it would turn a forgotten qualification into a runtime error instead of a
  working call.
- **Qualification only, leaving the path as it was.** Rejected: one missed qualification in a
  future edit would silently reopen the hole; the pinned path is the second, independent layer.
- **Record nothing and rely on the migration comment.** Rejected: ADR-0012 is Accepted and its
  Decision text states the old value. Charter §10 requires a new record for a changed decision.
