# Auth Implementation

Covers what [`docs/domain/00-overview.md`](../domain/00-overview.md) names as deferred to C:
"Authentication implementation (sessions, tokens, password hashing)." Scoped to StaffMember
sign-in only — per [charter §7](../governance/project-charter.md) and
[`docs/domain/01-entities.md`](../domain/01-entities.md) (Patient), "a Patient record is never
granted a session or credentials, under any circumstance"; nothing below applies to Patient.

## Credential storage

```sql
ALTER TABLE staff_members ADD COLUMN password_hash text NOT NULL;
```

Password hashing algorithm (argon2id, current OWASP-recommended parameters) is an ordinary,
reversible implementation detail — swapping hash algorithms later is a per-row rehash-on-next-login
migration, not a one-way door — so it's stated directly here rather than deferred to
[`07-open-questions.md`](./07-open-questions.md).

`password_hash` lives on `staff_members` directly (an attribute of an existing entity, not a new
one) rather than on a separate `credentials` table — there is exactly one credential per
StaffMember and no flow needs to track credential history independently of the StaffMember itself.

## Sessions

A minimal `staff_sessions` table is introduced here — **this is infrastructure supporting an
existing aggregate's sign-in, not a new domain entity**: B's StaffMember aggregate already implies
"an authenticated person" exists, and B explicitly deferred _how_ that authentication is realized
to this deliverable (see the exception carved out in
[`00-overview.md`](./00-overview.md)).

```sql
CREATE TABLE staff_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id  uuid NOT NULL REFERENCES staff_members(id),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  token_hash       text NOT NULL UNIQUE, -- hash of the opaque session token; never the raw token
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);

-- staff_sessions carries its own RLS policy like any other tenant-scoped table, keyed the same
-- way as every table in 01-database-schema.md, for the same reason: a session row is clinic data.
ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_sessions
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);
```

- `token_hash`, not the raw token, is stored — matching [charter §5](../governance/project-charter.md)
  ("Secrets live only in the deployment environment") in spirit: a leaked database backup shouldn't
  hand out usable session tokens directly.
- `revoked_at` supports sign-out and staff deactivation invalidating outstanding sessions
  immediately, rather than waiting for natural expiry.

## Sign-in flow

```text
POST /api/auth/sign-in { email, password }
  1. SELECT staff_members WHERE email = :email  -- must run without an app.current_clinic_id
     context yet, since the caller hasn't proven which clinic they belong to — see the note
     on clinics having no RLS policy in 01-database-schema.md; staff_members DOES have one,
     so this lookup runs through a narrowly-scoped path that bypasses RLS deliberately for
     this one query (e.g., a SECURITY DEFINER function), not by disabling RLS generally.
  2. If no row, or password_hash doesn't verify: 401, generic message (03-api-contracts.md).
  3. If staff_members.status = 'deactivated': 401, same generic message (does not confirm to
     the caller that the account exists but is deactivated).
  4. Generate an opaque token, store its hash in staff_sessions, set it as an HttpOnly,
     Secure, SameSite=Lax cookie.
  5. 200, body: { staffId, clinicId, role }.
```

## Invitation acceptance flow

Implements the Invitation → StaffMember transition B names but doesn't mechanize
([`docs/domain/01-entities.md`](../domain/01-entities.md), Invitation lifecycle: "Pending →
Accepted... the invitee transitions it to Accepted"):

```text
POST /api/staff/invitations/:id/accept { token, password }
BEGIN;
  1. SELECT invitations WHERE id = :id AND status = 'pending' FOR UPDATE;
     -- 0 rows -> 409 (already accepted, expired, or wrong token)
  2. IF expires_at < now(): UPDATE status = 'expired' WHERE id = :id; COMMIT; return 409.
  3. INSERT INTO staff_members (clinic_id, email, role, password_hash, status)
     VALUES (invitation.clinic_id, invitation.email, invitation.role, hash(:password), 'active');
  4. UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = :id;
COMMIT;
```

Steps 3–4 in one transaction is what makes "an Invitation can be Accepted at most once" hold under
concurrent double-submission of the same accept request: the `FOR UPDATE` row lock in step 1 plus
re-checking `status = 'pending'` in the same `WHERE` means a second concurrent request for the same
invitation blocks until the first transaction commits, then finds zero matching rows and returns
`409` — rather than both requests independently deciding the invitation was still Pending and both
creating a StaffMember.

## Role enforcement, at two layers

[ADR-0004](../adr/0004-staff-role-model.md)'s four roles are checked in two independent places,
deliberately redundant with each other — the same defense-in-depth pattern
[`01-database-schema.md`](./01-database-schema.md) uses for tenant isolation (RLS backstops
application code; here, RLS-adjacent database checks backstop the API layer):

1. **API middleware**, before a route handler runs — [`03-api-contracts.md`](./03-api-contracts.md)
   states the allowed roles per endpoint; a disallowed role never reaches handler logic.
2. **Database-level**, for the two roles whose restriction is severe enough to be worth a second,
   independent guarantee: a Patient is never granted a session at all (enforced by there being no
   sign-in path that issues a `staff_sessions` row without a matching `staff_members` row — there
   is no schema for "Patient credentials" to even exist), and a Practitioner session is never
   capable of writing to `messages`, `escalations`, or `appointments` even if an API middleware bug
   let a write request through — this is not currently expressed as a database-level check (a role
   value like `practitioner` doesn't map to a distinct Postgres role in the design above, only to
   an RLS `clinic_id` context), and is named here as a gap rather than silently assumed solved. If
   the RLS tenant-context mechanism chosen per Open Question 1 in
   [`07-open-questions.md`](./07-open-questions.md) ends up using a distinct Postgres role per
   StaffMember role (not only per clinic), that mechanism could additionally enforce Practitioner
   read-only access with a Postgres `GRANT`/`REVOKE`, independent of API-layer logic — this is
   noted as a candidate strengthening, not committed to here, since it depends on that still-open
   decision.

## How `app.current_clinic_id` gets set — a candidate pattern, not a decision

Every RLS policy in [`01-database-schema.md`](./01-database-schema.md) reads
`current_setting('app.current_clinic_id', true)`. Getting a value into that setting, per request,
requires the API layer to run (at minimum) `SELECT set_config('app.current_clinic_id', $1, true)`
on the same database connection/transaction that then runs the request's actual queries — which in
turn constrains how database connections may be pooled and reused between requests (a connection
whose session variable is left over from a previous request's clinic must never serve a different
clinic's query).

**This document does not decide that mechanism.** A per-request session variable is the
illustrative default used throughout this deliverable because it is the simplest to read in DDL,
but whether it is actually the right choice — versus, say, a Postgres role per clinic, or a policy
that reads a verified JWT claim instead of a session variable at all — is Open Question 1 in
[`07-open-questions.md`](./07-open-questions.md), because the choice has real, hard-to-reverse
consequences for which connection pooler and ORM/query layer this codebase can use. The sign-in
flow above resolves `clinicId` from the session and would pass it into whichever mechanism Ahmed
selects; nothing about the flow itself depends on which one is chosen.
