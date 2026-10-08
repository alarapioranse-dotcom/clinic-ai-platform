# invitations

One-time invitations that turn into staff accounts
([ADR-0023](../../../docs/adr/0023-clinic-provisioning-one-time-invitations.md)).

## Current scope (PR B: acceptance only)

- `acceptInvitation(rawToken, password)` — validates the password (12–128 Unicode code points, no
  composition rules), hashes it with the existing Argon2id `hashPassword`, hashes the token with
  SHA-256, and calls `accept_invitation` (`db/migrations/0016_invitations.sql`) through
  `acceptInvitationInDatabase` in `src/lib/db.ts`. Only the two hashes reach PostgreSQL.
  Outcomes: `accepted`, `invalid` (unknown, used, expired or malformed token, indistinguishable),
  `email_taken`.
- `hashInvitationToken(rawToken)` — SHA-256 lowercase hex.

Acceptance creates **no session** (ADR-0023 decision 3); the invitee signs in afterwards.

HTTP: `POST /api/invitations/accept` (public). Screen: `/invite#<token>` (public).

## Not in scope yet

Creating invitations (the provisioning script, `/dashboard/staff`), email delivery, rate limiting.
