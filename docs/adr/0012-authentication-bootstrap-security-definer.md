# 0012 — Authentication bootstrap via SECURITY DEFINER lookup

## Status

Accepted — 2026-09-03. Approved by the owner in conversation (P2-A design review), applied in this
pull request.

## Date

2026-09-03

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

Costly to reverse (see [charter §10](../governance/project-charter.md)) — this is a database
permissions boundary. Once application code and RLS policies assume this mechanism, changing it
means touching every session-bootstrap code path and the role/permission grants underneath it, not
a config change.

## Context

Every tenant-scoped table's RLS policy keys on `current_setting('app.current_clinic_id', true)`
([ADR-0003](./0003-multi-tenancy-model.md), [ADR-0006](./0006-rls-tenant-context-propagation.md)).
That setting is only established after a request's `clinic_id` is known — but two operations, by
construction, must run before it can be known:

1. **Sign-in**: resolving `email` + `password` to a staff member requires reading `staff_members`
   across all clinics, because the caller hasn't proven which clinic they belong to yet.
2. **Session validation**: resolving a session cookie's token to a `clinic_id` requires reading
   `staff_sessions` before that same `clinic_id` is available to `SET LOCAL`.

Both are a structural chicken-and-egg problem, not an oversight: RLS cannot gate the very query
that discovers which tenant a request belongs to.
[`docs/technical/04-auth-implementation.md`](../technical/04-auth-implementation.md) already named
this for case 1 ("a narrowly-scoped path that bypasses RLS deliberately... e.g., a SECURITY
DEFINER function") but left the mechanism undecided, and never addressed case 2 at all.

`src/lib/db.ts` already has a function that runs queries with no tenant context —
`withoutTenantContext()` — but it exists solely to let the tenant-isolation test suite prove RLS
fails closed
([`docs/technical/02-tenant-isolation-testing.md`](../technical/02-tenant-isolation-testing.md)),
and is guarded to throw outside `NODE_ENV=test`. Using it in production would mean shipping a
general-purpose "run any query with no tenant filter" capability reachable from application code —
exactly the failure mode ADR-0003 and ADR-0006 exist to prevent, and a direct violation of
[charter §5](../governance/project-charter.md) ("access defaults to the least privilege that lets
the work get done").

## Decision

Two fixed-shape, narrowly-scoped `SECURITY DEFINER` PostgreSQL functions are the only sanctioned
way to read `staff_members` or `staff_sessions` before `app.current_clinic_id` is known. No other
RLS bypass exists anywhere in the application's runtime path.

### Why SECURITY DEFINER, and not making app_user BYPASSRLS

`app_user` (the application's runtime role, `db/migrations/0002_app_role.sql`) stays `NOSUPERUSER
NOBYPASSRLS`, unconditionally. Granting it `BYPASSRLS` would remove RLS as a guarantee for every
query the application ever runs, not just the two bootstrap lookups — a single mistaken query
anywhere in the codebase would then silently read across all clinics. A `SECURITY DEFINER` function
scopes the bypass to two named, argument-typed, column-limited functions instead of a role-wide
privilege.

### The RLS/FORCE RLS subtlety this design must get right

Every tenant-scoped table in this schema has `FORCE ROW LEVEL SECURITY`, which — per PostgreSQL's
own semantics — makes RLS apply even to the table owner. A `SECURITY DEFINER` function owned by the
same role that owns the tables would therefore still be blocked by RLS with no
`app.current_clinic_id` set; `SECURITY DEFINER` alone does not bypass anything here. Only a role
carrying the `BYPASSRLS` attribute bypasses RLS regardless of `FORCE`. So:

- A new, dedicated role, `auth_bootstrap`, is created: `NOLOGIN NOSUPERUSER BYPASSRLS`. `NOLOGIN`
  means nothing can ever authenticate as this role directly — its bypass power is only ever
  exercised inside the two functions it owns.
- The two functions are `SECURITY DEFINER`, owned by `auth_bootstrap`, so they run with
  `auth_bootstrap`'s privileges — including its `BYPASSRLS` — for the single parameterized query
  each one contains.
- `auth_bootstrap` is granted column-limited `SELECT` on exactly the columns each function
  references — nothing else, and no table-wide grant. This includes columns used only in a `WHERE`
  predicate and never returned (`staff_members.email`, for `auth_lookup_staff_by_email`'s filter) —
  PostgreSQL's column-privilege check applies to every column a query touches anywhere, not only
  the ones in its result; this was caught empirically the same way as the `plpgsql`-vs-`sql` issue
  below (a first pass granted only the five returned columns and the function still failed with
  `permission denied for table staff_members`).

### What the functions are allowed to return

- `auth_lookup_staff_by_email(p_email text)` → at most one row of `(staff_id, clinic_id, role,
status, password_hash)`. `password_hash` is returned here because Argon2id verification happens
  in application code (Postgres has no native Argon2id), not because it's meant to reach an HTTP
  response — the API layer never serializes it.
- `auth_lookup_session_by_token_hash(p_token_hash text)` → at most one row of `(session_id,
staff_id, clinic_id, role, status)`, and only for a session that is currently valid — the
  function's own `WHERE` clause excludes expired sessions, revoked sessions, and sessions whose
  staff member has since been deactivated, so "invalid session" and "no session" are
  indistinguishable to the caller, the same collapsing-of-sensitive-states pattern
  [`docs/technical/03-api-contracts.md`](../technical/03-api-contracts.md) already uses for
  404-vs-403. No `token_hash` column is returned (the caller already has the token it hashed).

Neither function accepts anything beyond one typed scalar argument. Neither builds SQL dynamically
(`LANGUAGE plpgsql`, a single static parameterized query per function, no `EXECUTE`/`format()`) —
there is no code path by which caller input becomes part of the query structure, so arbitrary-SQL
injection through these functions is not a category of risk that exists here.

**`LANGUAGE plpgsql`, not `LANGUAGE sql`, and why it matters:** a single-statement SQL-language
function is eligible for planner inlining, and an inlined function's permission checks run as the
_caller_, not the definer — silently defeating `SECURITY DEFINER` regardless of every grant being
otherwise correct. This was caught empirically while implementing this ADR (`app_user` got
`permission denied for table staff_members` even with `auth_bootstrap`'s column grants and
`BYPASSRLS` all in place, until the functions were changed to `plpgsql`). `plpgsql` functions are
never inlined, so the privilege switch to `auth_bootstrap` is guaranteed to actually take effect for
the duration of the call.

### How EXECUTE is restricted

```sql
REVOKE ALL ON FUNCTION auth_lookup_staff_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_staff_by_email(text) TO app_user;
-- (identical shape for auth_lookup_session_by_token_hash)
```

`app_user` is the only role permitted to call either function. No other application role exists
yet; if one is added later (e.g., a reporting role), it does not inherit this grant by default.

### How search_path is secured

Both functions are declared `SET search_path = public, pg_catalog` directly on the function
definition. PostgreSQL applies this for the duration of the call regardless of the calling
session's own `search_path`, closing the standard `SECURITY DEFINER` search-path-hijack class of
vulnerability (a lower-privileged role creating an object earlier in an unpinned search path to
shadow a function the definer relies on).

### How the design returns to normal RLS + withTenantContext immediately after

Both functions are read-only and used for exactly one purpose: resolving `clinic_id`. The instant a
caller has that value, every subsequent database operation — including the sign-in flow's own
`INSERT INTO staff_sessions` once the staff member is authenticated — goes through the existing
`withTenantContext(clinicId, fn)` in `src/lib/db.ts`, unchanged, with ordinary `app_user` grants and
full RLS enforcement. No request-scoped state carries elevated privilege past the bootstrap call;
`auth_bootstrap`'s `BYPASSRLS` is never active for any other query in the request.

### Abuse and failure considerations

- **Enumeration**: both functions return zero rows for "doesn't exist," matching the application
  layer's generic-401 requirement — the function itself doesn't leak which case occurred.
- **Function misuse as a general bypass**: the functions cannot be parameterized into scanning
  arbitrary tables or columns — they are fixed queries against fixed tables. `EXECUTE` is granted to
  `app_user` only, so no other role can invoke them directly either.
- **`auth_bootstrap` compromise blast radius**: since it's `NOLOGIN`, it cannot be connected to
  directly even with leaked credentials (it has none — no password is ever set on a `NOLOGIN`
  role). Its `BYPASSRLS` privilege is only reachable through the two functions' fixed queries.
- **Failure mode if a function is dropped or its grant revoked**: sign-in and session validation
  fail closed (the call itself errors), never silently falls back to a different, less-restricted
  lookup, because no such fallback exists in the application code calling these functions.

### Why a general RLS bypass is forbidden

The entire point of ADR-0003/ADR-0006 is that tenant isolation is a data-layer guarantee, not an
application-code discipline (charter §5). A general-purpose "query without tenant context" helper
reachable from production code — whether via `BYPASSRLS` on `app_user` or an exported
`withoutTenantContext()` — turns that guarantee back into "as long as every caller remembers not to
misuse this," which is the exact failure mode row-level security was adopted to remove. Confining
the bypass to two fixed, reviewed, narrowly-granted functions keeps the isolation boundary provable
by inspection (two functions, two grants) rather than by auditing every call site in the codebase.

## Consequences

- Two new database roles/functions to maintain (`auth_bootstrap` and its two functions); any future
  auth-adjacent bootstrap need must extend this same narrow pattern, not the general
  `withoutTenantContext()` escape hatch, which remains test-only.
- `withoutTenantContext()` in `src/lib/db.ts` requires no change — it was already correctly scoped
  to tests only; this ADR does not touch it, only confirms it is not the answer here.
- `staff_members` and `staff_sessions` keep ordinary `FORCE ROW LEVEL SECURITY` and ordinary
  `app_user` grants for every operation except the two bootstrap reads.
- `staff_members.email` is globally unique (not per-clinic), so this lookup returns at most one row
  — see the corresponding note in
  [`docs/technical/01-database-schema.md`](../technical/01-database-schema.md).

## Alternatives considered

- **`BYPASSRLS` on `app_user` directly.** Rejected: widens the bypass to every query the running
  application ever issues, not two named lookups — the opposite of least privilege (charter §5).
- **Reuse `withoutTenantContext()` in production**, removing its test-only guard. Rejected: it has
  no argument or column restriction, so any future caller could reach any table — the exact
  general-purpose bypass this decision exists to avoid.
- **JWT-verified claims instead of a DB-side bootstrap lookup at all.** Rejected here for the same
  reason ADR-0006 rejected it for the general tenant-context mechanism: adds a verification
  dependency and key-rotation story this slice doesn't need, for a problem two narrow functions
  already solve.
