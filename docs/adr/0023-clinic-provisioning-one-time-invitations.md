# 0023 — Clinic provisioning and one-time staff invitations

## Status

Proposed

## Date

2026-10-08

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)). Pilot
readiness for an already-closed phase: `docs/product/03-user-flows.md` ("Clinic sign-up and
first-run setup", "Inviting a staff member") and `docs/domain/01-entities.md` (StaffMember,
Invitation) describe both flows; neither exists in code.

## Impact

Costly to reverse and security-relevant (see [charter §10](../governance/project-charter.md)): it
adds a second pre-tenant-context database path beside the one [ADR-0012](./0012-authentication-bootstrap-security-definer.md)
describes as the only RLS bypass, it fixes how a credential-bearing link is generated, stored and
consumed, and it decides how the first owner of every clinic comes to exist.

## Context

Nothing in the application can create a clinic or its first staff member today. The only writer of
`clinics` and `staff_members` outside tests is `scripts/seed.ts`, which creates one fixed demo
clinic and one fixed `receptionist`, and refuses to run against production. `app_user` holds no
`INSERT` on `clinics` (`db/migrations/0008_revoke_clinics_insert.sql`: creating a tenant is an
administrative operation, not a runtime one). As a result, production has no owner or admin account
and nothing role-restricted has ever been exercised there (`CLAUDE.md`, Status).

The documented sign-up flow is public self-service with email verification. It needs a
transactional email provider, which is a sub-processor under [ADR-0009](./0009-data-residency.md)
(EEA-only, signed DPA, entry in the sub-processor register). None is selected, and a public sign-up
endpoint is an abuse surface the first, manually onboarded pilot clinic does not need.

The documented `invitations` table (`docs/technical/01-database-schema.md`) exists in no migration,
and as documented it stores **no secret**: the acceptance flow in
`docs/technical/04-auth-implementation.md` reads `invitations WHERE id = :id AND status = 'pending'`
and never verifies the `token` it receives. Anyone holding an invitation id could accept it. It also
declares `invited_by NOT NULL`, which a clinic's first owner, invited before any staff member
exists, cannot satisfy.

Accepting an invitation happens before the invitee has a session, so before
`app.current_clinic_id` can be known. `invitations` is tenant-scoped under RLS + FORCE RLS like
every other tenant table ([ADR-0003](./0003-multi-tenancy-model.md),
[ADR-0006](./0006-rls-tenant-context-propagation.md)), so the lookup that resolves which clinic an
invitation belongs to cannot run under that clinic's context. This is the same chicken-and-egg
shape ADR-0012 solved for sign-in and session validation, and ADR-0012 states that its two
functions are the only RLS bypass in the runtime path. A third one is therefore a deliberate
exception that has to be recorded, bounded and tested, not added silently.

## Decision

### 1. Clinics are created by an operator provisioning script

A repository script (for example `scripts/provision-clinic.ts`) is the only way a clinic is created.
The operator (the Owner, during the validation phase) runs it from a trusted terminal with
`DATABASE_URL` (the owner/migration role), the same way migrations and `scripts/seed.ts` run. There
is no public sign-up endpoint and no HTTP route that creates a clinic.

- Inputs: clinic name, at least one contact channel, owner email, IANA timezone (validated, no
  default — [ADR-0016](./0016-clinic-working-hours-iana-timezone.md)), and optionally working hours
  (validated as in [ADR-0022](./0022-clinic-settings-writes-through-tenant-bound-function.md)).
- In **one transaction** it inserts the `clinics` row and a pending **owner invitation** for that
  clinic. Nothing is half-created.
- The clinic is created with `status = 'active'`. The operator verifies the clinic's details before
  running the script, so there is no separate onboarding approval step.
- It refuses an owner email that already belongs to any staff member (staff email is globally
  unique, ADR-0012 decision 1) or already has a pending invitation for that clinic.
- It **never creates a password**, temporary or otherwise, and never creates a `staff_members` row.
  The owner's account only comes into existence when the owner accepts the invitation and chooses
  their own password, so no credential ever passes through the operator.
- It prints the one-time invitation link to the operator's terminal once, and nowhere else. It may
  also reissue an owner invitation for a provisioned clinic whose owner has not accepted yet (for
  example a lost or expired link): the existing pending invitation is marked `expired` and a new one
  is issued in the same transaction.
- Running it against production requires an explicit confirmation flag, so it cannot be run there by
  accident.

### 2. One-time invitations

- **Secret:** 32 bytes from a cryptographically secure random generator, encoded URL-safe
  (base64url) for the link.
