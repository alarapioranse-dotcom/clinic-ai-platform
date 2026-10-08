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
-- application, not here.

GRANT SELECT (id, clinic_id, email, role, status, invited_by, expires_at, accepted_at, created_at)
  ON invitations TO app_user;
GRANT INSERT (clinic_id, email, role, token_hash, invited_by) ON invitations TO app_user;
GRANT UPDATE (status) ON invitations TO app_user;
