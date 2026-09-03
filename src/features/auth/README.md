# auth

Staff authentication, session, and tenant-context resolution — roadmap **P2-A**. See
`docs/technical/04-auth-implementation.md` and
`docs/adr/0012-authentication-bootstrap-security-definer.md` for the full design.

## Current scope (P2-A slice)

- `signIn(email, password)` — verifies credentials, creates a `staff_sessions` row, returns the raw
  session token plus `{ staffId, clinicId, role }`. Throws `InvalidCredentialsError` (same message
  and comparable timing) for unknown email, wrong password, and deactivated staff alike.
- `validateSession(rawToken)` — resolves a session cookie's raw token to `{ staffId, clinicId, role }`,
  or `null` for anything invalid (missing, malformed, expired, revoked, or deactivated-staff).
- `signOut(rawToken)` — revokes the session identified by `rawToken`, if currently valid.
- `hashPassword(password)` — Argon2id hashing, exposed for test fixtures (and later, P2-B's
  invitation-acceptance flow) to create `staff_members` rows with a real credential.
- `SESSION_COOKIE_NAME`, `SESSION_MAX_AGE_SECONDS` — the pinned cookie name (`session`) and lifetime
  (7 days), per ADR-0012.

`clinic_id` is trusted **only** from `validateSession`'s return value — never from a request
parameter (`docs/technical/03-api-contracts.md`). Every write after a caller has that value uses
`withTenantContext(clinicId, fn)`, exactly like every other tenant-scoped feature.

## The pre-tenant-context bootstrap

Sign-in and session validation both need to resolve `clinic_id` _before_ it can be set for RLS to
key on — a structural bootstrapping problem `withTenantContext` cannot solve, since it requires
`clinicId` as an argument. This feature's `./repository.ts` calls two narrow, named functions in
`src/lib/db.ts` (`lookupStaffByEmailForAuth`, `lookupSessionByTokenHashForAuth`), each of which
calls exactly one `SECURITY DEFINER` PostgreSQL function
(`db/migrations/0007_auth_bootstrap_functions.sql`). See
[`docs/adr/0012-authentication-bootstrap-security-definer.md`](../../../docs/adr/0012-authentication-bootstrap-security-definer.md)
for why this is the only sanctioned RLS bypass in the codebase, and why `withoutTenantContext()`
(test-only) is not an acceptable substitute.

**Not yet implemented** (P2-B and later, not this slice): staff invitation acceptance (the only
documented way to create a non-Owner `staff_members` row), staff/role management, and any
role-based authorization beyond "does a valid session exist."

## Rules

- This feature computes; routes and the `(app)` layout compose it, not the other way around.
- No other feature may import from this feature's internals. `./index.ts` is the only valid import
  target — `./repository.ts`, `./password.ts`, and `./token.ts` are internal.
- `process.env` is never read here.
- `password_hash` and `token_hash`/raw tokens never appear in any value this module returns to a
  route handler beyond the one raw token `signIn` returns for the caller to set as a cookie.
