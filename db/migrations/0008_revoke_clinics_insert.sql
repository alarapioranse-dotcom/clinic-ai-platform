-- 0003_clinics.sql granted INSERT to app_user alongside the deliberately
-- column-restricted SELECT (id, name, status, working_hours). Creating a
-- tenant is an administrative operation, not a runtime one — nothing in the
-- running application inserts into `clinics` as app_user, so that INSERT
-- grant was broader than anything this role actually needs.
REVOKE INSERT ON clinics FROM app_user;
