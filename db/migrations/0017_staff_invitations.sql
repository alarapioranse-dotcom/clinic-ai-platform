-- Item 3 (staff invitations), ADR-0023 decision 7 and Owner decision S2.
-- Migration 0016 deliberately gave app_user no privilege on `invitations`
-- (Owner decision E3). Staff invitations are created by a signed-in owner or
-- admin under their own tenant context, so app_user now needs exactly:
--
--   SELECT  every column except token_hash — the hash is never readable by
--           the application, so nothing reachable from the app can match or
--           replay a token. Includes the columns the WHERE clauses and the
--           INSERT ... RETURNING of the staff feature reference.
--   INSERT  the five columns a new invitation sets; id, status, expires_at
--           and created_at come from their defaults (expires_at is fixed at
--           created_at + 72 hours by the 0016 constraint).
--   UPDATE  status only. With 0016's invitations_guard_update trigger
--           (only pending -> accepted / expired, never back) and the
--           accepted <=> accepted_at constraint (app_user cannot set
--           accepted_at), the only change app_user can make is
--           pending -> expired: cancelling an invitation (Owner decision S5),
--           or retiring a pending invitation whose time has passed before a
--           new one is issued for the same email.
--
-- No DELETE. No change to RLS: FORCE ROW LEVEL SECURITY and the 0016
-- tenant_isolation policy keep every read and write inside the session's own
-- clinic. Which roles may invite which (Owner decision S1) is enforced in the
-- application; its "nobody invites an owner" part is also enforced by the
-- constraint at the end of this file.

GRANT SELECT (id, clinic_id, email, role, status, invited_by, expires_at, accepted_at, created_at)
  ON invitations TO app_user;
GRANT INSERT (clinic_id, email, role, token_hash, invited_by) ON invitations TO app_user;
GRANT UPDATE (status) ON invitations TO app_user;

-- Owner decision S1 ("nobody invites an owner"), enforced in the database as
-- well as in the application. Together with 0016's
-- invitation_inviter_required_unless_owner (invited_by IS NOT NULL OR
-- role = 'owner'), this makes the two exactly equivalent: an owner
-- invitation never has an inviter (only the operator provisioning script
-- issues one), and an invitation with an inviter is never for an owner.
-- Safe on existing data: an owner invitation with an inviter has never been
-- possible to create through any code path.
ALTER TABLE invitations
  ADD CONSTRAINT invitation_owner_never_invited_by_staff
    CHECK (role <> 'owner' OR invited_by IS NULL);