- **Storage:** only `token_hash = SHA-256(raw token)` is stored, as lowercase hex, in a `UNIQUE`
  column. The raw token is never stored, logged, returned by any API after creation, or written to
  any file. It exists only in the link given to the operator (item 1) or to the inviting
  owner/admin (item 3, decision 5), once. SHA-256 without a salt is sufficient because the input is
  256 bits of randomness, not a human-chosen value; this matches how session tokens are already
  stored (`staff_sessions.token_hash`, ADR-0012).
- **Expiry:** `expires_at = created_at + 72 hours`, set by the database at insert.
- **Single use:** an invitation moves `pending → accepted` at most once, or `pending → expired`.
  Neither transition can be reversed. At most one pending invitation exists per `(clinic, email)`
  (the documented partial unique index).
- **Link shape:** the token travels in the URL **fragment** (`/invite#<token>`), which browsers do
  not send to the server, so it does not appear in hosting access logs or `Referer` headers. The
  page reads it in the browser and submits it once in a `POST` body.
- **Uniform failure:** an unknown, already-used or expired token all produce the same "this
  invitation is no longer valid" response, so the response never confirms that a token or an
  invitation exists.
- **Schema corrections to the documented `invitations` table,** recorded here because the documented
  shape is unsafe or unsatisfiable: add `token_hash text NOT NULL UNIQUE`; make `invited_by`
  nullable, with a `CHECK` that it is `NULL` only for a `role = 'owner'` invitation (an
  operator-provisioned first owner), and a same-clinic composite foreign key
  `(invited_by, clinic_id) → staff_members(id, clinic_id)` when present. RLS + FORCE RLS and the
  `tenant_isolation` policy stay exactly as documented.

### 3. Transactional acceptance with row locking

Acceptance is one database transaction:

1. Resolve the invitation by `token_hash` with `status = 'pending'` and lock it (`FOR UPDATE`). No
   row: uniform failure.
2. If `expires_at <= now()`: set `status = 'expired'`, commit, uniform failure.
3. Insert the `staff_members` row with the invitation's own `clinic_id`, `email` and `role`, and the
   password hash computed by the application.
4. Set the invitation to `accepted`, `accepted_at = now()`.

The row lock makes a concurrent double-submission of the same token safe: the second transaction
waits for the first, then finds no pending row and fails. A unique violation on the staff email
(the email became a staff member elsewhere in the meantime) fails the acceptance and leaves the
invitation pending. After a successful acceptance the invitee signs in through the existing
sign-in flow; acceptance itself creates no session.

### 4. The third bootstrap function: a narrowly scoped exception

Step 1 needs to find an invitation before any tenant context exists. That lookup, and only that
lookup, runs inside one `SECURITY DEFINER` function, for example
`accept_invitation(p_token_hash text, p_password_hash text)`, which performs steps 1–4 itself. It
is an exception to ADR-0012's "no other RLS bypass", bounded as follows:

- **Owned by a dedicated role**, for example `invitation_acceptor`, created `NOLOGIN`,
  `NOSUPERUSER`, `NOBYPASSRLS`, with the guarded attribute check used for `auth_bootstrap`. Never
  `app_user`, never `auth_bootstrap`, never a role with `SUPERUSER` or `BYPASSRLS`.
- **Row visibility without BYPASSRLS** ([ADR-0013](./0013-auth-bootstrap-rls-without-bypassrls.md)
  pattern): one role-scoped permissive policy on `invitations` only, for `SELECT` and `UPDATE`, for
  that role only. No such policy on `staff_members` or any other table.
- **Writes to `staff_members` stay under normal RLS:** after resolving the invitation, the function
  sets `app.current_clinic_id` to that invitation's `clinic_id` for its own insert, so the existing
  `tenant_isolation` `WITH CHECK` still applies, and clears it before returning.
- **Column-scoped privileges only:** exactly the `invitations` columns it reads and the ones it
  updates (`status`, `accepted_at`), and `INSERT` on the `staff_members` columns it writes.
- **Fixed shape:** `plpgsql` (never inlined), static SQL only (no `EXECUTE`, no `format()`),
  `SET search_path` pinned on the function. It rejects any `p_token_hash` that is not exactly 64
  lowercase hex characters before touching a table.
- **It cannot choose anything:** clinic, email and role all come from the invitation row. The
  caller supplies only the token hash and an already-computed Argon2id hash. The raw password never
  reaches the database.
- **Minimal output:** an outcome, plus `staff_id`, `clinic_id` and `role` on success. Never the
  email, the token hash or the password hash.
- **`EXECUTE` revoked from `PUBLIC`, granted to `app_user` only.**
- **No preview function.** No other pre-context function is authorized by this record, including
  one that would show an invitation's clinic or email before acceptance. Adding one needs its own
  decision.
- **Brute force:** guessing a valid 256-bit token is infeasible, so no rate limit is added for this
  purpose. Rate limiting the endpoint for availability reasons is a separate concern.

ADR-0012's two functions and the `auth_bootstrap` role are not changed by this record.

### 5. Manual delivery during the validation phase

There is no email provider. The operator (item 1) or the inviting owner/admin (item 3) copies the
link and delivers it to the invitee personally, over a channel of their choosing. Selecting a
transactional email provider is a later, separate decision under ADR-0009, and will reuse this
mechanism unchanged.

### 6. Password policy

A password set through invitation acceptance (and any future password-setting path) must be **12 to
128 characters**, counted as Unicode code points. **No composition rules** (no required digits,
symbols or letter cases) and no forced periodic rotation, in line with NIST SP 800-63B, which also
requires verifiers to accept at least 64 characters. The upper bound limits request size and hashing
input. Existing sign-in does not enforce this policy retroactively on already-stored hashes.

### 7. Item 3 reuses the same mechanism

Staff invitations by an owner or admin (`/dashboard/staff`, `POST /api/staff/invitations`) create
rows in the same `invitations` table, with the same token, hash, expiry and single-use rules, and
are accepted through the same function and page. Creating them needs no bypass: the inviter has a
session, so the insert runs under `withTenantContext` and normal RLS, with `invited_by` set from the
session. Which roles an admin may grant, and the exact staff-page behaviour, are decided when item 3
is scoped. The acceptance path in this record does not change for it.

## Consequences

- A clinic and its first owner can be created in production without any credential passing through
  the operator, without a public sign-up surface, and without an email sub-processor.
- Production gains a real owner identity only when a real clinic owner accepts, which also closes
  the authenticated production click-through gap recorded in `CLAUDE.md`.
- One more reviewed `SECURITY DEFINER` function and one more `NOLOGIN` role exist. ADR-0012's
  statement that its functions are the only bypass is narrowed by this record to "its functions and
  the acceptance function in ADR-0023". Both are defined only in version-controlled migrations.
- `docs/technical/01-database-schema.md` (`invitations`), `docs/technical/04-auth-implementation.md`
  (acceptance flow) and `docs/technical/03-api-contracts.md` (the accept route takes the token in
  the body, not an invitation id in the path) must be updated to match this record when it is
  implemented.
- A lost link cannot be recovered, only reissued, because the raw token is never stored.
- Implementation needs, in order and each with Owner approval: a migration (expected `0016`) for
  `invitations`, the acceptance role, policy and function; the acceptance page and route; the
  provisioning script; tests. Production application of the migration is a separate Owner-approved
  step through the repository runner.
- Tests must prove, against PostgreSQL: only the hash is stored; acceptance creates exactly one
  staff member with the invitation's clinic, email and role; a second acceptance fails; an expired
  invitation fails and is marked expired; two concurrent acceptances produce one staff member; a
  malformed token hash is rejected; `PUBLIC` cannot execute the function; the acceptance role has no
  `BYPASSRLS` and no row access to any table other than `invitations`; `app_user` still cannot
  read another clinic's invitations; and provisioning is all-or-nothing.

## Alternatives considered

- **Script creates the owner with a temporary password.** Simplest, but the password is chosen by
  or visible to the operator and has to be sent in a message, and a forced first-login change adds
  its own flow. Rejected by the Owner (decision D1).
- **Public self-service sign-up with email verification (the documented flow).** Needs an email
  provider ADR and DPA first, and opens a public account-creation surface before the first clinic is
  validated. Deferred, not rejected; it can later create the same owner invitation.
- **Accept by invitation id plus token compared in application code.** Needs a pre-context read of
  the invitation row anyway, so it does not avoid the bypass, and adds a timing-sensitive comparison.
  Looking up by `token_hash` removes both.
- **Reuse `auth_bootstrap` for acceptance.** Would give the sign-in lookup role write access and
  visibility into invitations, widening the existing bypass instead of keeping each one minimal.
  Rejected.
- **`BYPASSRLS` or a table-wide policy for the acceptance role.** Rejected for the reasons
  ADR-0012 and ADR-0013 record.
- **Store the raw token, or a reversibly encrypted one.** Any database read would then yield usable
  links. Rejected.
